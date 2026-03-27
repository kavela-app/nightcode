import { useEffect, useState } from "react";
import { api } from "../api/client";

export default function Settings() {
  const [claudeStatus, setClaudeStatus] = useState<{ ok: boolean; error?: string } | null>(null);
  const [githubStatus, setGithubStatus] = useState<{ ok: boolean; error?: string } | null>(null);
  const [kavelaKey, setKavelaKey] = useState("");
  const [kavelaPlaceholder, setKavelaPlaceholder] = useState("kav_xxxxx");
  const [kavelaStatus, setKavelaStatus] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState("");

  // Claude OAuth login state
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [authCode, setAuthCode] = useState("");
  const [authCodeSubmitting, setAuthCodeSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [useApiKey, setUseApiKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeySubmitting, setApiKeySubmitting] = useState(false);
  const [apiKeyError, setApiKeyError] = useState("");

  useEffect(() => {
    testClaude();
    testGithub();
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const res = await api.getSettings();
      if (res.data?.kavela_api_key) {
        setKavelaStatus({ ok: true });
        setKavelaPlaceholder(res.data.kavela_api_key);
      }
    } catch {
      // Settings not available yet
    }
  }

  async function testClaude() {
    setTesting("claude");
    try {
      const res = await api.testClaude();
      setClaudeStatus(res.data);
    } catch {
      setClaudeStatus({ ok: false, error: "Failed to connect to API" });
    }
    setTesting("");
  }

  async function testGithub() {
    setTesting("github");
    try {
      const res = await api.testGithub();
      setGithubStatus(res.data);
    } catch {
      setGithubStatus({ ok: false, error: "Failed to test SSH" });
    }
    setTesting("");
  }

  async function testKavela() {
    if (!kavelaKey) return;
    setTesting("kavela");
    try {
      const res = await api.testKavela(kavelaKey);
      setKavelaStatus(res.data);
      if (res.data.ok) {
        await api.updateSettings({ kavela_api_key: kavelaKey });
      }
    } catch {
      setKavelaStatus({ ok: false, error: "Failed to test connection" });
    }
    setTesting("");
  }

  async function startLogin() {
    setLoginLoading(true);
    setAuthError("");
    try {
      const res = await api.startClaudeLogin();
      if (res.data.loginUrl) {
        setLoginUrl(res.data.loginUrl);
        window.open(res.data.loginUrl, "_blank");
      } else if (!res.data.error) {
        // Already logged in
        await testClaude();
      }
    } catch {
      setAuthError("Failed to start login");
    }
    setLoginLoading(false);
  }

  async function submitCode() {
    if (!authCode.trim()) return;
    setAuthCodeSubmitting(true);
    setAuthError("");
    try {
      const res = await api.submitAuthCode(authCode.trim());
      if (res.data.ok) {
        setLoginUrl(null);
        setAuthCode("");
        await testClaude();
      } else {
        setAuthError(res.data.error || "Login failed");
        setAuthCode("");
        setLoginUrl(null);
      }
    } catch {
      setAuthError("Connection failed");
    }
    setAuthCodeSubmitting(false);
  }

  async function saveApiKey() {
    if (!apiKey.trim()) return;
    setApiKeySubmitting(true);
    setApiKeyError("");
    try {
      const res = await api.setClaudeApiKey(apiKey.trim());
      if (res.data.ok) {
        setApiKey("");
        setUseApiKey(false);
        await testClaude();
      } else {
        setApiKeyError(res.data.error || "Failed");
      }
    } catch {
      setApiKeyError("Connection failed");
    }
    setApiKeySubmitting(false);
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Settings</h2>

      <div className="space-y-4">
        {/* Claude Code Auth */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-zinc-200">
                Claude Code Authentication
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Log in with Claude Max or set an API key
              </p>
            </div>
            <div className="flex items-center gap-2">
              {claudeStatus && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    claudeStatus.ok
                      ? "bg-green-900/30 text-green-400"
                      : "bg-red-900/30 text-red-400"
                  }`}
                >
                  {claudeStatus.ok ? "Connected" : "Not connected"}
                </span>
              )}
              <button
                onClick={testClaude}
                disabled={testing === "claude"}
                className="text-xs bg-zinc-800 text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded disabled:opacity-50"
              >
                {testing === "claude" ? "Testing..." : "Test"}
              </button>
            </div>
          </div>

          {claudeStatus && !claudeStatus.ok && (
            <div className="mt-3 space-y-3">
              {authError && (
                <p className="text-xs text-red-400">{authError}</p>
              )}

              {!useApiKey && !loginUrl && (
                <button
                  onClick={startLogin}
                  disabled={loginLoading}
                  className="w-full bg-orange-600 hover:bg-orange-500 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {loginLoading ? "Starting login..." : "Log in with Claude Max"}
                </button>
              )}

              {!useApiKey && loginUrl && (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-400">
                    Complete the login in the browser tab, then paste the code below.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Paste auth code here..."
                      value={authCode}
                      onChange={(e) => { setAuthCode(e.target.value); setAuthError(""); }}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
                    />
                    <button
                      onClick={submitCode}
                      disabled={authCodeSubmitting || !authCode.trim()}
                      className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                    >
                      {authCodeSubmitting ? "..." : "Submit"}
                    </button>
                  </div>
                  <button
                    onClick={() => window.open(loginUrl, "_blank")}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Open login link again
                  </button>
                </div>
              )}

              {useApiKey && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="sk-ant-..."
                      value={apiKey}
                      onChange={(e) => { setApiKey(e.target.value); setApiKeyError(""); }}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
                    />
                    <button
                      onClick={saveApiKey}
                      disabled={apiKeySubmitting || !apiKey.trim()}
                      className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                    >
                      {apiKeySubmitting ? "..." : "Save"}
                    </button>
                  </div>
                  {apiKeyError && <p className="text-xs text-red-400">{apiKeyError}</p>}
                </div>
              )}

              <button
                onClick={() => {
                  setUseApiKey(!useApiKey);
                  setLoginUrl(null);
                  setAuthCode("");
                  setApiKey("");
                  setAuthError("");
                  setApiKeyError("");
                }}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                {useApiKey ? "Use Claude Max login instead" : "Use an API key instead"}
              </button>
            </div>
          )}
        </div>

        {/* GitHub SSH */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-zinc-200">
                GitHub SSH Access
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                SSH keys mounted from ~/.ssh
              </p>
            </div>
            <div className="flex items-center gap-2">
              {githubStatus && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    githubStatus.ok
                      ? "bg-green-900/30 text-green-400"
                      : "bg-red-900/30 text-red-400"
                  }`}
                >
                  {githubStatus.ok ? "Connected" : "Not connected"}
                </span>
              )}
              <button
                onClick={testGithub}
                disabled={testing === "github"}
                className="text-xs bg-zinc-800 text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded disabled:opacity-50"
              >
                {testing === "github" ? "Testing..." : "Test"}
              </button>
            </div>
          </div>
          {githubStatus && !githubStatus.ok && (
            <p className="text-xs text-red-400 mt-2">
              {githubStatus.error || "SSH access failed."}
              <br />
              Ensure ~/.ssh contains your GitHub SSH keys.
            </p>
          )}
        </div>

        {/* Kavela MCP */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-medium text-zinc-200">
                Kavela MCP Integration
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Optional — adds team context to every task
              </p>
            </div>
            {kavelaStatus && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  kavelaStatus.ok
                    ? "bg-green-900/30 text-green-400"
                    : "bg-red-900/30 text-red-400"
                }`}
              >
                {kavelaStatus.ok ? "Connected" : "Not connected"}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={kavelaPlaceholder}
              value={kavelaKey}
              onChange={(e) => setKavelaKey(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono"
            />
            <button
              onClick={testKavela}
              disabled={testing === "kavela" || !kavelaKey}
              className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
            >
              {testing === "kavela" ? "Testing..." : "Connect"}
            </button>
          </div>
          <p className="text-xs text-zinc-600 mt-2">
            Get your API key at{" "}
            <a
              href="https://kavela.ai/dashboard?settings=apikeys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300"
            >
              kavela.ai/dashboard
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
