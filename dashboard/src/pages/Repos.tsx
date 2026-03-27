import { useEffect, useState } from "react";
import { api, type Repo } from "../api/client";

export default function Repos() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", branch: "main", systemPrompt: "" });
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; error?: string }>>({});

  useEffect(() => { load(); }, []);

  async function load() {
    const res = await api.getRepos();
    setRepos(res.data);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api.createRepo(form);
    setShowCreate(false);
    setForm({ name: "", url: "", branch: "main", systemPrompt: "" });
    load();
  }

  async function handleTest(id: number) {
    const res = await api.testConnection(id);
    setTestResults((prev) => ({ ...prev, [id]: res.data }));
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this repo and all its tasks?")) return;
    await api.deleteRepo(id);
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Repositories</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-sm"
        >
          + Add Repo
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Repo name (e.g., my-api)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              required
            />
            <input
              type="text"
              placeholder="Branch (default: main)"
              value={form.branch}
              onChange={(e) => setForm({ ...form, branch: e.target.value })}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
            />
          </div>
          <input
            type="text"
            placeholder="Git URL (e.g., git@github.com:org/repo.git)"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
            required
          />
          <textarea
            placeholder="System prompt (optional) — instructions Claude should always follow for this repo"
            value={form.systemPrompt}
            onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm h-20 resize-y"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-zinc-400">Cancel</button>
            <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-sm">Add Repo</button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {repos.length === 0 && <p className="text-zinc-500 text-center py-8">No repos added yet.</p>}
        {repos.map((repo) => (
          <div key={repo.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-200">{repo.name}</p>
                <p className="text-xs text-zinc-500 font-mono mt-0.5">{repo.url}</p>
                <p className="text-xs text-zinc-600 mt-0.5">branch: {repo.branch}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleTest(repo.id)}
                  className="text-xs bg-zinc-800 text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded"
                >
                  Test SSH
                </button>
                <button
                  onClick={() => handleDelete(repo.id)}
                  className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
                >
                  Delete
                </button>
              </div>
            </div>
            {testResults[repo.id] && (
              <p className={`text-xs mt-2 ${testResults[repo.id].ok ? "text-green-400" : "text-red-400"}`}>
                {testResults[repo.id].ok ? "SSH connection OK" : `Failed: ${testResults[repo.id].error}`}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
