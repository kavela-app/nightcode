import {
  sqliteTable,
  text,
  integer,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---- Repos ----

export const repos = sqliteTable("repos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull().unique(),
  branch: text("branch").notNull().default("main"),
  systemPrompt: text("system_prompt"),
  mcpConfig: text("mcp_config"), // JSON string
  kavelaGroup: text("kavela_group"),
  allowedTools: text("allowed_tools").default(
    "Read,Edit,Write,Bash,Glob,Grep",
  ),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---- Tasks ----

export type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowType =
  | "implement-pr"
  | "plan-implement-pr"
  | "plan-audit-implement-pr";

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  repoId: integer("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  workflow: text("workflow").notNull().default("plan-implement-pr"),
  priority: integer("priority").notNull().default(5),
  status: text("status").notNull().default("pending"),
  currentStep: text("current_step"),
  branchName: text("branch_name"),
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
  sessionId: text("session_id"),
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(2),
  notes: text("notes"), // User annotations between steps
  scheduleId: integer("schedule_id").references(() => schedules.id, { onDelete: "set null" }),
  parentTaskId: integer("parent_task_id"), // Self-ref FK handled by migration, not Drizzle
  additionalRepoIds: text("additional_repo_ids"), // JSON array of repo IDs
  additionalPrUrls: text("additional_pr_urls"),   // JSON array of PR URLs
  recurring: integer("recurring", { mode: "boolean" }).default(false),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---- Task Steps ----

export type StepName = "plan" | "audit" | "implement" | "test" | "pr";
export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export const taskSteps = sqliteTable("task_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  stepName: text("step_name").notNull(),
  stepOrder: integer("step_order").notNull(),
  status: text("status").notNull().default("pending"),
  sessionId: text("session_id"),
  prompt: text("prompt"),
  result: text("result"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---- Session Messages (for chat export) ----

export type MessageType =
  | "assistant"
  | "tool_use"
  | "tool_result"
  | "system"
  | "user";

export const sessionMessages = sqliteTable("session_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  stepName: text("step_name").notNull(),
  messageType: text("message_type").notNull(),
  content: text("content").notNull(), // JSON string
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---- Schedules ----

export const schedules = sqliteTable("schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  cronExpr: text("cron_expr"),
  timezone: text("timezone").notNull().default("UTC"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  intervalMinutes: integer("interval_minutes"),
  windowStart: text("window_start"),
  windowEnd: text("window_end"),
  taskTemplate: text("task_template"), // JSON: { repoId, title, prompt, workflow, priority }
  lastRun: text("last_run"),
  nextRun: text("next_run"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---- Settings (key-value store) ----

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
