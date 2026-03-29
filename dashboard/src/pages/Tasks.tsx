import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Task, type Repo, type Schedule, type CreateTaskInput } from "../api/client";

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
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [form, setForm] = useState({
    repoId: 0,
    additionalRepoIds: [] as number[],
    title: "",
    prompt: "",
    workflow: "plan-implement-pr",
    priority: 5,
    scheduleId: 0,
  });
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [newRepo, setNewRepo] = useState({ name: "", url: "", branch: "main" });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [t, r, s] = await Promise.all([api.getTasks(), api.getRepos(), api.getSchedules()]);
    setTasks(t.data);
    setRepos(r.data);
    setSchedules(s.data);
    if (r.data.length > 0 && form.repoId === 0) {
      setForm((f) => ({ ...f, repoId: r.data[0].id }));
    }
    // Pre-select schedule if exactly 1 active schedule
    const activeSchedules = s.data.filter((sch) => sch.enabled);
    if (activeSchedules.length === 1) {
      setForm((f) => ({ ...f, scheduleId: activeSchedules[0].id }));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    let repoId = form.repoId;

    // If creating a new repo inline, create it first
    if (creatingRepo) {
      const res = await api.createRepo({ name: newRepo.name, url: newRepo.url, branch: newRepo.branch });
      repoId = res.data.id;
    }

    const taskData: CreateTaskInput = {
      repoId,
      title: form.title,
      prompt: form.prompt,
      workflow: form.workflow,
      priority: form.priority,
      scheduleId: form.scheduleId || undefined,
    };
    if (form.additionalRepoIds.length > 0) {
      taskData.additionalRepoIds = form.additionalRepoIds;
    }
    await api.createTask(taskData);
    setShowCreate(false);
    setCreatingRepo(false);
    setNewRepo({ name: "", url: "", branch: "main" });
    setForm((f) => ({ ...f, title: "", prompt: "", additionalRepoIds: [] }));
    load();
  }

  async function handleAction(id: number, action: "run" | "pause" | "cancel") {
    if (action === "run") await api.runTask(id);
    else if (action === "pause") await api.pauseTask(id);
    else await api.cancelTask(id);
    load();
  }

  function handleRepoSelect(value: number) {
    if (value === 0) {
      setCreatingRepo(true);
      setForm({ ...form, repoId: 0 });
    } else {
      setCreatingRepo(false);
      setForm({ ...form, repoId: value });
    }
  }

  function getScheduleName(scheduleId: number | null): string | null {
    if (!scheduleId) return null;
    const s = schedules.find((sch) => sch.id === scheduleId);
    return s ? s.name : null;
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
              value={creatingRepo ? 0 : form.repoId}
              onChange={(e) => handleRepoSelect(Number(e.target.value))}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
            >
              {repos.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
              <option value={0}>+ Add new repo</option>
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

          {/* Inline repo creation fields */}
          {creatingRepo && (
            <div className="grid grid-cols-3 gap-3 border border-zinc-700 rounded p-3 bg-zinc-800/50">
              <input
                type="text"
                placeholder="Repo name"
                value={newRepo.name}
                onChange={(e) => setNewRepo({ ...newRepo, name: e.target.value })}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                required
              />
              <input
                type="text"
                placeholder="git@github.com:org/repo.git"
                value={newRepo.url}
                onChange={(e) => setNewRepo({ ...newRepo, url: e.target.value })}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                required
              />
              <input
                type="text"
                placeholder="Branch (default: main)"
                value={newRepo.branch}
                onChange={(e) => setNewRepo({ ...newRepo, branch: e.target.value })}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
            </div>
          )}

          {/* Additional repos */}
          {form.additionalRepoIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {form.additionalRepoIds.map(rid => {
                const r = repos.find(r => r.id === rid);
                return r ? (
                  <span key={rid} className="inline-flex items-center gap-1 text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded">
                    {r.name}
                    <button
                      type="button"
                      onClick={() => setForm({...form, additionalRepoIds: form.additionalRepoIds.filter(id => id !== rid)})}
                      className="text-zinc-500 hover:text-zinc-200"
                    >
                      x
                    </button>
                  </span>
                ) : null;
              })}
            </div>
          )}
          {repos.filter(r => r.id !== form.repoId && r.id !== 0 && !form.additionalRepoIds.includes(r.id)).length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const id = Number(e.target.value);
                if (id > 0) {
                  setForm({...form, additionalRepoIds: [...form.additionalRepoIds, id]});
                }
              }}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-400"
            >
              <option value="">+ Add another repo</option>
              {repos.filter(r => r.id !== form.repoId && r.id !== 0 && !form.additionalRepoIds.includes(r.id)).map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}

          {/* Schedule dropdown */}
          <select
            value={form.scheduleId}
            onChange={(e) => setForm({ ...form, scheduleId: Number(e.target.value) })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
          >
            <option value={0}>No schedule (manual)</option>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

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
              onClick={() => { setShowCreate(false); setCreatingRepo(false); }}
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

      {/* Filter bar */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {["all", "pending", "queued", "running", "completed", "failed"].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              filter === s
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="ml-1 text-zinc-500">
              {s === "all" ? tasks.length : tasks.filter(t => t.status === s).length}
            </span>
          </button>
        ))}
      </div>

      {/* Task list */}
      <div className="space-y-2">
        {tasks.length === 0 && (
          <p className="text-zinc-500 text-center py-8">
            No tasks yet. Create one to get started.
          </p>
        )}
        {(() => {
          const filteredTasks = filter === "all" ? tasks : tasks.filter(t => t.status === filter);
          const sortOrder: Record<string, number> = { running: 0, queued: 1, pending: 2, failed: 3, paused: 4, completed: 5, cancelled: 6 };
          const sortedTasks = [...filteredTasks].sort((a, b) => {
            const orderDiff = (sortOrder[a.status] ?? 9) - (sortOrder[b.status] ?? 9);
            if (orderDiff !== 0) return orderDiff;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          });
          return sortedTasks;
        })().map((task) => {
          const scheduleName = getScheduleName(task.scheduleId);
          return (
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
                  {scheduleName && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/40 text-purple-300">
                      {scheduleName}
                    </span>
                  )}
                  {(() => {
                    const repo = repos.find(r => r.id === task.repoId);
                    return repo ? (
                      <span className="text-[10px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded font-mono">
                        {repo.name}
                      </span>
                    ) : null;
                  })()}
                  {task.additionalRepoIds && (() => {
                    try {
                      const ids = typeof task.additionalRepoIds === 'string' ? JSON.parse(task.additionalRepoIds) : task.additionalRepoIds;
                      return ids.length > 0 ? (
                        <span className="text-[10px] bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded">
                          +{ids.length} repo{ids.length > 1 ? "s" : ""}
                        </span>
                      ) : null;
                    } catch { return null; }
                  })()}
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
                {task.status !== "running" && task.status !== "queued" && (
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete task "${task.title}"?`)) return;
                      await api.deleteTask(task.id);
                      load();
                    }}
                    className="text-xs bg-zinc-800 text-zinc-500 hover:text-red-400 px-2 py-1 rounded"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
