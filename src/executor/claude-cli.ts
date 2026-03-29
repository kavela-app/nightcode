import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("claude-cli");

// ── OAuth PKCE constants (extracted from Claude Code CLI) ──
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const OAUTH_AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize";
const OAUTH_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const OAUTH_SCOPES = [
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
];

export interface ClaudeCliOptions {
  prompt: string;
  cwd: string;
  additionalDirs?: string[];
  allowedTools?: string[];
  systemPrompt?: string;
  mcpConfigPath?: string;
  resumeSessionId?: string;
  outputFormat?: "text" | "json" | "stream-json";
}

export interface ClaudeStreamMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  content?: string;
  tool_name?: string;
  tool_input?: unknown;
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  [key: string]: unknown;
}

export interface ClaudeCliResult {
  sessionId: string | null;
  messages: ClaudeStreamMessage[];
  exitCode: number | null;
}

/**
 * Spawns `claude -p` with stream-json output and parses the NDJSON stream.
 * Returns parsed messages and the session ID for resuming.
 */
export async function runClaude(
  options: ClaudeCliOptions,
  onMessage?: (msg: ClaudeStreamMessage) => void,
  abortSignal?: AbortSignal,
): Promise<ClaudeCliResult> {
  const args = buildArgs(options);

  log.info(
    { cwd: options.cwd, resumeSession: options.resumeSessionId },
    "Spawning claude CLI",
  );

  return new Promise((resolve, reject) => {
    let child: ChildProcess;

    try {
      child = spawn("claude", args, {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          // Ensure Claude can find its config
          HOME: process.env.HOME || "/root",
        },
      });
    } catch (err) {
      reject(
        new Error(
          `Failed to spawn claude CLI: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    const messages: ClaudeStreamMessage[] = [];
    let sessionId: string | null = null;
    let buffer = "";

    // Handle abort signal
    if (abortSignal) {
      abortSignal.addEventListener("abort", () => {
        log.info("Aborting claude process");
        child.kill("SIGTERM");
      });
    }

    // Parse NDJSON stream from stdout
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const msg: ClaudeStreamMessage = JSON.parse(trimmed);
          messages.push(msg);

          // Extract session ID from init message
          if (msg.type === "system" && msg.session_id) {
            sessionId = msg.session_id;
          }

          onMessage?.(msg);
        } catch {
          // Non-JSON output (e.g., warnings)
          log.debug({ line: trimmed }, "Non-JSON output from claude");
        }
      }
    });

    // Capture stderr for error reporting
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const msg: ClaudeStreamMessage = JSON.parse(buffer.trim());
          messages.push(msg);
          if (msg.type === "system" && msg.session_id) {
            sessionId = msg.session_id;
          }
          onMessage?.(msg);
        } catch {
          // ignore
        }
      }

      if (code !== 0 && code !== null) {
        log.warn(
          { code, stderr: stderr.slice(-500) },
          "Claude exited with non-zero code",
        );
      }

      resolve({ sessionId, messages, exitCode: code });
    });

    child.on("error", (err) => {
      reject(new Error(`Claude CLI process error: ${err.message}`));
    });
  });
}

function buildArgs(options: ClaudeCliOptions): string[] {
  const args: string[] = [
    "-p",
    options.prompt,
    "--output-format",
    options.outputFormat || "stream-json",
    "--verbose",
  ];

  // Permission mode: bypass for autonomous execution
  args.push("--dangerously-skip-permissions");

  // Tool restrictions
  if (options.allowedTools?.length) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }

  // System prompt
  if (options.systemPrompt) {
    args.push("--append-system-prompt", options.systemPrompt);
  }

  // MCP config
  if (options.mcpConfigPath) {
    args.push("--mcp-config", options.mcpConfigPath);
  }

  // Additional directories (multi-repo support)
  if (options.additionalDirs?.length) {
    for (const dir of options.additionalDirs) {
      args.push("--add-dir", dir);
    }
  }

  // Session resume
  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  }

  return args;
}

/**
 * Quick test to verify Claude CLI is authenticated and working.
 * Uses `claude auth status` for a fast check without consuming API credits.
 */
export async function testClaudeAuth(): Promise<{
  ok: boolean;
  error?: string;
}> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["auth", "status"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", TERM: "dumb" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ ok: false, error: "Auth status check timed out" });
    }, 10000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      const output = stdout + stderr;
      if (code === 0) {
        resolve({ ok: true });
      } else {
        // Parse JSON status if available
        try {
          const status = JSON.parse(output.trim());
          resolve({ ok: status.loggedIn === true, error: status.loggedIn ? undefined : "Not logged in" });
        } catch {
          resolve({ ok: false, error: output.trim() || "Not logged in" });
        }
      }
    });
  });
}

// ── Active PKCE session state ──
let activePkce: { codeVerifier: string; state: string } | null = null;

/**
 * Generates a PKCE code_verifier and code_challenge, builds the OAuth
 * authorization URL, and returns it.  No subprocess needed.
 */
export async function startClaudeLogin(): Promise<{
  loginUrl: string | null;
  error?: string;
}> {
  try {
    // If we already have a pending PKCE session, reuse it so the user can
    // retry pasting the code without invalidating the challenge.
    if (!activePkce) {
      const codeVerifier = randomBytes(32).toString("base64url");
      const codeChallenge = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
      const state = randomBytes(32).toString("base64url");

      activePkce = { codeVerifier, state };

      const params = new URLSearchParams({
        code: "true",
        client_id: OAUTH_CLIENT_ID,
        response_type: "code",
        redirect_uri: OAUTH_REDIRECT_URI,
        scope: OAUTH_SCOPES.join(" "),
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
      });

      const url = `${OAUTH_AUTHORIZE_URL}?${params}`;
      log.info({ state }, "Created OAuth PKCE login URL");
      return { loginUrl: url };
    }

    // Rebuild URL from existing session
    const codeChallenge = createHash("sha256")
      .update(activePkce.codeVerifier)
      .digest("base64url");
    const params = new URLSearchParams({
      code: "true",
      client_id: OAUTH_CLIENT_ID,
      response_type: "code",
      redirect_uri: OAUTH_REDIRECT_URI,
      scope: OAUTH_SCOPES.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state: activePkce.state,
    });
    const url = `${OAUTH_AUTHORIZE_URL}?${params}`;
    log.info("Reusing existing PKCE session");
    return { loginUrl: url };
  } catch (err) {
    return { loginUrl: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Reset the current PKCE session so the next startClaudeLogin() creates a fresh one.
 */
export function resetClaudeLogin(): void {
  activePkce = null;
}

/**
 * Exchanges the OAuth authorization code for tokens using our PKCE verifier,
 * then writes credentials to ~/.claude/.credentials.json so `claude` CLI picks them up.
 */
export async function submitClaudeAuthCode(code: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!activePkce) {
    return { ok: false, error: "No active login session. Click 'Log in' again to start a new session." };
  }

  const { codeVerifier, state } = activePkce;

  // The callback page shows codes as "authcode#state" — strip the #state if present
  const rawCode = code.trim();
  const authCode = rawCode.includes("#") ? rawCode.split("#")[0] : rawCode;

  log.info({ codeLength: authCode.length, hadHash: rawCode.includes("#") }, "Exchanging OAuth authorization code for tokens");

  try {
    // Token exchange
    const body = {
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: OAUTH_REDIRECT_URI,
      client_id: OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
      state,
    };

    const resp = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      log.warn({ status: resp.status, body: text.slice(0, 300) }, "Token exchange failed");
      activePkce = null; // force fresh session on retry
      return {
        ok: false,
        error: resp.status === 401
          ? "Invalid or expired authorization code. Click 'Log in' to start a new session."
          : `Token exchange failed (${resp.status}). Click 'Log in' to try again.`,
      };
    }

    const tokens = (await resp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };

    log.info("Token exchange successful, saving credentials");

    // Write credentials to ~/.claude/.credentials.json
    const { writeFile, readFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || "/root", ".claude");
    const credPath = join(claudeDir, ".credentials.json");

    await mkdir(claudeDir, { recursive: true }).catch(() => {});

    // Read existing credentials (if any) and merge
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await readFile(credPath, "utf8"));
    } catch {
      // No existing file
    }

    existing.claudeAiOauth = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      scopes: tokens.scope ? tokens.scope.split(" ") : OAUTH_SCOPES,
      subscriptionType: null,
      rateLimitTier: null,
    };

    await writeFile(credPath, JSON.stringify(existing, null, 2), { mode: 0o600 });
    log.info({ credPath }, "Credentials saved");

    activePkce = null;

    // Verify auth actually works now
    const check = await testClaudeAuth();
    if (!check.ok) {
      log.warn({ checkError: check.error }, "Credentials saved but auth check failed");
      return { ok: true }; // tokens saved, might just need a moment
    }

    return { ok: true };
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "submitClaudeAuthCode error");
    activePkce = null;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Sets ANTHROPIC_API_KEY by writing it to /data/.anthropic-api-key.
 * The key is loaded as an env var on subsequent claude spawns.
 */
export async function setClaudeApiKey(apiKey: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const { writeFile } = await import("node:fs/promises");
  const keyPath = process.env.DATA_DIR
    ? `${process.env.DATA_DIR}/.anthropic-api-key`
    : "/data/.anthropic-api-key";

  try {
    await writeFile(keyPath, apiKey.trim(), { mode: 0o600 });
    // Set in current process so future spawns inherit it
    process.env.ANTHROPIC_API_KEY = apiKey.trim();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

