import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/TaskDetail";
import Repos from "./pages/Repos";
import Schedules from "./pages/Schedules";
import Agent from "./pages/Agent";
import Settings from "./pages/Settings";
import Setup from "./pages/Setup";
import { api } from "./api/client";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [loginToken, setLoginToken] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    checkSetup();
  }, []);

  async function checkSetup() {
    try {
      const res = await api.getSetupStatus();
      // Store auth token if provided (local access only)
      if (res.data.authToken) {
        localStorage.setItem("nightcode_token", res.data.authToken);
      }

      // Check if we need to show login gate (remote access without stored token)
      if (res.data.requiresLogin && !localStorage.getItem("nightcode_token")) {
        setNeedsLogin(true);
      } else if (res.data.requiresLogin && localStorage.getItem("nightcode_token")) {
        // Have a stored token — validate it
        try {
          const check = await api.login(localStorage.getItem("nightcode_token")!);
          if (!check.data.ok) {
            localStorage.removeItem("nightcode_token");
            setNeedsLogin(true);
          }
        } catch {
          localStorage.removeItem("nightcode_token");
          setNeedsLogin(true);
        }
      }

      setNeedsSetup(res.data.needsSetup);
    } catch {
      // Server not ready, show setup anyway
      setNeedsSetup(true);
    }
    setLoading(false);
  }

  async function handleLogin() {
    if (!loginToken.trim()) return;
    setLoginLoading(true);
    setLoginError("");
    try {
      const res = await api.login(loginToken.trim());
      if (res.data.ok) {
        localStorage.setItem("nightcode_token", loginToken.trim());
        setNeedsLogin(false);
        // Re-check setup with the token now set
        checkSetup();
      } else {
        setLoginError(res.data.error || "Invalid token");
      }
    } catch {
      setLoginError("Connection failed");
    }
    setLoginLoading(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (needsLogin) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              nightcode
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              your code ships while you dream
            </p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Sign In</h2>
              <p className="text-sm text-zinc-400 mt-1">
                Enter your nightcode API token to access the dashboard.
              </p>
            </div>

            <div className="space-y-3">
              <input
                type="password"
                placeholder="nc_xxxxxxxxxx"
                value={loginToken}
                onChange={(e) => { setLoginToken(e.target.value); setLoginError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-zinc-600"
                autoFocus
              />

              {loginError && (
                <p className="text-xs text-red-400">{loginError}</p>
              )}

              <button
                onClick={handleLogin}
                disabled={loginLoading || !loginToken.trim()}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {loginLoading ? "Signing in..." : "Sign In"}
              </button>
            </div>

            <p className="text-xs text-zinc-600 text-center">
              Find your token in <code className="text-zinc-500">data/.auth-token</code> or
              the server startup logs.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (needsSetup) {
    return <Setup onComplete={() => setNeedsSetup(false)} />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/repos" element={<Repos />} />
        <Route path="/agent" element={<Agent />} />
        <Route path="/schedules" element={<Schedules />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
