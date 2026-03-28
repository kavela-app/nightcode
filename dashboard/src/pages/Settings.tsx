import { useEffect, useState } from "react";
import { api } from "../api/client";

export default function Settings() {
  const [claudeStatus, setClaudeStatus] = useState<{ ok: boolean; error?: string } | null>(null);
  const [githubStatus, setGithubStatus] = useState<{ ok: boolean; error?: string } | null>(null);
  const [ghCliStatus, setGhCliStatus] = useState<{ ok: boolean; user?: string; error?: string } | null>(null);
  const [ghToken, setGhToken] = useState("");
  const [ghTokenSubmitting, setGhTokenSubmitting] = useState(false);
  const [ghTokenError, setGhTokenError] = useState("");
  const [kavelaKey, setKavelaKey] = useState("");
  const [kavelaPlaceholder, setKavelaPlaceholder] = useState("kav_xxxxx");
  const [kavelaStatus, setKavelaStatus] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState("");

  // Token rotation state
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

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

  // Custom system prompt
  const [customPrompt, setCustomPrompt] = useState("");
  const [customPromptSaved, setCustomPromptSaved] = useState(false);

  // Nightcode URL
  const [nightcodeUrl, setNightcodeUrl] = useState("");
  const [nightcodeUrlStatus, setNightcodeUrlStatus] = useState<"untested" | "ok" | "failed">("untested");
  const [nightcodeUrlSaved, setNightcodeUrlSaved] = useState(false);

  useEffect(() => {
    testClaude();
    testGithub();
    testGhCli();
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const res = await api.getSettings();
      if (res.data?.kavela_api_key) {
        setKavelaStatus({ ok: true });
        setKavelaPlaceholder(res.data.kavela_api_key);
      }
      if (res.data?.custom_system_prompt) {
        setCustomPrompt(res.data.custom_system_prompt);
      }
      if (res.data?.nightcode_url) {
        setNightcodeUrl(res.data.nightcode_url);
        setNightcodeUrlStatus("ok");
      }
    } catch {
      // Settings not available yet
    }
  }

  async function saveCustomPrompt() {
    try {
      await api.updateSettings({ custom_system_prompt: customPrompt });
      setCustomPromptSaved(true);
      setTimeout(() => setCustomPromptSaved(false), 2000);
    } catch { /* ignore */ }
  }

  async function saveNightcodeUrl() {
    try {
      await api.updateSettings({ nightcode_url: nightcodeUrl });
      setNightcodeUrlSaved(true);
      setNightcodeUrlStatus(nightcodeUrl ? "ok" : "untested");
      setTimeout(() => setNightcodeUrlSaved(false), 2000);
    } catch { /* ignore */ }
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

  async function testGhCli() {
    setTesting("ghcli");
    try {
      const res = await api.testGhAuth();
      setGhCliStatus(res.data);
    } catch {
      setGhCliStatus({ ok: false, error: "Failed to check gh CLI status" });
    }
    setTesting("");
  }

  async function submitGhToken() {
    if (!ghToken.trim()) return;
    setGhTokenSubmitting(true);
    setGhTokenError("");
    try {
      const res = await api.loginGh(ghToken.trim());
      if (res.data.ok) {
        setGhToken("");
        await testGhCli();
      } else {
        setGhTokenError(res.data.error || "Login failed");
      }
    } catch {
      setGhTokenError("Connection failed");
    }
    setGhTokenSubmitting(false);
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

        {/* GitHub CLI */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-zinc-200">
                GitHub CLI Authentication
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Required for creating PRs via <code className="text-zinc-400">gh</code> CLI
              </p>
            </div>
            <div className="flex items-center gap-2">
              {ghCliStatus && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    ghCliStatus.ok
                      ? "bg-green-900/30 text-green-400"
                      : "bg-red-900/30 text-red-400"
                  }`}
                >
                  {ghCliStatus.ok
                    ? `Connected${ghCliStatus.user ? ` as @${ghCliStatus.user}` : ""}`
                    : "Not connected"}
                </span>
              )}
              <button
                onClick={testGhCli}
                disabled={testing === "ghcli"}
                className="text-xs bg-zinc-800 text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded disabled:opacity-50"
              >
                {testing === "ghcli" ? "Testing..." : "Test"}
              </button>
            </div>
          </div>
          {ghCliStatus && !ghCliStatus.ok && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxx"
                  value={ghToken}
                  onChange={(e) => { setGhToken(e.target.value); setGhTokenError(""); }}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
                />
                <button
                  onClick={submitGhToken}
                  disabled={ghTokenSubmitting || !ghToken.trim()}
                  className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                >
                  {ghTokenSubmitting ? "..." : "Authenticate"}
                </button>
              </div>
              {ghTokenError && <p className="text-xs text-red-400">{ghTokenError}</p>}
              <p className="text-xs text-zinc-600">
                <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Fine-grained token</a>
                {" "}for own/org repos (Contents + PRs R/W, Metadata R).{" "}
                <a href="https://github.com/settings/tokens/new?scopes=repo,read:org&description=nightcode" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Classic token</a>
                {" "}for collaborator repos (repo + read:org).
              </p>
            </div>
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

        {/* Custom System Prompt */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-medium text-zinc-200">
                Custom System Prompt
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Prepended to every task step — like a CLAUDE.md for all nightcode tasks
              </p>
            </div>
            {customPromptSaved && (
              <span className="text-xs text-green-400">Saved</span>
            )}
          </div>
          <textarea
            value={customPrompt}
            onChange={(e) => { setCustomPrompt(e.target.value); setCustomPromptSaved(false); }}
            placeholder={"e.g., Always use TypeScript strict mode. Prefer server components over client components. Follow the team's error handling patterns from the API design doc."}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm h-32 resize-y font-mono focus:outline-none focus:border-zinc-600"
          />
          <button
            onClick={saveCustomPrompt}
            className="mt-2 bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-sm"
          >
            Save Prompt
          </button>
        </div>

        {/* Remote Access / Tailscale */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-medium text-zinc-200">
                Remote Access
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Make nightcode accessible from anywhere via Tailscale
              </p>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                nightcodeUrl && nightcodeUrlStatus === "ok"
                  ? "bg-green-900/30 text-green-400"
                  : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {nightcodeUrl ? "Public" : "Local only"}
            </span>
          </div>

          {!nightcodeUrl && (
            <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-zinc-400 space-y-2 mb-3">
              <p className="font-medium text-zinc-300">Quick setup with Tailscale (free):</p>
              <div className="space-y-1.5 font-mono">
                <p><span className="text-zinc-600 select-none">1.</span> <code className="text-zinc-300">curl -fsSL https://tailscale.com/install.sh | sh</code></p>
                <p><span className="text-zinc-600 select-none">2.</span> <code className="text-zinc-300">tailscale up</code></p>
                <p><span className="text-zinc-600 select-none">3.</span> <code className="text-zinc-300">tailscale funnel 3777</code></p>
              </div>
              <p className="text-zinc-500 mt-1">
                Copy the HTTPS URL from the output and paste it below.
                For Docker sidecar setup, see <code className="text-zinc-400">docker-compose.tailscale.yml</code>.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="https://nightcode.your-tailnet.ts.net"
              value={nightcodeUrl}
              onChange={(e) => { setNightcodeUrl(e.target.value); setNightcodeUrlSaved(false); setNightcodeUrlStatus("untested"); }}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
            />
            <button
              onClick={saveNightcodeUrl}
              className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-2 rounded text-sm"
            >
              {nightcodeUrlSaved ? "Saved!" : "Save"}
            </button>
          </div>

          {nightcodeUrl && (
            <div className="mt-2 text-xs text-zinc-500 space-y-1">
              <p>PR backlinks and Lark bots will use this URL.</p>
              <p>Dashboard login required for remote access (token: <code className="text-zinc-400">data/.auth-token</code>).</p>
            </div>
          )}
        </div>

        {/* API Token */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-zinc-200">
                API Auth Token
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Bearer token for API access. Shown once on rotation — store it securely.
              </p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/30 text-green-400">
              Active
            </span>
          </div>

          {/* Show newly generated token (one-time reveal) */}
          {newToken && (
            <div className="mt-3 space-y-2">
              <div className="bg-green-950/30 border border-green-800/50 rounded-lg p-3">
                <p className="text-xs text-green-400 font-medium mb-1">New token generated — copy it now, it won{"'"}t be shown again:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono text-green-300 bg-zinc-950 px-2 py-1.5 rounded select-all break-all">
                    {newToken}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(newToken);
                    }}
                    className="shrink-0 text-xs bg-green-900/50 text-green-300 hover:bg-green-900/70 px-3 py-1.5 rounded"
                  >
                    Copy
                  </button>
                </div>
                <button
                  onClick={() => {
                    // Save to localStorage and reload
                    localStorage.setItem("nightcode_token", newToken);
                    setNewToken(null);
                    window.location.reload();
                  }}
                  className="mt-2 text-xs text-green-400 hover:text-green-300"
                >
                  I{"'"}ve copied it — dismiss and update session
                </button>
              </div>
            </div>
          )}

          {/* Rotate button / confirmation */}
          {!newToken && !showRotateConfirm && (
            <button
              onClick={() => setShowRotateConfirm(true)}
              className="mt-3 text-xs bg-zinc-800 text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded"
            >
              Rotate Token
            </button>
          )}

          {!newToken && showRotateConfirm && (
            <div className="mt-3 bg-red-950/30 border border-red-900/50 rounded-lg p-3 space-y-2">
              <p className="text-xs text-red-300">
                This will invalidate the current token immediately. Any services using it (Lark bots, scripts, other sessions) will lose access.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setRotating(true);
                    try {
                      const res = await api.rotateToken();
                      setNewToken(res.data.token);
                      setShowRotateConfirm(false);
                    } catch {
                      // If this fails the current token still works
                    }
                    setRotating(false);
                  }}
                  disabled={rotating}
                  className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded disabled:opacity-50"
                >
                  {rotating ? "Rotating..." : "Yes, rotate token"}
                </button>
                <button
                  onClick={() => setShowRotateConfirm(false)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
