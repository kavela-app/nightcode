import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as schema from "./schema.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("db");

let db: ReturnType<typeof drizzle<typeof schema>>;

export function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function initDb(dataDir: string) {
  const dbPath = join(dataDir, "nightcode.db");

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  log.info({ path: dbPath }, "Initializing SQLite database");

  const sqlite = new Database(dbPath);

  // Enable WAL mode for concurrent reads
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  db = drizzle(sqlite, { schema });

  // Run inline migrations (creates tables if they don't exist)
  runMigrations(sqlite);

  log.info("Database initialized");

  return db;
}

function runMigrations(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      branch TEXT NOT NULL DEFAULT 'main',
      system_prompt TEXT,
      mcp_config TEXT,
      kavela_group TEXT,
      allowed_tools TEXT DEFAULT 'Read,Edit,Write,Bash,Glob,Grep',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      workflow TEXT NOT NULL DEFAULT 'plan-implement-pr',
      priority INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'pending',
      current_step TEXT,
      branch_name TEXT,
      pr_url TEXT,
      pr_number INTEGER,
      session_id TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 2,
      notes TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      step_name TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      session_id TEXT,
      prompt TEXT,
      result TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      step_name TEXT NOT NULL,
      message_type TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cron_expr TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      enabled INTEGER NOT NULL DEFAULT 1,
      task_template TEXT,
      interval_minutes INTEGER,
      window_start TEXT,
      window_end TEXT,
      last_run TEXT,
      next_run TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_repo_id ON tasks(repo_id);
    CREATE INDEX IF NOT EXISTS idx_task_steps_task_id ON task_steps(task_id);
    CREATE INDEX IF NOT EXISTS idx_session_messages_task_id ON session_messages(task_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);
  `);

  // Incremental migrations for new columns
  try { sqlite.exec("ALTER TABLE schedules ADD COLUMN interval_minutes INTEGER"); } catch {}
  try { sqlite.exec("ALTER TABLE schedules ADD COLUMN window_start TEXT"); } catch {}
  try { sqlite.exec("ALTER TABLE schedules ADD COLUMN window_end TEXT"); } catch {}
  try { sqlite.exec("ALTER TABLE tasks ADD COLUMN schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL"); } catch {}
  try { sqlite.exec("ALTER TABLE tasks ADD COLUMN parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL"); } catch {}
  try { sqlite.exec("ALTER TABLE tasks ADD COLUMN additional_repo_ids TEXT"); } catch {}
  try { sqlite.exec("ALTER TABLE tasks ADD COLUMN additional_pr_urls TEXT"); } catch {}
}

export { schema };
