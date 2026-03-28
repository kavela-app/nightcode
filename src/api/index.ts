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

    return c.json({
      data: {
        needsSetup,
        claude: claudeResult,
        github: githubResult,
        kavela: { configured: kavelaConfigured },
        repos: repos.length,
        authToken: config.authToken,
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

  // Lark webhook (no auth required — Lark needs to reach this)
  app.route("/api/lark", createLarkRoutes((msg) => processAgentMessage(msg, executor)));

  // Auth middleware for all /api routes (except health + setup)
  app.use("/api/*", authMiddleware(config));

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
