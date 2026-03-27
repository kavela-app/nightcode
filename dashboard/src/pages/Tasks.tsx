import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Task, type Repo } from "../api/client";

const statusBadge: Record<string, string> = {
  pending: "bg-zinc-700 text-zinc-300",
  queued: "bg-yellow-900/50 text-yellow-300",
  running: "bg-blue-900/50 text-blue-300",
  paused: "bg-orange-900/50 text-orange-300",
  completed: "bg-green-900/50 text-green-300",
  failed: "bg-red-900/50 text-red-300",
  cancelled: "bg-zinc-800 text-zinc-500",
};

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ repoId: 0, title: "", prompt: "", workflow: "plan-implement-pr", priority: 5 });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [t, r] = await Promise.all([api.getTasks(), api.getRepos()]);
    setTasks(t.data);
    setRepos(r.data);
    if (r.data.length > 0 && form.repoId === 0) {
      setForm((f) => ({ ...f, repoId: r.data[0].id }));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api.createTask(form);
    setShowCreate(false);
    setForm((f) => ({ ...f, title: "", prompt: "" }));
    load();
  }

  async function handleAction(id: number, action: "run" | "pause" | "cancel") {
    if (action === "run") await api.runTask(id);
    else if (action === "pause") await api.pauseTask(id);
    else await api.cancelTask(id);
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Tasks</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-sm"
        >
          + New Task
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-6 space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.repoId}
              onChange={(e) => setForm({ ...form, repoId: Number(e.target.value) })}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
            >
              {repos.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <select
              value={form.workflow}
              onChange={(e) => setForm({ ...form, workflow: e.target.value })}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
            >
              <option value="implement-pr">Quick (implement + PR)</option>
              <option value="plan-implement-pr">Standard (plan + implement + PR)</option>
              <option value="plan-audit-implement-pr">Thorough (plan + audit + implement + test + PR)</option>
            </select>
          </div>
          <input
            type="text"
            placeholder="Task title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
            required
          />
          <textarea
            placeholder="Task prompt — describe what Claude should do..."
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm h-28 resize-y"
            required
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-sm"
            >
              Create Task
            </button>
          </div>
        </form>
      )}

      {/* Task list */}
      <div className="space-y-2">
        {tasks.length === 0 && (
          <p className="text-zinc-500 text-center py-8">
            No tasks yet. Create one to get started.
          </p>
        )}
        {tasks.map((task) => (
          <div
            key={task.id}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-between"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${statusBadge[task.status] || "bg-zinc-700 text-zinc-300"}`}
                >
                  {task.status}
                </span>
                <span className="text-xs text-zinc-600 font-mono">
                  P{task.priority}
                </span>
                {task.currentStep && (
                  <span className="text-xs text-zinc-500">
                    step: {task.currentStep}
                  </span>
                )}
                {task.prUrl && (
                  <a
                    href={task.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 bg-blue-900/30 border border-blue-800/50 text-blue-300 hover:text-blue-200 hover:bg-blue-900/40 px-2 py-0.5 rounded text-xs font-medium transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    {task.prNumber ? `PR #${task.prNumber}` : "PR"}
                  </a>
                )}
              </div>
              <Link
                to={`/tasks/${task.id}`}
                className="text-zinc-200 hover:text-white text-sm font-medium"
              >
                {task.title}
              </Link>
              {task.status === "failed" && task.error && (
                <p className="text-xs text-red-400/80 mt-1 truncate">
                  {task.error.length > 120 ? task.error.slice(0, 120) + "..." : task.error}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 ml-4">
              {(task.status === "pending" || task.status === "paused" || task.status === "failed") && (
                <button
                  onClick={() => handleAction(task.id, "run")}
                  className="text-xs bg-green-900/30 text-green-400 hover:bg-green-900/50 px-2 py-1 rounded"
                >
                  Run
                </button>
              )}
              {task.status === "running" && (
                <button
                  onClick={() => handleAction(task.id, "pause")}
                  className="text-xs bg-orange-900/30 text-orange-400 hover:bg-orange-900/50 px-2 py-1 rounded"
                >
                  Pause
                </button>
              )}
              {(task.status === "running" || task.status === "queued") && (
                <button
                  onClick={() => handleAction(task.id, "cancel")}
                  className="text-xs bg-red-900/30 text-red-400 hover:bg-red-900/50 px-2 py-1 rounded"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
