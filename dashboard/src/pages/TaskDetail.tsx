import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type Task, type TaskStep } from "../api/client";
import StepProgress from "../components/StepProgress";

// SSE event types — Claude stream messages have nested content blocks
interface SSEMessageData {
  type: string; // "assistant", "user", "system", "result"
  subtype?: string; // for system: "init", "task_started", "task_progress"
  model?: string;
  message?: {
    role: string;
    content: Array<{
      type: string;
      text?: string;
      thinking?: string;
      name?: string;
      input?: unknown;
      content?: string | unknown;
    }>;
  };
  result?: string;
  cost_usd?: number;
}

interface SSEStepUpdateData {
  stepName: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
}

interface SSETaskUpdateData {
  status: string;
  completedAt?: string;
  prUrl?: string;
  error?: string;
}

interface SSEEvent {
  taskId: number;
  type: "message" | "step_update" | "task_update";
  step?: string;
  data: SSEMessageData | SSEStepUpdateData | SSETaskUpdateData;
  timestamp: string;
}

interface LogEntry {
  id: number;
  type: "assistant" | "tool_use" | "tool_result" | "system" | "step_change";
  text: string;
  detail?: string;
  timestamp: string;
}

function truncate(str: string | undefined | null, max: number): string {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

function formatToolInput(input: unknown): string {
  if (!input) return "";
  if (typeof input === "string") return input;
  const obj = input as Record<string, unknown>;
  // Show key params cleanly instead of raw JSON
  const parts: string[] = [];
  if (obj.file_path || obj.path) parts.push(String(obj.file_path || obj.path).replace(/^\/repos\/[^/]+\//, ""));
  if (obj.pattern) parts.push(`"${truncate(String(obj.pattern), 40)}"`);
  if (obj.command) parts.push(truncate(String(obj.command), 60));
  if (obj.content) parts.push(truncate(String(obj.content), 40));
  if (obj.old_string) parts.push("replacing...");
  if (parts.length > 0) return parts.join(" ");
  return truncate(JSON.stringify(input), 80);
}

function formatToolResult(content: unknown): string {
  if (!content) return "";
  const text = typeof content === "string" ? content : JSON.stringify(content);
  // Clean up common patterns
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length <= 3) return truncate(text.replace(/\n/g, " ").trim(), 150);
  return truncate(lines[0], 100) + ` (+${lines.length - 1} lines)`;
}

function parseStreamMessage(msg: SSEMessageData): Omit<LogEntry, "id" | "timestamp">[] {
  const type = msg.type;
  const entries: Omit<LogEntry, "id" | "timestamp">[] = [];

  if (type === "assistant" && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text) {
        entries.push({ type: "assistant", text: block.text });
      }
      if (block.type === "tool_use") {
        const detail = formatToolInput(block.input);
        entries.push({ type: "tool_use", text: block.name || "tool", detail });
      }
    }
  }

  if (type === "user" && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === "tool_result") {
        const text = formatToolResult(block.content);
        if (text) entries.push({ type: "tool_result", text });
      }
    }
  }

  if (type === "result") {
    entries.push({ type: "system", text: `Completed (cost: $${msg.cost_usd?.toFixed(4) || "?"})` });
  }

  if (type === "system" && msg.subtype === "init") {
    entries.push({ type: "system", text: `Session started (${msg.model || "claude"})` });
  }

  return entries;
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<(Task & { steps: TaskStep[]; subtasks?: Task[] }) | null>(null);
  const [exportMd, setExportMd] = useState("");
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const [refineMessage, setRefineMessage] = useState("");
  const [refineSending, setRefineSending] = useState(false);
  const [refineError, setRefineError] = useState("");
  const [lastCreatedSubtask, setLastCreatedSubtask] = useState<Task | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logIdRef = useRef(0);
  const autoScrollRef = useRef(true);

  const isLive = task?.status === "running" || task?.status === "queued";

  // Auto-scroll logic: track whether user has scrolled up
  const handleLogScroll = useCallback(() => {
    const el = logContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }, []);

  // Scroll log container to bottom when new entries arrive (NOT the page)
  useEffect(() => {
    if (autoScrollRef.current && logContainerRef.current) {
      const el = logContainerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [logEntries]);

  // Add a log entry helper
  const addLogEntry = useCallback((entry: Omit<LogEntry, "id">) => {
    setLogEntries((prev) => {
      const next = [...prev, { ...entry, id: ++logIdRef.current }];
      // Keep max 500 entries to avoid memory issues
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  // SSE connection — connect for all tasks to load history, stay connected for live ones
  useEffect(() => {
    if (!id) return;

    // If already connected and not live, don't reconnect
    if (eventSourceRef.current && !isLive) return;

    const token = localStorage.getItem("nightcode_token");
    const url = `/api/tasks/${id}/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    // For completed tasks, close after receiving catch-up data
    if (!isLive) {
      setTimeout(() => {
        es.close();
        eventSourceRef.current = null;
      }, 3000);
    }

    es.onopen = () => {
      setSseConnected(true);
    };

    es.addEventListener("message", (e) => {
      try {
        const evt: SSEEvent = JSON.parse(e.data);
        if (evt.type === "message") {
          const d = evt.data as SSEMessageData;
          const entries = parseStreamMessage(d);
          for (const entry of entries) {
            addLogEntry({
              ...entry,
              timestamp: evt.timestamp,
            });
          }
        }
      } catch {
        // ignore malformed data
      }
    });

    es.addEventListener("step_update", (e) => {
      try {
        const evt: SSEEvent = JSON.parse(e.data);
        const d = evt.data as SSEStepUpdateData;
        addLogEntry({
          type: "step_change",
          text: `${d.stepName}: ${d.status}`,
          timestamp: evt.timestamp,
        });
        // Update step in task state in real time
        setTask((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            steps: prev.steps.map((s) =>
              s.stepName === d.stepName
                ? {
                    ...s,
                    status: d.status,
                    startedAt: d.startedAt || s.startedAt,
                    completedAt: d.completedAt || s.completedAt,
                    result: d.result || s.result,
                  }
                : s,
            ),
          };
        });
      } catch {
        // ignore
      }
    });

    es.addEventListener("task_update", (e) => {
      try {
        const evt: SSEEvent = JSON.parse(e.data);
        const d = evt.data as SSETaskUpdateData;
        setTask((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            status: d.status,
            completedAt: d.completedAt || prev.completedAt,
            prUrl: d.prUrl || prev.prUrl,
            error: d.error || prev.error,
          };
        });
      } catch {
        // ignore
      }
    });

    es.onerror = () => {
      setSseConnected(false);
      // EventSource will auto-reconnect
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      setSseConnected(false);
    };
  }, [id, isLive, addLogEntry]);

  // Polling: 3s when not live, 5s fallback when live
  useEffect(() => {
    if (!id) return;
    load();
    const interval = setInterval(load, isLive ? 5000 : 3000);
    return () => clearInterval(interval);
  }, [id, isLive]);

  async function load() {
    if (!id) return;
    const res = await api.getTask(parseInt(id, 10));
    setTask(res.data);
  }

  async function handleRefine() {
    if (!id || !refineMessage.trim()) return;
    setRefineSending(true);
    setRefineError("");
    try {
      const res = await api.refineTask(parseInt(id, 10), refineMessage.trim());
      setLastCreatedSubtask(res.data);
      setRefineMessage("");
      load(); // reload to pick up new subtask
    } catch (err: any) {
      setRefineError(err.message || "Failed to create refinement task");
    } finally {
      setRefineSending(false);
    }
  }

  async function handleExport() {
    if (!id) return;
    const res = await api.exportTask(parseInt(id, 10));
    setExportMd(res.data.markdown);
  }

  async function handleAction(action: "run" | "pause" | "resume" | "cancel") {
    if (!id) return;
    const taskId = parseInt(id, 10);
    if (action === "run") await api.runTask(taskId);
    else if (action === "pause") await api.pauseTask(taskId);
    else if (action === "resume") await api.resumeTask(taskId);
    else await api.cancelTask(taskId);
    load();
  }

  if (!task) return <div className="text-zinc-500 py-20 text-center">Loading...</div>;

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          {task.parentTaskId && (
            <Link
              to={`/tasks/${task.parentTaskId}`}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 mb-2 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Parent task #{task.parentTaskId}
            </Link>
          )}
          <h2 className="text-xl font-semibold">{task.title}</h2>
          {(task as any).additionalRepos?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(task as any).additionalRepos.map((r: any) => (
                <span key={r.id} className="text-xs bg-blue-900/30 text-blue-400 border border-blue-800/50 px-2 py-0.5 rounded">
                  {r.name}
                </span>
              ))}
            </div>
          )}
          <p className="text-sm text-zinc-500 mt-1">
            {task.workflow} &middot; P{task.priority} &middot; {task.status}
          </p>
        </div>
        <div className="flex gap-2">
          {(task.status === "pending" || task.status === "failed") && (
            <button onClick={() => handleAction("run")} className="bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded text-sm">
              Run
            </button>
          )}
          {task.status === "paused" && (
            <button onClick={() => handleAction("resume")} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-sm">
              Resume
            </button>
          )}
          {task.status === "running" && (
            <button onClick={() => handleAction("pause")} className="bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded text-sm">
              Pause
            </button>
          )}
          <button onClick={handleExport} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-sm">
            Export
          </button>
        </div>
      </div>

      {/* Error banner for failed tasks */}
      {task.status === "failed" && task.error && (
        <div className="bg-red-950/50 border border-red-900 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <span className="text-red-400 text-lg leading-none mt-0.5">!</span>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-red-300 mb-1">Task Failed</h3>
              <p className="text-sm text-red-400/90 whitespace-pre-wrap">{task.error}</p>
            </div>
          </div>
        </div>
      )}

      {/* PR link + branch (prominent, shown near top) */}
      {(task.prUrl || task.branchName) && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-3">
            Pull Request
          </h3>
          {task.prUrl && (
            <a
              href={task.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-blue-900/30 border border-blue-800/50 text-blue-300 hover:text-blue-200 hover:bg-blue-900/40 px-3 py-2 rounded-md text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              {task.prNumber ? `PR #${task.prNumber}` : "View Pull Request"}
            </a>
          )}
          {task.additionalPrUrls && (() => {
            try {
              const urls = typeof task.additionalPrUrls === 'string' ? JSON.parse(task.additionalPrUrls) : task.additionalPrUrls;
              return (urls as string[]).map((url: string, i: number) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 px-3 py-2 rounded-md text-sm font-medium transition-colors ml-2"
                >
                  PR #{url.split("/").pop()}
                </a>
              ));
            } catch { return null; }
          })()}
          {task.branchName && (
            <div className="mt-2">
              <code className="text-xs bg-zinc-800 px-2 py-1 rounded text-zinc-400 font-mono">
                {task.branchName}
              </code>
            </div>
          )}
        </div>
      )}

      {/* Step progress */}
      {task.steps.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-3">
            Workflow Progress
          </h3>
          <StepProgress steps={task.steps} />
          <div className="mt-4 space-y-2">
            {task.steps.sort((a, b) => a.stepOrder - b.stepOrder).map((step) => (
              <div key={step.id} className="flex items-center justify-between text-sm">
                <span className="text-zinc-300">{step.stepName}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">{step.status}</span>
                  {step.startedAt && (
                    <span className="text-xs text-zinc-600">
                      {new Date(step.startedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Log — live when running, persisted when complete */}
      {(isLive || logEntries.length > 0) && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs text-zinc-500 uppercase tracking-wide">
                {isLive ? "Live Log" : "Activity Log"}
              </h3>
              {sseConnected ? (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  Connected
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <span className="relative flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-zinc-600" />
                  </span>
                  Reconnecting...
                </span>
              )}
            </div>
            <span className="text-xs text-zinc-600">
              {logEntries.length} message{logEntries.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div
            ref={logContainerRef}
            onScroll={handleLogScroll}
            className="bg-zinc-950 rounded border border-zinc-800 font-mono text-xs leading-relaxed h-96 overflow-y-auto p-3 space-y-0.5"
          >
            {logEntries.length === 0 && (
              <div className="text-zinc-600 py-4 text-center">
                Waiting for activity...
              </div>
            )}
            {logEntries.map((entry) => (
              <div key={entry.id} className={`flex gap-2 ${entry.type === "assistant" ? "py-1" : ""}`}>
                <span className="text-zinc-700 shrink-0 select-none tabular-nums">
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                {entry.type === "assistant" && (
                  <span className="text-green-400/90 whitespace-pre-wrap break-words min-w-0">
                    {entry.text}
                  </span>
                )}
                {entry.type === "tool_use" && (
                  <span className="text-blue-400 min-w-0">
                    <span className="text-blue-500">{"→ "}</span>
                    <span className="font-semibold">{entry.text}</span>
                    {entry.detail && (
                      <span className="text-zinc-600 ml-1.5">{entry.detail}</span>
                    )}
                  </span>
                )}
                {entry.type === "tool_result" && (
                  <span className="text-zinc-600 min-w-0 truncate">
                    <span className="text-zinc-700">{"← "}</span>
                    {entry.text}
                  </span>
                )}
                {entry.type === "system" && (
                  <span className="text-yellow-500/80">
                    {entry.text}
                  </span>
                )}
                {entry.type === "step_change" && (
                  <span className="text-zinc-500 w-full text-center block py-1 border-y border-zinc-800/50">
                    {"── "}{entry.text}{" ──"}
                  </span>
                )}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Step results */}
      {task.steps.filter((s) => s.result).length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-3">
            Results
          </h3>
          <div className="space-y-4">
            {task.steps
              .filter((s) => s.result)
              .sort((a, b) => a.stepOrder - b.stepOrder)
              .map((step) => (
                <div key={step.id}>
                  <h4 className="text-sm font-medium text-zinc-200 mb-1">{step.stepName}</h4>
                  <p className="text-sm text-zinc-400 whitespace-pre-wrap leading-relaxed">
                    {step.result}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Refinements / Subtasks thread */}
      {task.subtasks && task.subtasks.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-3">
            Refinements
          </h3>
          <div className="border-l-2 border-zinc-700 ml-2 pl-4 space-y-3">
            {task.subtasks.map((sub) => (
              <div key={sub.id} className="relative">
                <div className="absolute -left-[1.35rem] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-zinc-700 bg-zinc-900" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={`inline-block text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                          sub.status === "completed"
                            ? "bg-green-900/40 text-green-400"
                            : sub.status === "running"
                              ? "bg-blue-900/40 text-blue-400"
                              : sub.status === "failed"
                                ? "bg-red-900/40 text-red-400"
                                : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {sub.status}
                      </span>
                      <Link
                        to={`/tasks/${sub.id}`}
                        className="text-sm text-zinc-200 hover:text-white truncate transition-colors"
                      >
                        {sub.title}
                      </Link>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span>{new Date(sub.createdAt).toLocaleString()}</span>
                      {sub.prUrl && (
                        <a
                          href={sub.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          {sub.prNumber ? `PR #${sub.prNumber}` : "View PR"}
                        </a>
                      )}
                    </div>
                  </div>
                  <Link
                    to={`/tasks/${sub.id}`}
                    className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kavela context loaded */}
      {(task as any).kavelaSkills?.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-2">
            Context Loaded from Kavela
          </h3>
          <div className="flex flex-wrap gap-2">
            {(task as any).kavelaSkills.map((skill: string) => (
              <span
                key={skill}
                className="text-xs bg-purple-900/30 text-purple-300 border border-purple-800/50 px-2 py-1 rounded"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Task prompt */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
        <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-2">
          Prompt
        </h3>
        <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono">
          {task.prompt}
        </pre>
      </div>

      {/* Take control */}
      {(task.prUrl || task.status === "running") && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-2">
            Take Control
          </h3>
          {task.prUrl ? (
            <>
              <p className="text-sm text-zinc-400 mb-2">
                Continue where nightcode left off on your machine:
              </p>
              <code
                className="text-xs bg-zinc-800 px-3 py-2 rounded block text-green-400 font-mono cursor-pointer hover:bg-zinc-750"
                onClick={() => navigator.clipboard.writeText(`claude --from-pr ${task.prUrl}`)}
                title="Click to copy"
              >
                claude --from-pr {task.prUrl}
              </code>
              <p className="text-xs text-zinc-600 mt-2">
                This resumes the session with full context from the PR. Click to copy.
              </p>
            </>
          ) : task.status === "running" ? (
            <p className="text-sm text-zinc-400">
              Task is running. Pause it first to take control.
            </p>
          ) : null}
        </div>
      )}

      {/* Refine chat input — shown for completed/failed tasks */}
      {(task.status === "completed" || task.status === "failed") && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-1">
            Refine
          </h3>
          <p className="text-xs text-zinc-600 mb-3">
            Send feedback to create a refinement task
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={refineMessage}
              onChange={(e) => setRefineMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRefine(); } }}
              placeholder="e.g., 'The button color should be blue instead of green' or 'Add error handling for the edge case when...'"
              disabled={refineSending}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-full px-4 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50 transition-colors"
            />
            <button
              onClick={handleRefine}
              disabled={refineSending || !refineMessage.trim()}
              className="shrink-0 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5"
            >
              {refineSending ? (
                <span className="inline-block w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
              Send
            </button>
          </div>
          {refineError && (
            <p className="text-xs text-red-400 mt-2">{refineError}</p>
          )}
          {lastCreatedSubtask && (
            <div className="mt-3 bg-zinc-800/50 border border-zinc-700 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-block text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">
                    {lastCreatedSubtask.status}
                  </span>
                  <Link
                    to={`/tasks/${lastCreatedSubtask.id}`}
                    className="text-sm text-zinc-200 hover:text-white truncate transition-colors"
                  >
                    {lastCreatedSubtask.title}
                  </Link>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={async () => {
                      await api.runTask(lastCreatedSubtask.id);
                      load();
                    }}
                    className="text-xs bg-green-600 hover:bg-green-500 text-white px-2.5 py-1 rounded transition-colors"
                  >
                    Run now
                  </button>
                  <Link
                    to={`/tasks/${lastCreatedSubtask.id}`}
                    className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    View
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Export view */}
      {exportMd && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs text-zinc-500 uppercase tracking-wide">
              Exported Chat
            </h3>
            <button
              onClick={() => {
                navigator.clipboard.writeText(exportMd);
              }}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              Copy
            </button>
          </div>
          <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">
            {exportMd}
          </pre>
        </div>
      )}
    </div>
  );
}
