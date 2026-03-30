import { useEffect, useState } from "react";
import { api, type SetupStatus } from "../api/client";

interface SetupProps {
  onComplete: () => void;
}

type Step = "welcome" | "claude" | "github" | "kavela" | "repo" | "access" | "done";

export default function Setup({ onComplete }: SetupProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [testing, setTesting] = useState("");
  const [kavelaKey, setKavelaKey] = useState("");
  const [kavelaResult, setKavelaResult] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);
  const [ghCliStatus, setGhCliStatus] = useState<{ ok: boolean; user?: string; error?: string } | null>(null);
  const [ghToken, setGhToken] = useState("");
  const [ghTokenSubmitting, setGhTokenSubmitting] = useState(false);
  const [ghTokenError, setGhTokenError] = useState("");
  const [repoForm, setRepoForm] = useState({
    name: "",
    url: "",
    branch: "main",
  });
  const [repoError, setRepoError] = useState("");
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [authCode, setAuthCode] = useState("");
  const [authCodeSubmitting, setAuthCodeSubmitting] = useState(false);
  const [authCodeError, setAuthCodeError] = useState("");
  const [useApiKey, setUseApiKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeySubmitting, setApiKeySubmitting] = useState(false);
  const [apiKeyError, setApiKeyError] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [publicUrlSaved, setPublicUrlSaved] = useState(false);

  // Tailscale state
  const [tsStatus, setTsStatus] = useState<{ installed: boolean; running: boolean; url: string | null } | null>(null);
  const [tsAuthKey, setTsAuthKey] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [tsError, setTsError] = useState("");

  useEffect(() => {
    loadStatus();
    testGhCli();
  }, []);

  async function loadStatus() {
    try {
      const res = await api.getSetupStatus();
      setStatus(res.data);
      // Store auth token for subsequent API calls
      if (res.data.authToken) {
        localStorage.setItem("nightcode_token", res.data.authToken);
      }
    } catch {
      // Server not ready yet
    }
  }

  async function retestClaude() {
    setTesting("claude");
    try {
      const res = await api.testClaude();
      setStatus((s) => (s ? { ...s, claude: res.data } : s));
    } catch {
      /* ignore */
    }
    setTesting("");
  }

  async function retestGithub() {
    setTesting("github");
    try {
      const res = await api.testGithub();
      setStatus((s) => (s ? { ...s, github: res.data } : s));
    } catch {
      /* ignore */
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
      setKavelaResult(res.data);
      if (res.data.ok) {
        await api.updateSettings({ kavela_api_key: kavelaKey });
      }
    } catch {
      setKavelaResult({ ok: false, error: "Connection failed" });
    }
    setTesting("");
  }

  async function checkTailscale() {
    try {
      const res = await api.getTailscaleStatus();
      setTsStatus(res.data);
      if (res.data.url) {
        setPublicUrl(res.data.url);
        setPublicUrlSaved(true);
      }
    } catch { /* ignore */ }
  }

  async function handleTsConnect() {
    if (!tsAuthKey.trim()) return;
    setTsConnecting(true);
    setTsError("");
    try {
      const res = await api.connectTailscale(tsAuthKey.trim());
      if (res.data.ok) {
        setTsAuthKey("");
        if (res.data.url) {
          setPublicUrl(res.data.url);
          setPublicUrlSaved(true);
        }
        await checkTailscale();
      } else {
        setTsError(res.data.error || "Connection failed");
      }
    } catch {
      setTsError("Connection failed");
    }
    setTsConnecting(false);
  }

  // Check Tailscale when entering the access step
  useEffect(() => {
    if (step === "access") {
      checkTailscale();
    }
  }, [step]);

  async function addRepo() {
    setRepoError("");
    if (!repoForm.name || !repoForm.url) {
      setRepoError("Name and URL are required");
      return;
    }
    try {
      await api.createRepo(repoForm);
      setStep("access");
    } catch (err) {
      setRepoError(err instanceof Error ? err.message : "Failed to add repo");
    }
  }

  if (!status) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500">Connecting to nightcode...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            nightcode
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            your code ships while you dream
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {(
            ["welcome", "claude", "github", "kavela", "repo", "access", "done"] as Step[]
          ).map((s, i) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                s === step
                  ? "bg-blue-500"
                  : i <
                      [
                        "welcome",
                        "claude",
                        "github",
                        "kavela",
                        "repo",
                        "access",
                        "done",
                      ].indexOf(step)
                    ? "bg-blue-500/40"
                    : "bg-zinc-700"
              }`}
            />
          ))}
        </div>

        {/* Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          {/* Welcome */}
          {step === "welcome" && (
            <div className="text-center space-y-4">
              <div className="text-4xl mb-2">
                {"\u{1F319}"}
              </div>
              <h2 className="text-lg font-semibold">Welcome to nightcode</h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Queue coding tasks for Claude Code to run autonomously while you
                sleep. Wake up to PRs.
              </p>
              <p className="text-sm text-zinc-500">
                Let's verify your setup in a few quick steps.
              </p>
              <button
                onClick={() => setStep("claude")}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg text-sm font-medium mt-4"
              >
                Get Started
              </button>
            </div>
          )}

          {/* Claude Auth */}
          {step === "claude" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">
                Claude Code Authentication
              </h2>
              <p className="text-sm text-zinc-400">
                Log in with your Claude Max subscription to let nightcode run
                tasks using your credits.
              </p>

              <div
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  status.claude.ok
                    ? "bg-green-950/30 border-green-800/50"
                    : "bg-zinc-800/50 border-zinc-700/50"
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                    status.claude.ok
                      ? "bg-green-900/50 text-green-400"
                      : "bg-zinc-700/50 text-zinc-400"
                  }`}
                >
                  {status.claude.ok ? "\u2713" : "\u2717"}
                </div>
                <div className="flex-1">
                  <p
                    className={`text-sm font-medium ${status.claude.ok ? "text-green-300" : "text-zinc-300"}`}
                  >
                    {status.claude.ok
                      ? "Claude Code is authenticated"
                      : "Not logged in yet"}
                  </p>
                </div>
                {status.claude.ok && (
                  <button
                    onClick={retestClaude}
                    disabled={testing === "claude"}
                    className="text-xs bg-zinc-800 text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded disabled:opacity-50"
                  >
                    {testing === "claude" ? "Testing..." : "Retest"}
                  </button>
                )}
              </div>

              {!status.claude.ok && !useApiKey && !loginUrl && (
                <div className="space-y-2">
                  {authCodeError && (
                    <p className="text-xs text-red-400">{authCodeError}</p>
                  )}
                  <button
                    onClick={async () => {
                      setLoginLoading(true);
                      setAuthCodeError("");
                      try {
                        const res = await api.startClaudeLogin();
                        if (res.data.loginUrl) {
                          setLoginUrl(res.data.loginUrl);
                          window.open(res.data.loginUrl, "_blank");
                        } else if (!res.data.error) {
                          await loadStatus();
                        }
                      } catch {
                        /* ignore */
                      }
                      setLoginLoading(false);
                    }}
                    disabled={loginLoading}
                    className="w-full bg-orange-600 hover:bg-orange-500 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {loginLoading
                      ? "Starting login..."
                      : "Log in with Claude Max"}
                  </button>
                </div>
              )}

              {!status.claude.ok && !useApiKey && loginUrl && (
                <div className="space-y-3">
                  <div className="bg-zinc-800/50 rounded-lg p-3 text-sm text-zinc-300 space-y-2">
                    <p>
                      Complete the login in the browser tab, then paste the
                      authentication code below.
                    </p>
                    <p className="text-xs text-zinc-500 break-all font-mono">
                      {loginUrl}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Paste auth code here..."
                      value={authCode}
                      onChange={(e) => {
                        setAuthCode(e.target.value);
                        setAuthCodeError("");
                      }}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
                    />
                    <button
                      onClick={async () => {
                        if (!authCode.trim()) return;
                        setAuthCodeSubmitting(true);
                        setAuthCodeError("");
                        try {
                          const res = await api.submitAuthCode(authCode.trim());
                          if (res.data.ok) {
                            setLoginUrl(null);
                            setAuthCode("");
                            // Use loadStatus (no auth required) instead of retestClaude (behind auth middleware)
                            await loadStatus();
                          } else {
                            // Show error but keep the auth code form visible so user can retry
                            setAuthCodeError(res.data.error || "Login failed");
                            setAuthCode("");
                            // Reset login URL so user gets a fresh login button with visible error
                            setLoginUrl(null);
                          }
                        } catch {
                          setAuthCodeError("Connection failed");
                        }
                        setAuthCodeSubmitting(false);
                      }}
                      disabled={authCodeSubmitting || !authCode.trim()}
                      className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      {authCodeSubmitting ? "..." : "Submit"}
                    </button>
                  </div>
                  {authCodeError && (
                    <p className="text-xs text-red-400">{authCodeError}</p>
                  )}
                  <button
                    onClick={() => window.open(loginUrl, "_blank")}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Open login link again
                  </button>
                </div>
              )}

              {!status.claude.ok && useApiKey && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="sk-ant-..."
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setApiKeyError("");
                      }}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
                    />
                    <button
                      onClick={async () => {
                        if (!apiKey.trim()) return;
                        setApiKeySubmitting(true);
                        setApiKeyError("");
                        try {
                          const res = await api.setClaudeApiKey(apiKey.trim());
                          if (res.data.ok) {
                            setApiKey("");
                            await retestClaude();
                          } else {
                            setApiKeyError(res.data.error || "Failed");
                          }
                        } catch {
                          setApiKeyError("Connection failed");
                        }
                        setApiKeySubmitting(false);
                      }}
                      disabled={apiKeySubmitting || !apiKey.trim()}
                      className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      {apiKeySubmitting ? "..." : "Save"}
                    </button>
                  </div>
                  {apiKeyError && (
                    <p className="text-xs text-red-400">{apiKeyError}</p>
                  )}
                  <p className="text-xs text-zinc-600">
                    Get your API key from the{" "}
                    <a
                      href="https://console.anthropic.com/settings/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300"
                    >
                      Anthropic Console
                    </a>
                  </p>
                </div>
              )}

              {!status.claude.ok && (
                <button
                  onClick={() => {
                    setUseApiKey(!useApiKey);
                    setLoginUrl(null);
                    setAuthCode("");
                    setApiKey("");
                    setAuthCodeError("");
                    setApiKeyError("");
                  }}
                  className="w-full text-xs text-zinc-500 hover:text-zinc-300 py-1"
                >
                  {useApiKey
                    ? "Use Claude Max login instead"
                    : "Use an API key instead"}
                </button>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep("welcome")}
                  className="px-4 py-2.5 text-sm text-zinc-400 hover:text-zinc-200"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep("github")}
                  className={status.claude.ok
                    ? "flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg text-sm font-medium"
                    : "px-4 py-2.5 text-sm text-zinc-500 hover:text-zinc-300"
                  }
                >
                  {status.claude.ok ? "Next" : "Skip for now"}
                </button>
              </div>
            </div>
          )}

          {/* GitHub SSH */}
          {step === "github" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">GitHub SSH Access</h2>
              <p className="text-sm text-zinc-400">
                SSH keys are mounted from ~/.ssh for pushing code and creating
                PRs.
              </p>

              <div
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  status.github.ok
                    ? "bg-green-950/30 border-green-800/50"
                    : "bg-red-950/30 border-red-800/50"
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                    status.github.ok
                      ? "bg-green-900/50 text-green-400"
                      : "bg-red-900/50 text-red-400"
                  }`}
                >
                  {status.github.ok ? "\u2713" : "\u2717"}
                </div>
                <div className="flex-1">
                  <p
                    className={`text-sm font-medium ${status.github.ok ? "text-green-300" : "text-red-300"}`}
                  >
                    {status.github.ok
                      ? "GitHub SSH connected"
                      : "SSH not connected"}
                  </p>
                  {!status.github.ok && (
                    <p className="text-xs text-red-400/70 mt-0.5">
                      {status.github.error || "Ensure ~/.ssh has your keys"}
                    </p>
                  )}
                </div>
                <button
                  onClick={retestGithub}
                  disabled={testing === "github"}
                  className="text-xs bg-zinc-800 text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded disabled:opacity-50"
                >
                  {testing === "github" ? "Testing..." : "Retest"}
                </button>
              </div>

              {!status.github.ok && (
                <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-zinc-400 space-y-1">
                  <p className="font-medium text-zinc-300">To fix this:</p>
                  <p>1. Ensure ~/.ssh contains your GitHub SSH keys</p>
                  <p>
                    2. The docker-compose mounts ~/.ssh as read-only
                  </p>
                  <p>3. Restart the container after adding keys</p>
                </div>
              )}

              {/* GitHub CLI Auth */}
              <div
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  ghCliStatus?.ok
                    ? "bg-green-950/30 border-green-800/50"
                    : "bg-zinc-800/50 border-zinc-700/50"
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                    ghCliStatus?.ok
                      ? "bg-green-900/50 text-green-400"
                      : "bg-zinc-700/50 text-zinc-400"
                  }`}
                >
                  {ghCliStatus?.ok ? "\u2713" : "\u2717"}
                </div>
                <div className="flex-1">
                  <p
                    className={`text-sm font-medium ${ghCliStatus?.ok ? "text-green-300" : "text-zinc-300"}`}
                  >
                    {ghCliStatus?.ok
                      ? `GitHub CLI connected${ghCliStatus.user ? ` as @${ghCliStatus.user}` : ""}`
                      : "GitHub CLI not authenticated"}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Used for creating pull requests
                  </p>
                </div>
                {ghCliStatus?.ok && (
                  <button
                    onClick={testGhCli}
                    disabled={testing === "ghcli"}
                    className="text-xs bg-zinc-800 text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded disabled:opacity-50"
                  >
                    {testing === "ghcli" ? "Testing..." : "Retest"}
                  </button>
                )}
              </div>

              {ghCliStatus && !ghCliStatus.ok && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="ghp_xxxxxxxxxxxx"
                      value={ghToken}
                      onChange={(e) => { setGhToken(e.target.value); setGhTokenError(""); }}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
                    />
                    <button
                      onClick={submitGhToken}
                      disabled={ghTokenSubmitting || !ghToken.trim()}
                      className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      {ghTokenSubmitting ? "..." : "Authenticate"}
                    </button>
                  </div>
                  {ghTokenError && <p className="text-xs text-red-400">{ghTokenError}</p>}
                  <p className="text-xs text-zinc-600">
                    Create a GitHub Personal Access Token:
                    <span className="block mt-2 text-zinc-500 leading-relaxed space-y-1.5">
                      <span className="block">
                        <strong className="text-zinc-300">Option A:</strong>{" "}
                        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Fine-grained token</a>
                        {" "}&mdash; scope to specific repos (own or org repos only)
                        <br />
                        <span className="text-zinc-600 text-[11px]">Permissions: Contents (R/W), Pull requests (R/W), Metadata (R). Org repos: add Members (R)</span>
                      </span>
                      <span className="block">
                        <strong className="text-zinc-300">Option B:</strong>{" "}
                        <a href="https://github.com/settings/tokens/new?scopes=repo,read:org&description=nightcode" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Classic token</a>
                        {" "}&mdash; needed for repos you{"'"}re a collaborator on
                        <br />
                        <span className="text-zinc-600 text-[11px]">Scopes: repo, read:org</span>
                      </span>
                    </span>
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep("claude")}
                  className="px-4 py-2.5 text-sm text-zinc-400 hover:text-zinc-200"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep("kavela")}
                  className={status.github.ok
                    ? "flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg text-sm font-medium"
                    : "px-4 py-2.5 text-sm text-zinc-500 hover:text-zinc-300"
                  }
                >
                  {status.github.ok ? "Next" : "Skip for now"}
                </button>
              </div>
            </div>
          )}

          {/* Kavela MCP */}
          {step === "kavela" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Kavela MCP</h2>
                <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
                  Optional
                </span>
              </div>
              <p className="text-sm text-zinc-400">
                Connect Kavela to inject your team's coding standards,
                architecture patterns, and knowledge into every task.
              </p>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="kav_xxxxx"
                    value={kavelaKey}
                    onChange={(e) => { setKavelaKey(e.target.value); setKavelaResult(null); }}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
                  />
                  <button
                    onClick={testKavela}
                    disabled={testing === "kavela" || !kavelaKey}
                    className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                  >
                    {testing === "kavela" ? "Testing..." : "Test"}
                  </button>
                </div>
                {kavelaResult && (
                  <p
                    className={`text-xs ${kavelaResult.ok ? "text-green-400" : "text-red-400"}`}
                  >
                    {kavelaResult.ok
                      ? "Connected and saved!"
                      : kavelaResult.error || "Connection failed"}
                  </p>
                )}
                <p className="text-xs text-zinc-600">
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

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep("github")}
                  className="px-4 py-2.5 text-sm text-zinc-400 hover:text-zinc-200"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep("repo")}
                  className={kavelaResult?.ok
                    ? "flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg text-sm font-medium"
                    : "px-4 py-2.5 text-sm text-zinc-500 hover:text-zinc-300"
                  }
                >
                  {kavelaResult?.ok ? "Next" : "Skip"}
                </button>
              </div>
            </div>
          )}

          {/* Add First Repo */}
          {step === "repo" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Add Your First Repo</h2>
              <p className="text-sm text-zinc-400">
                Which repository should nightcode work on?
              </p>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    placeholder="my-api"
                    value={repoForm.name}
                    onChange={(e) => {
                      setRepoForm({ ...repoForm, name: e.target.value });
                      setRepoError("");
                    }}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-zinc-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">
                    Git URL
                  </label>
                  <input
                    type="text"
                    placeholder="git@github.com:org/repo.git"
                    value={repoForm.url}
                    onChange={(e) => {
                      setRepoForm({ ...repoForm, url: e.target.value });
                      setRepoError("");
                    }}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">
                    Branch
                  </label>
                  <input
                    type="text"
                    placeholder="main"
                    value={repoForm.branch}
                    onChange={(e) => {
                      setRepoForm({ ...repoForm, branch: e.target.value });
                      setRepoError("");
                    }}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-zinc-600"
                  />
                </div>
              </div>

              {repoError && (
                <p className="text-xs text-red-400">{repoError}</p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep("kavela")}
                  className="px-4 py-2.5 text-sm text-zinc-400 hover:text-zinc-200"
                >
                  Back
                </button>
                <button
                  onClick={addRepo}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg text-sm font-medium"
                >
                  Add Repo
                </button>
              </div>
            </div>
          )}

          {/* Public Access */}
          {step === "access" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Public Access</h2>
                <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
                  Optional
                </span>
              </div>
              <p className="text-sm text-zinc-400">
                Make nightcode accessible remotely so you can control it from
                other devices, connect Lark bots, or call the agent API from
                anywhere.
              </p>

              {/* Tailscale installed + connected */}
              {tsStatus?.installed && tsStatus.running && (
                <div className="flex items-center gap-3 p-3 rounded-lg border bg-green-950/30 border-green-800/50">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm bg-green-900/50 text-green-400">
                    {"\u2713"}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-300">Tailscale is connected!</p>
                    {tsStatus.url && (
                      <p className="text-xs text-green-400/70 font-mono mt-0.5">{tsStatus.url}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Tailscale installed but not connected */}
              {tsStatus?.installed && !tsStatus.running && (
                <div className="space-y-3">
                  <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-zinc-400 space-y-2">
                    <p className="font-medium text-zinc-300">Tailscale is available. Paste your auth key to connect.</p>
                    <p className="text-zinc-500">
                      Generate a key at{" "}
                      <a href="https://login.tailscale.com/admin/settings/keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                        Tailscale Admin &rarr; Settings &rarr; Keys
                      </a>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="tskey-auth-xxxxx"
                      value={tsAuthKey}
                      onChange={(e) => { setTsAuthKey(e.target.value); setTsError(""); }}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
                    />
                    <button
                      onClick={handleTsConnect}
                      disabled={tsConnecting || !tsAuthKey.trim()}
                      className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      {tsConnecting ? "Connecting..." : "Connect"}
                    </button>
                  </div>
                  {tsError && <p className="text-xs text-red-400">{tsError}</p>}
                </div>
              )}

              {/* Tailscale not installed */}
              {tsStatus && !tsStatus.installed && (
                <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-zinc-400 space-y-3">
                  <div>
                    <p className="font-medium text-zinc-300 mb-1">Option A: Built-in Tailscale (recommended for VPS)</p>
                    <p className="font-mono">
                      <code className="text-zinc-300 bg-zinc-900 px-1 rounded text-[11px]">docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d --build</code>
                    </p>
                    <p className="text-zinc-500 mt-1">Installs Tailscale inside the container. Return to this page after rebuild.</p>
                  </div>
                  <div className="border-t border-zinc-700 pt-3">
                    <p className="font-medium text-zinc-300 mb-1">Option B: Host-level Tailscale (for local machines)</p>
                    <div className="space-y-1.5 font-mono">
                      <p><span className="text-zinc-600 select-none">1.</span> <code className="text-zinc-300">curl -fsSL https://tailscale.com/install.sh | sh</code></p>
                      <p><span className="text-zinc-600 select-none">2.</span> <code className="text-zinc-300">tailscale up</code></p>
                      <p><span className="text-zinc-600 select-none">3.</span> <code className="text-zinc-300">tailscale funnel 3777</code></p>
                    </div>
                    <p className="text-zinc-500 mt-1">Copy the HTTPS URL from the output and paste it below.</p>
                  </div>
                </div>
              )}

              {/* Still loading Tailscale status */}
              {!tsStatus && (
                <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-zinc-500">
                  Checking Tailscale status...
                </div>
              )}

              {/* Manual URL input (always shown unless Tailscale is connected with URL) */}
              {!(tsStatus?.running && tsStatus.url) && (
                <div className="space-y-2">
                  <label className="text-xs text-zinc-500 block">
                    Public URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="https://nightcode.your-tailnet.ts.net"
                      value={publicUrl}
                      onChange={(e) => { setPublicUrl(e.target.value); setPublicUrlSaved(false); }}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
                    />
                    {publicUrl && (
                      <button
                        onClick={async () => {
                          await api.updateSettings({ nightcode_url: publicUrl.replace(/\/+$/, "") });
                          setPublicUrlSaved(true);
                        }}
                        className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-2 rounded-lg text-sm"
                      >
                        {publicUrlSaved ? "Saved!" : "Save"}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-zinc-600">
                    Used in PR backlinks, agent API, and Lark integration. Can be changed later in Settings.
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep("repo")}
                  className="px-4 py-2.5 text-sm text-zinc-400 hover:text-zinc-200"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep("done")}
                  className={publicUrlSaved
                    ? "flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg text-sm font-medium"
                    : "px-4 py-2.5 text-sm text-zinc-500 hover:text-zinc-300"
                  }
                >
                  {publicUrlSaved ? "Next" : "Skip \u2014 keep local only"}
                </button>
              </div>
            </div>
          )}

          {/* Done */}
          {step === "done" && (
            <div className="text-center space-y-4">
              <div className="text-4xl mb-2">
                {"\u{1F680}"}
              </div>
              <h2 className="text-lg font-semibold">You're all set!</h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                nightcode is ready. Create your first task, schedule it, and let
                Claude Code work while you sleep.
              </p>

              <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-zinc-500 text-left space-y-1">
                <p>
                  <span className={status.claude.ok ? "text-green-400" : "text-red-400"}>
                    {status.claude.ok ? "\u2713" : "\u2717"}
                  </span>{" "}
                  Claude Code
                </p>
                <p>
                  <span className={status.github.ok ? "text-green-400" : "text-red-400"}>
                    {status.github.ok ? "\u2713" : "\u2717"}
                  </span>{" "}
                  GitHub SSH
                </p>
                <p>
                  <span className={ghCliStatus?.ok ? "text-green-400" : "text-red-400"}>
                    {ghCliStatus?.ok ? "\u2713" : "\u2717"}
                  </span>{" "}
                  GitHub CLI
                </p>
                <p>
                  <span className={kavelaResult?.ok ? "text-green-400" : "text-zinc-600"}>
                    {kavelaResult?.ok ? "\u2713" : "\u2014"}
                  </span>{" "}
                  Kavela MCP
                </p>
                <p>
                  <span className="text-green-400">{"\u2713"}</span> Repo added
                </p>
                <p>
                  <span className={publicUrlSaved ? "text-green-400" : "text-zinc-600"}>
                    {publicUrlSaved ? "\u2713" : "\u2014"}
                  </span>{" "}
                  Public access{publicUrlSaved ? `: ${publicUrl}` : ""}
                </p>
              </div>

              <button
                onClick={onComplete}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg text-sm font-medium"
              >
                Open Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
