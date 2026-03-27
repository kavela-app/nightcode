import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/TaskDetail";
import Repos from "./pages/Repos";
import Schedules from "./pages/Schedules";
import Settings from "./pages/Settings";
import Setup from "./pages/Setup";
import { api } from "./api/client";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    checkSetup();
  }, []);

  async function checkSetup() {
    try {
      const res = await api.getSetupStatus();
      // Store auth token for subsequent API calls
      if (res.data.authToken) {
        localStorage.setItem("nightcode_token", res.data.authToken);
      }
      setNeedsSetup(res.data.needsSetup);
    } catch {
      // Server not ready, show setup anyway
      setNeedsSetup(true);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading...</div>
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
        <Route path="/schedules" element={<Schedules />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
