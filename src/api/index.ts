import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq } from "drizzle-orm";
import { serveStatic } from "@hono/node-server/serve-static";
import repoRoutes from "./routes/repos.js";
import { createTaskRoutes } from "./routes/tasks.js";
import { createScheduleRoutes } from "./routes/schedules.js";
import settingsRoutes from "./routes/settings.js";
import { createDashboardRoutes } from "./routes/dashboard.js";
import { createAgentRoutes, processAgentMessage } from "./routes/agent.js";
import { createLarkRoutes } from "./routes/lark.js";
import { authMiddleware } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { getDb, schema } from "../db/index.js";
import { testClaudeAuth, startClaudeLogin, submitClaudeAuthCode, setClaudeApiKey, resetClaudeLogin } from "../executor/claude-cli.js";
import { testSshAccess } from "../executor/git-ops.js";
import { testGhAuth, loginGhWithToken } from "../executor/gh-auth.js";
import { getTailscaleStatus, connectTailscale, disconnectTailscale } from "../executor/tailscale.js";
import type { NightcodeConfig } from "../config/index.js";
import type { ExecutorPool } from "../executor/index.js";
import type { Scheduler } from "../scheduler/index.js";

export function createApp(
  config: NightcodeConfig,
  executor: ExecutorPool,
  scheduler: Scheduler,
) {
  const app = new Hono();

  // Global middleware
  app.use("*", cors());
  app.onError(errorHandler);

  // Health check (no auth required)
  app.get("/api/health", (c) =>
    c.json({
      status: "ok",
      version: "0.1.0",
      uptime: process.uptime(),
      running: executor.runningCount,
    }),
  );

  // Setup status (no auth required — dashboard needs this before it has a token)
  app.get("/api/setup/status", async (c) => {
    const db = getDb();
    const repos = db.select().from(schema.repos).all();
    const claudeResult = await testClaudeAuth();
    const githubResult = await testSshAccess();

    // Check if Kavela is configured
    const kavelaRow = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "kavela_api_key"))
      .get();
    const kavelaConfigured = !!(kavelaRow && kavelaRow.value);

    const needsSetup = repos.length === 0;

    // Only return auth token if request comes from localhost (first-time setup)
    // or if no auth token is configured (local-only mode)
    const isLocal = c.req.header("host")?.startsWith("localhost") || c.req.header("host")?.startsWith("127.0.0.1");
    const hasAuth = !!config.authToken;

    return c.json({
      data: {
        needsSetup,
        claude: claudeResult,
        github: githubResult,
        kavela: { configured: kavelaConfigured },
        repos: repos.length,
        authToken: (!hasAuth || isLocal) ? config.authToken : null,
        requiresLogin: hasAuth && !isLocal,
      },
    });
  });

  // Start Claude login flow (no auth required)
  app.post("/api/setup/claude-login", async (c) => {
    const result = await startClaudeLogin();
    return c.json({ data: result });
  });

  // Submit OAuth auth code to complete login (no auth required)
  app.post("/api/setup/claude-auth-code", async (c) => {
    const { code } = await c.req.json<{ code: string }>();
    if (!code) {
      return c.json({ data: { ok: false, error: "Auth code is required" } }, 400);
    }
    const result = await submitClaudeAuthCode(code);
    return c.json({ data: result });
  });

  // Set API key directly instead of OAuth (no auth required)
  app.post("/api/setup/claude-api-key", async (c) => {
    const { apiKey } = await c.req.json<{ apiKey: string }>();
    if (!apiKey) {
      return c.json({ data: { ok: false, error: "API key is required" } }, 400);
    }
    const result = await setClaudeApiKey(apiKey);
    return c.json({ data: result });
  });

  // Login validation (no auth required — this IS the auth check)
  app.post("/api/auth/login", async (c) => {
    const { token } = await c.req.json<{ token: string }>();
    if (!token) {
      return c.json({ data: { ok: false, error: "Token is required" } }, 400);
    }
    if (!config.authToken) {
      // No auth configured — any token is valid (local mode)
      return c.json({ data: { ok: true } });
    }
    if (token === config.authToken) {
      return c.json({ data: { ok: true } });
    }
    return c.json({ data: { ok: false, error: "Invalid token" } }, 401);
  });

  // GitHub CLI auth (no auth required — needed during setup)
  app.get("/api/setup/gh-status", async (c) => {
    const result = await testGhAuth();
    return c.json({ data: result });
  });

  app.post("/api/setup/gh-login", async (c) => {
    const { token } = await c.req.json<{ token: string }>();
    if (!token) return c.json({ data: { ok: false, error: "Token is required" } }, 400);
    const result = await loginGhWithToken(token);
    return c.json({ data: result });
  });

  // Tailscale status (no auth required — needed for onboarding)
  app.get("/api/setup/tailscale-status", async (c) => {
    const status = await getTailscaleStatus();
    return c.json({ data: status });
  });

  // Connect Tailscale (no auth required — needed for onboarding)
  app.post("/api/setup/tailscale-connect", async (c) => {
    const { authKey } = await c.req.json<{ authKey: string }>();
    if (!authKey) return c.json({ data: { ok: false, error: "Auth key is required" } }, 400);

    const result = await connectTailscale(authKey);

    // Auto-save the URL to settings if successful
    if (result.ok && result.url) {
      const db = getDb();
      db.insert(schema.settings)
        .values({ key: "nightcode_url", value: result.url })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: result.url, updatedAt: new Date().toISOString() } })
        .run();
    }

    return c.json({ data: result });
  });

  // Disconnect Tailscale (no auth required — needed for onboarding)
  app.post("/api/setup/tailscale-disconnect", async (c) => {
    const result = await disconnectTailscale();
    return c.json({ data: result });
  });

  // Lark webhook (no auth required — Lark needs to reach this)
  app.route("/api/lark", createLarkRoutes((msg) => processAgentMessage(msg, executor)));

  // Auth middleware for all /api routes (except health + setup)
  app.use("/api/*", authMiddleware(config));

  // Rotate auth token (requires current auth)
  app.post("/api/settings/rotate-token", async (c) => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { generateToken } = await import("../utils/crypto.js");

    const newToken = generateToken("nc");
    const tokenPath = join(config.dataDir, ".auth-token");
    writeFileSync(tokenPath, newToken);
    config.authToken = newToken;

    return c.json({ data: { token: newToken } });
  });

  // API routes
  app.route("/api/repos", repoRoutes);
  app.route("/api/tasks", createTaskRoutes(executor));
  app.route("/api/schedules", createScheduleRoutes(scheduler));
  app.route("/api/settings", settingsRoutes);
  app.route("/api/dashboard", createDashboardRoutes(executor));
  app.route("/api/agent", createAgentRoutes(executor));

  // Serve dashboard SPA (static files)
  app.use(
    "/*",
    serveStatic({
      root: "./dashboard/dist",
    }),
  );

  // SPA fallback: serve index.html for all non-API, non-static routes
  app.get("*", serveStatic({ root: "./dashboard/dist", path: "index.html" }));

  return app;
}
