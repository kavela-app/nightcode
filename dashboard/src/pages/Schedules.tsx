import { useEffect, useState } from "react";
import { api, type Schedule, type Task } from "../api/client";

const INTERVAL_OPTIONS = [
  { label: "Every 30 min", value: 30 },
  { label: "Every hour", value: 60 },
  { label: "Every 2 hours", value: 120 },
  { label: "Every 4 hours", value: 240 },
  { label: "Every 8 hours", value: 480 },
  { label: "Every 12 hours", value: 720 },
  { label: "Every 24 hours", value: 1440 },
];

const TIMEZONE_OPTIONS = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function formatInterval(minutes: number | null): string {
  if (minutes == null) return "-";
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes === 60) return "Every hour";
  const h = minutes / 60;
  return h === Math.floor(h) ? `Every ${h} hours` : `Every ${minutes} min`;
}

function formatWindow(start: string | null, end: string | null, tz: string): string {
  if (!start || !end) return "All day";
  return `${start} - ${end} (${tz})`;
}

export default function Schedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    intervalMinutes: 60,
    windowStart: "",
    windowEnd: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    enabled: true,
  });

  useEffect(() => { load(); }, []);

  async function load() {
    const [s, t] = await Promise.all([api.getSchedules(), api.getTasks()]);
    setSchedules(s.data);
    setTasks(t.data);
  }

  function pendingCount(scheduleId: number): number {
    return tasks.filter((t) => t.scheduleId === scheduleId && t.status === "pending").length;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api.createSchedule({
      name: form.name,
      intervalMinutes: form.intervalMinutes,
      windowStart: form.windowStart || undefined,
      windowEnd: form.windowEnd || undefined,
      timezone: form.timezone,
      enabled: form.enabled,
    });
    setShowCreate(false);
    setForm((f) => ({ ...f, name: "", windowStart: "", windowEnd: "" }));
    load();
  }

  async function handleToggle(s: Schedule) {
    await api.updateSchedule(s.id, { enabled: !s.enabled });
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
            placeholder="Schedule name (e.g., Hourly check)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Interval</label>
              <select
                value={form.intervalMinutes}
                onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Timezone</label>
              <select
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Only run between</label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={form.windowStart}
                onChange={(e) => setForm({ ...form, windowStart: e.target.value })}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
              <span className="text-zinc-500 text-sm">to</span>
              <input
                type="time"
                value={form.windowEnd}
                onChange={(e) => setForm({ ...form, windowEnd: e.target.value })}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Enabled</label>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="rounded bg-zinc-800 border-zinc-700"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-zinc-400">Cancel</button>
            <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-sm">Create</button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {schedules.length === 0 && <p className="text-zinc-500 text-center py-8">No schedules yet.</p>}
        {schedules.map((s) => {
          const pending = pendingCount(s.id);
          return (
            <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200">{s.name}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {formatInterval(s.intervalMinutes)}
                  {" | "}
                  {formatWindow(s.windowStart, s.windowEnd, s.timezone)}
                </p>
                {s.nextRun && (
                  <p className="text-xs text-zinc-600 mt-0.5">
                    Next: {new Date(s.nextRun).toLocaleString()}
                  </p>
                )}
                {pending > 0 && (
                  <p className="text-xs text-yellow-400 mt-0.5">
                    {pending} pending task{pending !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggle(s)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${s.enabled ? "bg-green-600" : "bg-zinc-700"}`}
                  title={s.enabled ? "Disable" : "Enable"}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${s.enabled ? "translate-x-4" : "translate-x-0.5"}`}
                  />
                </button>
                <button onClick={() => handleTrigger(s.id)} className="text-xs bg-zinc-800 text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded">
                  Trigger Now
                </button>
                <button onClick={() => handleDelete(s.id)} className="text-xs text-red-400 hover:text-red-300 px-2 py-1">
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
