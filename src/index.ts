import { serve } from "@hono/node-server";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config/index.js";
import { initDb } from "./db/index.js";
import { createApp } from "./api/index.js";
import { ExecutorPool } from "./executor/index.js";
import { Scheduler } from "./scheduler/index.js";
import { generateToken } from "./utils/crypto.js";
import { createChildLogger } from "./utils/logger.js";
import { taskEventBus } from "./executor/event-bus.js";

const log = createChildLogger("main");

async function main() {
  log.info("Starting nightcode - Your code ships while you dream");

  // Load configuration
  const config = loadConfig();

  // Ensure directories exist
  for (const dir of [config.dataDir, config.reposDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Generate auth token on first run
  if (!config.authToken) {
    const token = generateToken("nc");
    config.authToken = token;
    const tokenPath = join(config.dataDir, ".auth-token");
    writeFileSync(tokenPath, token);
    log.info("=".repeat(60));
    log.info("  nightcode API auth token generated:");
    log.info(`  ${token}`);
    log.info("  Save this token for remote API access.");
    log.info("  It is stored at: " + tokenPath);
    log.info("=".repeat(60));
  }

  // Initialize database
  initDb(config.dataDir);

  // Create executor pool with event bus broadcast
  const executor = new ExecutorPool(config, (taskId, step, msg) => {
    taskEventBus.emit("task", {
      taskId,
      type: "message",
      step,
      data: msg,
      timestamp: new Date().toISOString(),
    });
  });

  // Create scheduler
  const scheduler = new Scheduler();

  // Create Hono app
  const app = createApp(config, executor, scheduler);

  // Start the HTTP server
  const server = serve(
    { fetch: app.fetch, port: config.port },
    (info) => {
      log.info(`nightcode server running at http://localhost:${info.port}`);
      log.info(`Dashboard: http://localhost:${info.port}`);
      log.info(
        `API: http://localhost:${info.port}/api`,
      );
    },
  );

  // Start executor and scheduler
  executor.start();
  scheduler.start();

  // Graceful shutdown
  const shutdown = () => {
    log.info("Shutting down...");
    executor.stop();
    scheduler.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.fatal({ error: err.message }, "Failed to start nightcode");
  process.exit(1);
});
