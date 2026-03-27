import { useEffect, useState } from "react";
import { api, type Schedule, type Repo } from "../api/client";

export default function Schedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    cronExpr: "0 1 * * *",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    repoId: 0,
    title: "",
    prompt: "",
    workflow: "plan-implement-pr",
  });

  useEffect(() => { load(); }, []);

  async function load() {
    const [s, r] = await Promise.all([api.getSchedules(), api.getRepos()]);
    setSchedules(s.data);
    setRepos(r.data);
    if (r.data.length > 0 && form.repoId === 0) {
      setForm((f) => ({ ...f, repoId: r.data[0].id }));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api.createSchedule({
      name: form.name,
      cronExpr: form.cronExpr,
      timezone: form.timezone,
      taskTemplate: {
        repoId: form.repoId,
        title: form.title,
        prompt: form.prompt,
        workflow: form.workflow,
      },
    });
    setShowCreate(false);
    load();
  }

  async function handleTrigger(id: number) {
    await api.triggerSchedule(id);
    load();
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this schedule?")) return;
    await api.deleteSchedule(id);
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Schedules</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-sm"
        >
          + New Schedule
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-6 space-y-3">
          <input
            type="text"
            placeholder="Schedule name (e.g., Nightly bug sweep)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
            required
          />
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Cron Expression</label>
              <input
                type="text"
                value={form.cronExpr}
                onChange={(e) => setForm({ ...form, cronExpr: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono"
                placeholder="0 1 * * *"
                required
              />
              <p className="text-[10px] text-zinc-600 mt-1">
                {describeCron(form.cronExpr)}
              </p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Timezone</label>
              <input
                type="text"
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Repo</label>
              <select
                value={form.repoId}
                onChange={(e) => setForm({ ...form, repoId: Number(e.target.value) })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              >
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
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
            placeholder="Task prompt"
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm h-20 resize-y"
            required
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-zinc-400">Cancel</button>
            <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-sm">Create</button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {schedules.length === 0 && <p className="text-zinc-500 text-center py-8">No schedules yet.</p>}
        {schedules.map((s) => (
          <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-200">{s.name}</p>
              <p className="text-xs text-zinc-500 font-mono mt-0.5">
                {s.cronExpr} ({s.timezone})
              </p>
              {s.nextRun && (
                <p className="text-xs text-zinc-600 mt-0.5">
                  Next: {new Date(s.nextRun).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${s.enabled ? "bg-green-900/30 text-green-400" : "bg-zinc-800 text-zinc-500"}`}>
                {s.enabled ? "Active" : "Disabled"}
              </span>
              <button onClick={() => handleTrigger(s.id)} className="text-xs bg-zinc-800 text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded">
                Trigger Now
              </button>
              <button onClick={() => handleDelete(s.id)} className="text-xs text-red-400 hover:text-red-300 px-2 py-1">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function describeCron(expr: string): string {
  const parts = expr.split(" ");
  if (parts.length !== 5) return "Invalid";
  const [min, hour, dom, mon, dow] = parts;
  if (dom === "*" && mon === "*" && dow === "*") return `Daily at ${hour}:${min.padStart(2, "0")}`;
  if (dow !== "*") return `At ${hour}:${min.padStart(2, "0")} on weekdays ${dow}`;
  return expr;
}
