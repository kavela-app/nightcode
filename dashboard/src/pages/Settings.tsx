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

  // Workflow customization
  const [showWorkflowSection, setShowWorkflowSection] = useState(false);
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [stepPrompt, setStepPrompt] = useState("");
  const [stepSystemPrompt, setStepSystemPrompt] = useState("");
  const [stepTools, setStepTools] = useState<string[]>([]);
  const [stepResume, setStepResume] = useState(true);
  const [customSteps, setCustomSteps] = useState<Record<string, { prompt: string; systemPrompt: string; allowedTools: string[]; resumeFromPrevious?: boolean }>>({});
  const [stepSaved, setStepSaved] = useState(false);

  const [editingWorkflow, setEditingWorkflow] = useState<string | null>(null);
  const [workflowStepList, setWorkflowStepList] = useState("");
  const [customWorkflows, setCustomWorkflows] = useState<Record<string, string[]>>({});
  const [newWorkflowName, setNewWorkflowName] = useState("");
  const [newWorkflowSteps, setNewWorkflowSteps] = useState("");
  const [workflowSaved, setWorkflowSaved] = useState(false);

  // Nightcode URL
  const [nightcodeUrl, setNightcodeUrl] = useState("");
  const [nightcodeUrlStatus, setNightcodeUrlStatus] = useState<"untested" | "ok" | "failed">("untested");
  const [nightcodeUrlSaved, setNightcodeUrlSaved] = useState(false);

  // Tailscale state
  const [tsStatus, setTsStatus] = useState<{ installed: boolean; running: boolean; url: string | null } | null>(null);
  const [tsAuthKey, setTsAuthKey] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [tsError, setTsError] = useState("");

  useEffect(() => {
    testClaude();
    testGithub();
    testGhCli();
    loadSettings();
    checkTailscale();
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
      if (res.data?.custom_steps) {
        try { setCustomSteps(JSON.parse(res.data.custom_steps)); } catch {}
      }
      if (res.data?.custom_workflows) {
        try { setCustomWorkflows(JSON.parse(res.data.custom_workflows)); } catch {}
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

  const ALL_TOOLS = ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"];

  const DEFAULT_STEPS: Record<string, { prompt: string; systemPrompt: string; allowedTools: string[]; resumeFromPrevious: boolean }> = {
    plan: {
      prompt: `You are in PLAN MODE. Analyze the following task and create a detailed implementation plan.
Do NOT make any file changes. Only explore and read the codebase.

## Task
{{task.prompt}}

## Instructions
1. Explore the codebase to understand the current structure and patterns
2. Identify all files that need to be modified or created
3. Design a step-by-step implementation approach
4. Consider edge cases and potential risks
5. Estimate the scope: small (1-3 files), medium (4-8 files), or large (9+ files)

## Output Format
Provide a structured plan with:
- **Summary**: One paragraph describing the approach
- **Files to modify**: List each file with what changes are needed
- **Files to create**: List any new files needed
- **Risks**: Potential issues or breaking changes
- **Testing strategy**: How to verify the changes work`,
      systemPrompt: "You are planning only. Do NOT edit, write, or create any files. Only use read-only tools to explore the codebase.",
      allowedTools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
      resumeFromPrevious: false,
    },
    audit: {
      prompt: `Review the implementation plan from the previous step. Evaluate it for:

1. **Correctness**: Will this plan actually solve the task? Are there logical errors?
2. **Completeness**: Are any edge cases, error handling, or files missing?
3. **Safety**: Could these changes break existing functionality or introduce regressions?
4. **Code quality**: Does the approach follow the codebase's existing patterns and conventions?
5. **Best practices**: Are there simpler or more maintainable approaches?

If the plan has issues:
- List each issue clearly
- Provide specific corrections or alternatives
- Re-state the corrected plan

If the plan is solid:
- Confirm with "PLAN APPROVED"
- Note any minor suggestions that are optional`,
      systemPrompt: "You are auditing a plan. Do NOT edit any files. Only read and analyze.",
      allowedTools: ["Read", "Glob", "Grep"],
      resumeFromPrevious: true,
    },
    implement: {
      prompt: `Execute the implementation plan. Make all necessary code changes.

## Task
{{task.prompt}}

## Instructions
- Follow the plan from the previous steps exactly, unless you discover issues during implementation
- If you discover issues, note them but continue with the best approach
- Write clean, well-structured code that follows existing patterns
- Add comments only where the logic is non-obvious
- Do NOT add unnecessary error handling, abstractions, or over-engineering
- Keep changes minimal and focused on the task`,
      systemPrompt: "You are implementing code changes. Be precise and follow existing code patterns.",
      allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
      resumeFromPrevious: true,
    },
    test: {
      prompt: `Run the project's test suite and verify that your changes work correctly.

## Instructions
1. First, check if a test suite exists (look for test scripts in package.json, pytest, jest, etc.)
2. Run the full test suite
3. If tests fail DUE TO YOUR CHANGES, fix them
4. Do NOT modify test expectations to make them pass unless the old expectations were wrong
5. If no test suite exists, manually verify your changes by reviewing the modified files
6. Report the test results

## Task context
{{task.prompt}}`,
      systemPrompt: "You are running tests and fixing any failures caused by your changes.",
      allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep"],
      resumeFromPrevious: true,
    },
    pr: {
      prompt: `Create a GitHub pull request for the changes. Stage all changes, commit with a descriptive message, push the branch, and run gh pr create.

## Task context
Title: {{task.title}}
{{task.prompt}}`,
      systemPrompt: `You are creating a pull request. Base branch is "{{repo.branch}}".

CRITICAL RULES:
1. You MUST run gh pr create -- NOT draft, a real PR
2. Do NOT just push the branch and stop -- that is NOT creating a PR
3. The PR body must contain Summary, Changes, Key Decisions, and How to continue sections
4. If gh pr create fails, check the error and fix it
5. The final output MUST contain the PR URL`,
      allowedTools: ["Bash", "Read", "Glob"],
      resumeFromPrevious: true,
    },
  };

  const BUILT_IN_WORKFLOWS: Record<string, string[]> = {
    "implement-pr": ["implement", "pr"],
    "plan-implement-pr": ["plan", "implement", "pr"],
    "plan-audit-implement-pr": ["plan", "audit", "implement", "test", "pr"],
  };

  function startEditingStep(name: string) {
    const custom = customSteps[name];
    const defaults = DEFAULT_STEPS[name];
    setEditingStep(name);
    setStepPrompt(custom?.prompt ?? defaults?.prompt ?? "");
    setStepSystemPrompt(custom?.systemPrompt ?? defaults?.systemPrompt ?? "");
    setStepTools(custom?.allowedTools ?? defaults?.allowedTools ?? ALL_TOOLS);
    setStepResume(custom?.resumeFromPrevious ?? defaults?.resumeFromPrevious ?? true);
  }

  async function saveStepCustomization() {
    if (!editingStep) return;
    const updated = { ...customSteps };
    updated[editingStep] = {
      prompt: stepPrompt,
      systemPrompt: stepSystemPrompt,
      allowedTools: stepTools,
      resumeFromPrevious: stepResume,
    };
    setCustomSteps(updated);
    try {
      await api.updateSettings({ custom_steps: JSON.stringify(updated) });
      setStepSaved(true);
      setTimeout(() => setStepSaved(false), 2000);
    } catch { /* ignore */ }
  }

  async function resetStepToDefault() {
    if (!editingStep) return;
    const updated = { ...customSteps };
    delete updated[editingStep];
    setCustomSteps(updated);
    const defaults = DEFAULT_STEPS[editingStep];
    if (defaults) {
      setStepPrompt(defaults.prompt);
      setStepSystemPrompt(defaults.systemPrompt);
      setStepTools(defaults.allowedTools);
      setStepResume(defaults.resumeFromPrevious);
    }
    try {
      if (Object.keys(updated).length === 0) {
        await api.updateSettings({ custom_steps: "" });
      } else {
        await api.updateSettings({ custom_steps: JSON.stringify(updated) });
      }
      setStepSaved(true);
      setTimeout(() => setStepSaved(false), 2000);
    } catch { /* ignore */ }
  }

  function startEditingWorkflow(name: string) {
    setEditingWorkflow(name);
    const steps = customWorkflows[name] || BUILT_IN_WORKFLOWS[name] || [];
    setWorkflowStepList(steps.join(", "));
  }

  async function saveWorkflowCustomization() {
    if (!editingWorkflow) return;
    const stepNames = workflowStepList.split(",").map(s => s.trim()).filter(Boolean);
    if (stepNames.length === 0) return;
    const updated = { ...customWorkflows };
    updated[editingWorkflow] = stepNames;
    setCustomWorkflows(updated);
    try {
      await api.updateSettings({ custom_workflows: JSON.stringify(updated) });
      setWorkflowSaved(true);
      setTimeout(() => setWorkflowSaved(false), 2000);
    } catch { /* ignore */ }
    setEditingWorkflow(null);
  }

  async function resetWorkflowToDefault() {
    if (!editingWorkflow) return;
    const updated = { ...customWorkflows };
    delete updated[editingWorkflow];
    setCustomWorkflows(updated);
    if (BUILT_IN_WORKFLOWS[editingWorkflow]) {
      setWorkflowStepList(BUILT_IN_WORKFLOWS[editingWorkflow].join(", "));
    }
    try {
      if (Object.keys(updated).length === 0) {
        await api.updateSettings({ custom_workflows: "" });
      } else {
        await api.updateSettings({ custom_workflows: JSON.stringify(updated) });
      }
      setWorkflowSaved(true);
      setTimeout(() => setWorkflowSaved(false), 2000);
    } catch { /* ignore */ }
    setEditingWorkflow(null);
  }

  async function addCustomWorkflow() {
    const name = newWorkflowName.trim();
    const stepNames = newWorkflowSteps.split(",").map(s => s.trim()).filter(Boolean);
    if (!name || stepNames.length === 0) return;
    const updated = { ...customWorkflows, [name]: stepNames };
    setCustomWorkflows(updated);
    try {
      await api.updateSettings({ custom_workflows: JSON.stringify(updated) });
      setWorkflowSaved(true);
      setTimeout(() => setWorkflowSaved(false), 2000);
    } catch { /* ignore */ }
    setNewWorkflowName("");
    setNewWorkflowSteps("");
  }

  async function deleteCustomWorkflow(name: string) {
    const updated = { ...customWorkflows };
    delete updated[name];
    setCustomWorkflows(updated);
    try {
      if (Object.keys(updated).length === 0) {
        await api.updateSettings({ custom_workflows: "" });
      } else {
        await api.updateSettings({ custom_workflows: JSON.stringify(updated) });
      }
    } catch { /* ignore */ }
  }

  async function checkTailscale() {
    try {
      const res = await api.getTailscaleStatus();
      setTsStatus(res.data);
      if (res.data.url && !nightcodeUrl) {
        setNightcodeUrl(res.data.url);
        setNightcodeUrlStatus("ok");
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
          setNightcodeUrl(res.data.url);
          setNightcodeUrlStatus("ok");
          setNightcodeUrlSaved(true);
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

  async function handleTsDisconnect() {
    try {
      await api.disconnectTailscale();
      await checkTailscale();
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
                tsStatus?.running
                  ? "bg-green-900/30 text-green-400"
                  : nightcodeUrl && nightcodeUrlStatus === "ok"
                    ? "bg-green-900/30 text-green-400"
                    : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {tsStatus?.running ? "Connected" : nightcodeUrl ? "Public" : "Local only"}
            </span>
          </div>

          {/* Tailscale installed + connected */}
          {tsStatus?.installed && tsStatus.running && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-green-950/30 border-green-800/50">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm bg-green-900/50 text-green-400">
                  {"\u2713"}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-300">Tailscale connected</p>
                  {tsStatus.url && (
                    <p className="text-xs text-green-400/70 font-mono mt-0.5">{tsStatus.url}</p>
                  )}
                </div>
                <button
                  onClick={handleTsDisconnect}
                  className="text-xs bg-zinc-800 text-zinc-400 hover:text-red-400 px-3 py-1.5 rounded"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}

          {/* Tailscale installed but not connected */}
          {tsStatus?.installed && !tsStatus.running && (
            <div className="space-y-3 mb-3">
              <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-zinc-400 space-y-2">
                <p className="font-medium text-zinc-300">Tailscale is available. Paste your auth key to connect.</p>
                <p className="text-zinc-500">
                  Generate a key at{" "}
                  <a href="https://login.tailscale.com/admin/settings/keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                    Tailscale Admin &rarr; Settings &rarr; Keys
                  </a>
                  {" "}(enable "Reusable" and "Ephemeral" as needed).
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="tskey-auth-xxxxx"
                  value={tsAuthKey}
                  onChange={(e) => { setTsAuthKey(e.target.value); setTsError(""); }}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
                />
                <button
                  onClick={handleTsConnect}
                  disabled={tsConnecting || !tsAuthKey.trim()}
                  className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                >
                  {tsConnecting ? "Connecting..." : "Connect"}
                </button>
              </div>
              {tsError && <p className="text-xs text-red-400">{tsError}</p>}
            </div>
          )}

          {/* Tailscale not installed */}
          {tsStatus && !tsStatus.installed && !nightcodeUrl && (
            <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-zinc-400 space-y-3 mb-3">
              <div>
                <p className="font-medium text-zinc-300 mb-1">Option A: Built-in Tailscale (recommended)</p>
                <div className="space-y-1 font-mono">
                  <p><code className="text-zinc-300">docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d --build</code></p>
                </div>
                <p className="text-zinc-500 mt-1">Installs Tailscale inside the container. Configure from this page after rebuild.</p>
              </div>
              <div className="border-t border-zinc-700 pt-3">
                <p className="font-medium text-zinc-300 mb-1">Option B: Host-level Tailscale</p>
                <div className="space-y-1.5 font-mono">
                  <p><span className="text-zinc-600 select-none">1.</span> <code className="text-zinc-300">curl -fsSL https://tailscale.com/install.sh | sh</code></p>
                  <p><span className="text-zinc-600 select-none">2.</span> <code className="text-zinc-300">tailscale up</code></p>
                  <p><span className="text-zinc-600 select-none">3.</span> <code className="text-zinc-300">tailscale funnel 3777</code></p>
                </div>
                <p className="text-zinc-500 mt-1">Copy the HTTPS URL from the output and paste it below.</p>
              </div>
            </div>
          )}

          {/* Manual URL input (always shown) */}
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

        {/* Workflow Customization */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <button
            onClick={() => setShowWorkflowSection(!showWorkflowSection)}
            className="w-full flex items-center justify-between"
          >
            <div>
              <h3 className="text-sm font-medium text-zinc-200">
                Workflow Customization
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Customize step prompts and create custom workflow chains
              </p>
            </div>
            <span className="text-zinc-500 text-sm">{showWorkflowSection ? "\u25B2" : "\u25BC"}</span>
          </button>

          {showWorkflowSection && (
            <div className="mt-4 space-y-4">
              {/* Steps editor */}
              <div>
                <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Steps</h4>
                <p className="text-xs text-zinc-600 mb-3">
                  Edit built-in step prompts or create new custom steps. Placeholders: {"{{task.prompt}}"}, {"{{task.title}}"}, {"{{repo.name}}"}, {"{{repo.branch}}"}, {"{{task.branchName}}"}
                </p>
                <div className="space-y-2">
                  {Object.keys(DEFAULT_STEPS).map(name => (
                    <div key={name} className="border border-zinc-800 rounded-lg">
                      <div className="flex items-center justify-between px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-zinc-300 font-mono">{name}</span>
                          {customSteps[name] && (
                            <span className="text-[10px] bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded">customized</span>
                          )}
                        </div>
                        <button
                          onClick={() => editingStep === name ? setEditingStep(null) : startEditingStep(name)}
                          className="text-xs text-zinc-500 hover:text-zinc-300"
                        >
                          {editingStep === name ? "Close" : "Edit"}
                        </button>
                      </div>

                      {editingStep === name && (
                        <div className="px-3 pb-3 space-y-3 border-t border-zinc-800 pt-3">
                          <div>
                            <label className="text-xs text-zinc-500 block mb-1">Prompt Template</label>
                            <textarea
                              value={stepPrompt}
                              onChange={(e) => setStepPrompt(e.target.value)}
                              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-xs font-mono h-40 resize-y focus:outline-none focus:border-zinc-600"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500 block mb-1">System Prompt</label>
                            <textarea
                              value={stepSystemPrompt}
                              onChange={(e) => setStepSystemPrompt(e.target.value)}
                              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-xs font-mono h-20 resize-y focus:outline-none focus:border-zinc-600"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500 block mb-1">Allowed Tools</label>
                            <div className="flex flex-wrap gap-2">
                              {ALL_TOOLS.map(tool => (
                                <label key={tool} className="flex items-center gap-1 text-xs text-zinc-400">
                                  <input
                                    type="checkbox"
                                    checked={stepTools.includes(tool)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setStepTools([...stepTools, tool]);
                                      } else {
                                        setStepTools(stepTools.filter(t => t !== tool));
                                      }
                                    }}
                                    className="rounded bg-zinc-800 border-zinc-700"
                                  />
                                  {tool}
                                </label>
                              ))}
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-zinc-400">
                            <input
                              type="checkbox"
                              checked={stepResume}
                              onChange={(e) => setStepResume(e.target.checked)}
                              className="rounded bg-zinc-800 border-zinc-700"
                            />
                            Resume from previous step session
                          </label>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={saveStepCustomization}
                              className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded"
                            >
                              Save Step
                            </button>
                            {customSteps[name] && (
                              <button
                                onClick={resetStepToDefault}
                                className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5"
                              >
                                Reset to Default
                              </button>
                            )}
                            {stepSaved && <span className="text-xs text-green-400">Saved</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Workflows editor */}
              <div>
                <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Workflows</h4>
                <p className="text-xs text-zinc-600 mb-3">
                  Customize the step order of built-in workflows or create new ones. Enter step names as a comma-separated list.
                </p>
                <div className="space-y-2">
                  {/* Built-in workflows */}
                  {Object.entries(BUILT_IN_WORKFLOWS).map(([name, defaultSteps]) => (
                    <div key={name} className="border border-zinc-800 rounded-lg">
                      <div className="flex items-center justify-between px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-zinc-300 font-mono">{name}</span>
                          <span className="text-xs text-zinc-600">{(customWorkflows[name] || defaultSteps).join(" -> ")}</span>
                          {customWorkflows[name] && (
                            <span className="text-[10px] bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded">customized</span>
                          )}
                        </div>
                        <button
                          onClick={() => editingWorkflow === name ? setEditingWorkflow(null) : startEditingWorkflow(name)}
                          className="text-xs text-zinc-500 hover:text-zinc-300"
                        >
                          {editingWorkflow === name ? "Close" : "Edit"}
                        </button>
                      </div>

                      {editingWorkflow === name && (
                        <div className="px-3 pb-3 space-y-2 border-t border-zinc-800 pt-3">
                          <input
                            type="text"
                            value={workflowStepList}
                            onChange={(e) => setWorkflowStepList(e.target.value)}
                            placeholder="plan, implement, pr"
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-zinc-600"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={saveWorkflowCustomization}
                              className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded"
                            >
                              Save Workflow
                            </button>
                            {customWorkflows[name] && (
                              <button
                                onClick={resetWorkflowToDefault}
                                className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5"
                              >
                                Reset to Default
                              </button>
                            )}
                            {workflowSaved && <span className="text-xs text-green-400">Saved</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Custom workflows */}
                  {Object.entries(customWorkflows)
                    .filter(([name]) => !BUILT_IN_WORKFLOWS[name])
                    .map(([name, steps]) => (
                      <div key={name} className="border border-zinc-800 rounded-lg">
                        <div className="flex items-center justify-between px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-zinc-300 font-mono">{name}</span>
                            <span className="text-xs text-zinc-600">{steps.join(" -> ")}</span>
                            <span className="text-[10px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded">custom</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => editingWorkflow === name ? setEditingWorkflow(null) : startEditingWorkflow(name)}
                              className="text-xs text-zinc-500 hover:text-zinc-300"
                            >
                              {editingWorkflow === name ? "Close" : "Edit"}
                            </button>
                            <button
                              onClick={() => deleteCustomWorkflow(name)}
                              className="text-xs text-red-500 hover:text-red-400"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {editingWorkflow === name && (
                          <div className="px-3 pb-3 space-y-2 border-t border-zinc-800 pt-3">
                            <input
                              type="text"
                              value={workflowStepList}
                              onChange={(e) => setWorkflowStepList(e.target.value)}
                              placeholder="plan, implement, pr"
                              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-zinc-600"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={saveWorkflowCustomization}
                                className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded"
                              >
                                Save
                              </button>
                              {workflowSaved && <span className="text-xs text-green-400">Saved</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                  {/* Add new workflow */}
                  <div className="border border-dashed border-zinc-700 rounded-lg p-3 space-y-2">
                    <p className="text-xs text-zinc-500">Add a new custom workflow</p>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={newWorkflowName}
                        onChange={(e) => setNewWorkflowName(e.target.value)}
                        placeholder="workflow-name"
                        className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-zinc-600"
                      />
                      <input
                        type="text"
                        value={newWorkflowSteps}
                        onChange={(e) => setNewWorkflowSteps(e.target.value)}
                        placeholder="plan, implement, test, pr"
                        className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-zinc-600"
                      />
                    </div>
                    <button
                      onClick={addCustomWorkflow}
                      disabled={!newWorkflowName.trim() || !newWorkflowSteps.trim()}
                      className="text-xs bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded disabled:opacity-50"
                    >
                      Add Workflow
                    </button>
                  </div>
                </div>
              </div>
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
