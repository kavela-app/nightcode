import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

export default function StatusAlert() {
  const [issues, setIssues] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  async function checkStatus() {
    const problems: string[] = [];
    try {
      const setup = await api.getSetupStatus();
      if (!setup.data.claude.ok) problems.push("Claude Code not authenticated");
      if (!setup.data.github.ok) problems.push("GitHub SSH not connected");
    } catch {
      // Setup status unavailable
    }
    try {
      const gh = await api.testGhAuth();
      if (!gh.data.ok) problems.push("GitHub CLI token expired");
    } catch {
      // gh CLI check unavailable
    }
    setIssues(problems);
  }

  if (dismissed || issues.length === 0) return null;

  return (
    <div className="bg-red-950/80 border-b border-red-900 px-4 py-2 flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <span className="text-red-400">&#x26A0;</span>
        <span className="text-red-300">
          {issues.join(" \u00B7 ")}
        </span>
        <Link to="/settings" className="text-red-400 hover:text-red-300 underline ml-1">
          Fix in Settings &rarr;
        </Link>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-red-500 hover:text-red-300 text-xs"
      >
        &#x2715;
      </button>
    </div>
  );
}
