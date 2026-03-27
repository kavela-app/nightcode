import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api, type Task, type TaskStep } from "../api/client";
import StepProgress from "../components/StepProgress";

// SSE event types
interface SSEMessageData {
  type: string; // "assistant", "tool_use", "tool_result", "system"
  content?: string;
  tool_name?: string;
  tool_input?: unknown;
  result?: string;
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

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<(Task & { steps: TaskStep[] }) | null>(null);
  const [notes, setNotes] = useState("");
  const [exportMd, setExportMd] = useState("");
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
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

  // Scroll to bottom when new entries arrive (if auto-scroll is on)
  useEffect(() => {
    if (autoScrollRef.current && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
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

  // SSE connection management
  useEffect(() => {
    if (!id || !isLive) {
      // Disconnect SSE when task is not live
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setSseConnected(false);
      }
      return;
    }

    const token = localStorage.getItem("nightcode_token");
    const url = `/api/tasks/${id}/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setSseConnected(true);
    };

    es.addEventListener("message", (e) => {
      try {
        const evt: SSEEvent = JSON.parse(e.data);
        if (evt.type === "message") {
          const d = evt.data as SSEMessageData;
          if (d.type === "assistant") {
            addLogEntry({
              type: "assistant",
              text: truncate(d.content, 500),
              timestamp: evt.timestamp,
            });
          } else if (d.type === "tool_use") {
            addLogEntry({
              type: "tool_use",
              text: `\u2192 ${d.tool_name || "tool"}`,
              detail: d.tool_input
                ? truncate(
                    typeof d.tool_input === "string"
                      ? d.tool_input
                      : JSON.stringify(d.tool_input),
                    200,
                  )
                : undefined,
              timestamp: evt.timestamp,
            });
          } else if (d.type === "tool_result") {
            addLogEntry({
              type: "tool_result",
              text: `\u2190 ${truncate(d.result, 200)}`,
              timestamp: evt.timestamp,
            });
          } else if (d.type === "system") {
            addLogEntry({
              type: "system",
              text: truncate(d.content, 500),
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
    if (!notes && res.data.notes) setNotes(res.data.notes);
  }

  async function handleSaveNotes() {
    if (!id) return;
    await api.updateTask(parseInt(id, 10), { notes } as Partial<Task>);
    load();
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
          <h2 className="text-xl font-semibold">{task.title}</h2>
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

      {/* Live Log */}
      {isLive && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs text-zinc-500 uppercase tracking-wide">
                Live Log
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
            className="bg-zinc-950 rounded border border-zinc-800 font-mono text-xs leading-relaxed max-h-80 overflow-y-auto p-3 space-y-1"
          >
            {logEntries.length === 0 && (
              <div className="text-zinc-600 py-4 text-center">
                Waiting for activity...
              </div>
            )}
            {logEntries.map((entry) => (
              <div key={entry.id} className="flex gap-2">
                <span className="text-zinc-700 shrink-0 select-none">
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                {entry.type === "assistant" && (
                  <span className="text-green-400 whitespace-pre-wrap break-all">
                    {entry.text}
                  </span>
                )}
                {entry.type === "tool_use" && (
                  <span className="text-blue-400 whitespace-pre-wrap break-all">
                    {entry.text}
                    {entry.detail && (
                      <span className="text-zinc-600 ml-2">{entry.detail}</span>
                    )}
                  </span>
                )}
                {entry.type === "tool_result" && (
                  <span className="text-zinc-500 whitespace-pre-wrap break-all">
                    {entry.text}
                  </span>
                )}
                {entry.type === "system" && (
                  <span className="text-yellow-400 whitespace-pre-wrap break-all">
                    {entry.text}
                  </span>
                )}
                {entry.type === "step_change" && (
                  <span className="text-zinc-500 w-full text-center">
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
      {(task.prUrl || task.sessionId) && (
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
          ) : task.sessionId ? (
            <>
              <p className="text-xs text-zinc-500 mb-2">
                Session ID (Docker-local, for debugging):
              </p>
              <code className="text-xs bg-zinc-800 px-3 py-2 rounded block text-zinc-500 font-mono">
                {task.sessionId}
              </code>
            </>
          ) : null}
        </div>
      )}

      {/* Notes input */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
        <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-2">
          Developer Notes
        </h3>
        <p className="text-xs text-zinc-600 mb-2">
          Add notes that will be injected into the next step when you resume.
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g., 'Move the webhook handler to a separate file' or 'Use the existing AuthService instead of creating a new one'"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm h-20 resize-y"
        />
        <button
          onClick={handleSaveNotes}
          className="mt-2 bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-sm"
        >
          Save Notes
        </button>
      </div>

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
