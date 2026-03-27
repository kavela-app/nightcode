import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type DashboardStats } from "../api/client";

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadStats() {
    try {
      const res = await api.getStats();
      setStats(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400">{error}</p>
        <p className="text-zinc-500 text-sm mt-2">
          Make sure the nightcode server is running.
        </p>
      </div>
    );
  }

  if (!stats) {
    return <div className="text-zinc-500 py-20 text-center">Loading...</div>;
  }

  const statCards = [
    { label: "Running", value: stats.tasks.running, color: "text-blue-400" },
    { label: "Queued", value: stats.tasks.queued, color: "text-yellow-400" },
    { label: "Completed", value: stats.tasks.completed, color: "text-green-400" },
    { label: "Failed", value: stats.tasks.failed, color: "text-red-400" },
    { label: "Repos", value: stats.repos, color: "text-zinc-300" },
    { label: "Schedules", value: stats.schedules, color: "text-zinc-300" },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Dashboard</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {statCards.map((s) => (
          <div
            key={s.label}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-4"
          >
            <p className="text-xs text-zinc-500 uppercase tracking-wide">
              {s.label}
            </p>
            <p className={`text-2xl font-mono font-bold mt-1 ${s.color}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Recent PRs */}
      {stats.recentPrs.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-3">
            Recent PRs
          </h3>
          <ul className="space-y-2">
            {stats.recentPrs.map((pr) => (
              <li
                key={pr.taskId}
                className="flex items-center justify-between text-sm"
              >
                <Link
                  to={`/tasks/${pr.taskId}`}
                  className="text-zinc-200 hover:text-white"
                >
                  {pr.title}
                </Link>
                <a
                  href={pr.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-xs font-mono"
                >
                  PR
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Empty state */}
      {stats.tasks.total === 0 && (
        <div className="text-center py-12 bg-zinc-900 border border-zinc-800 rounded-lg">
          <p className="text-zinc-400 mb-2">No tasks yet</p>
          <Link
            to="/tasks"
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            Create your first task
          </Link>
        </div>
      )}
    </div>
  );
}
