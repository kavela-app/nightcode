import { Hono } from "hono";
import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import type { ExecutorPool } from "../../executor/index.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("agent");

// ── Claude CLI wrapper (JSON output, not streaming) ──

async function askClaude(prompt: string, systemPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", [
      "-p", prompt,
      "--output-format", "json",
      "--model", "sonnet",
      "--append-system-prompt", systemPrompt,
      "--dangerously-skip-permissions",
      "--max-budget-usd", "0.10",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: process.env.HOME || "/home/nightcode" },
    });

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timeout = setTimeout(() => { proc.kill(); reject(new Error("Agent timed out")); }, 30000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.slice(-200) || `Claude exited with code ${code}`));
      } else {
        // Parse the JSON result from claude --output-format json
        try {
          const result = JSON.parse(stdout.trim());
          resolve(typeof result.result === "string" ? result.result : stdout.trim());
        } catch {
          resolve(stdout.trim());
        }
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

// ── State gathering ──

function gatherState() {
  const db = getDb();
  const repos = db.select().from(schema.repos).all();
  const tasks = db.select().from(schema.tasks).all();
  const schedules = db.select().from(schema.schedules).all();

  const runningTasks = tasks.filter((t) => t.status === "running" || t.status === "queued");
  const recentCompleted = tasks
    .filter((t) => t.status === "completed")
    .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""))
    .slice(0, 5);
  const failedTasks = tasks.filter((t) => t.status === "failed").slice(-5);

  return { repos, tasks, schedules, runningTasks, recentCompleted, failedTasks };
}

function buildSystemPrompt(state: ReturnType<typeof gatherState>): string {
  const repoList = state.repos.map((r) => `  - id=${r.id} name="${r.name}" url="${r.url}" branch="${r.branch}"`).join("\n");
  const runningList = state.runningTasks.map((t) => `  - id=${t.id} repo_id=${t.repoId} title="${t.title}" status=${t.status}`).join("\n");
  const scheduleList = state.schedules.map((s) => `  - id=${s.id} name="${s.name}" cron="${s.cronExpr}" enabled=${s.enabled}`).join("\n");

  return `You are the nightcode agent. You parse natural-language requests into structured actions.

CURRENT STATE:
Repos (${state.repos.length}):
${repoList || "  (none)"}

Running/queued tasks (${state.runningTasks.length}):
${runningList || "  (none)"}

Schedules (${state.schedules.length}):
${scheduleList || "  (none)"}

Total tasks: ${state.tasks.length} | Completed: ${state.tasks.filter((t) => t.status === "completed").length} | Failed: ${state.tasks.filter((t) => t.status === "failed").length}

AVAILABLE ACTIONS:
- create_repo: { "name": string, "url": string, "branch"?: string }
- list_repos: {}
- delete_repo: { "repo_id": number }
- create_task: { "repo_id": number, "title": string, "prompt": string, "workflow"?: "implement-pr"|"plan-implement-pr"|"plan-audit-implement-pr", "priority"?: 1-10, "additional_repo_ids"?: number[], "recurring"?: boolean }
- run_task: { "task_id": number }
- pause_task: { "task_id": number }
- cancel_task: { "task_id": number }
- delete_task: { "task_id": number }
- refine_task: { "task_id": number, "message": string }
- list_tasks: { "status"?: string }
- get_stats: {}
- create_schedule: { "name": string, "interval_minutes": number, "window_start"?: "HH:MM", "window_end"?: "HH:MM", "timezone"?: string }
- list_schedules: {}
- toggle_schedule: { "schedule_id": number, "enabled": boolean }
- delete_schedule: { "schedule_id": number }
- reply: { "message": string }

INSTRUCTIONS:
You MUST respond with EXACTLY one JSON object (no markdown fences, no extra text). The JSON must have:
- "action": one of the action names above
- "params": the parameters object for that action
- "reply": a brief human-friendly message explaining what you are doing

If the user is just asking a question or chatting, use action "reply" with params { "message": "your answer" }.
If you need to pick a repo but the user didn't specify, infer from context or ask via "reply".

Example responses:
{"action":"create_task","params":{"repo_id":1,"title":"Fix login bug","prompt":"Fix the login button not working on mobile"},"reply":"Creating a task to fix the login bug on repo #1."}
{"action":"list_tasks","params":{"status":"running"},"reply":"Here are the currently running tasks."}
{"action":"reply","params":{"message":"There are 3 repos configured. Which one would you like to work with?"},"reply":"There are 3 repos configured. Which one would you like to work with?"}`;
}

// ── Action execution ──

interface ActionResult {
  reply: string;
  action: string | null;
  data?: unknown;
}

async function executeAction(
  action: string,
  params: Record<string, unknown>,
  executor: ExecutorPool,
): Promise<ActionResult> {
  const db = getDb();

  switch (action) {
    case "create_repo": {
      const result = db
        .insert(schema.repos)
        .values({
          name: params.name as string,
          url: params.url as string,
          branch: (params.branch as string) || "main",
        })
        .returning()
        .get();
      return { reply: `Repo "${result.name}" created (id=${result.id}).`, action: "create_repo", data: result };
    }

    case "list_repos": {
      const repos = db.select().from(schema.repos).all();
      const lines = repos.map(r => `#${r.id} "${r.name}" — ${r.url} (branch: ${r.branch})`);
      const summary = repos.length === 0
        ? "No repos configured yet."
        : `${repos.length} repo(s):\n\n${lines.join("\n")}`;
      return { reply: summary, action: "list_repos", data: repos };
    }

    case "create_task": {
      const repoId = params.repo_id as number;
      const repo = db.select().from(schema.repos).where(eq(schema.repos.id, repoId)).get();
      if (!repo) {
        return { reply: `Repo id=${repoId} not found.`, action: "create_task", data: { error: "repo_not_found" } };
      }
      const additionalRepoIds = params.additional_repo_ids as number[] | undefined;
      const recurring = params.recurring as boolean | undefined;
      const result = db
        .insert(schema.tasks)
        .values({
          repoId,
          title: params.title as string,
          prompt: params.prompt as string,
          workflow: (params.workflow as string) || "plan-implement-pr",
          priority: (params.priority as number) || 5,
          additionalRepoIds: additionalRepoIds?.length ? JSON.stringify(additionalRepoIds) : null,
          recurring: recurring || false,
        })
        .returning()
        .get();
      if (params.auto_run) {
        await executor.triggerTask(result.id);
      }
      return { reply: `Task "${result.title}" created (id=${result.id}) for repo "${repo.name}".`, action: "create_task", data: result };
    }

    case "run_task": {
      const taskId = params.task_id as number;
      const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
      if (!task) {
        return { reply: `Task id=${taskId} not found.`, action: "run_task", data: { error: "task_not_found" } };
      }
      await executor.triggerTask(taskId);
      return { reply: `Task "${task.title}" (id=${taskId}) queued for execution.`, action: "run_task", data: { taskId, status: "queued" } };
    }

    case "pause_task": {
      const taskId = params.task_id as number;
      const paused = executor.pauseTask(taskId);
      return {
        reply: paused ? `Task id=${taskId} paused.` : `Task id=${taskId} is not running.`,
        action: "pause_task",
        data: { taskId, paused },
      };
    }

    case "cancel_task": {
      const taskId = params.task_id as number;
      executor.cancelTask(taskId);
      return { reply: `Task id=${taskId} cancelled.`, action: "cancel_task", data: { taskId } };
    }

    case "list_tasks": {
      const allTasks = db.select().from(schema.tasks).all();
      const allRepos = db.select().from(schema.repos).all();
      const repoMap = new Map(allRepos.map(r => [r.id, r.name]));
      const statusFilter = params.status as string | undefined;
      const filtered = statusFilter ? allTasks.filter((t) => t.status === statusFilter) : allTasks;
      const lines = filtered.map(t => {
        const repo = repoMap.get(t.repoId) || "unknown";
        let line = `#${t.id} "${t.title}" — ${repo} [${t.status}] P${t.priority}`;
        if (t.prUrl) line += ` → PR: ${t.prUrl}`;
        if (t.currentStep) line += ` (step: ${t.currentStep})`;
        if (t.error) line += ` ⚠ ${t.error.slice(0, 80)}`;
        return line;
      });
      const summary = filtered.length === 0
        ? `No tasks found${statusFilter ? ` with status "${statusFilter}"` : ""}.`
        : `${filtered.length} task(s)${statusFilter ? ` (${statusFilter})` : ""}:\n\n${lines.join("\n")}`;
      return { reply: summary, action: "list_tasks", data: filtered };
    }

    case "get_stats": {
      const state = gatherState();
      const stats = {
        repos: state.repos.length,
        totalTasks: state.tasks.length,
        running: state.runningTasks.length,
        completed: state.tasks.filter((t) => t.status === "completed").length,
        failed: state.tasks.filter((t) => t.status === "failed").length,
        pending: state.tasks.filter((t) => t.status === "pending").length,
        schedules: state.schedules.length,
        executorRunning: executor.runningCount,
      };
      const recentPrs = state.recentCompleted.filter(t => t.prUrl).slice(0, 3);
      let reply = `📊 nightcode stats:\n\n`;
      reply += `Repos: ${stats.repos}\n`;
      reply += `Tasks: ${stats.totalTasks} total — ${stats.running} running, ${stats.pending} pending, ${stats.completed} completed, ${stats.failed} failed\n`;
      reply += `Schedules: ${stats.schedules}\n`;
      reply += `Executor: ${stats.executorRunning} task(s) running now`;
      if (recentPrs.length > 0) {
        reply += `\n\nRecent PRs:\n${recentPrs.map(t => `• "${t.title}" → ${t.prUrl}`).join("\n")}`;
      }
      return { reply, action: "get_stats", data: stats };
    }

    case "create_schedule": {
      const result = db
        .insert(schema.schedules)
        .values({
          name: params.name as string,
          intervalMinutes: (params.interval_minutes as number) || null,
          windowStart: (params.window_start as string) || null,
          windowEnd: (params.window_end as string) || null,
          timezone: (params.timezone as string) || "UTC",
          cronExpr: (params.cron_expr as string) || null,
          enabled: true,
        })
        .returning()
        .get();
      return { reply: `Schedule "${result.name}" created (id=${result.id}).`, action: "create_schedule", data: result };
    }

    case "delete_task": {
      const taskId = params.task_id as number;
      executor.cancelTask(taskId); // Cancel if running
      db.delete(schema.tasks).where(eq(schema.tasks.id, taskId)).run();
      return { reply: `Task id=${taskId} deleted.`, action: "delete_task", data: { taskId } };
    }

    case "delete_repo": {
      const repoId = params.repo_id as number;
      db.delete(schema.repos).where(eq(schema.repos.id, repoId)).run();
      return { reply: `Repo id=${repoId} deleted.`, action: "delete_repo", data: { repoId } };
    }

    case "refine_task": {
      const taskId = params.task_id as number;
      const message = params.message as string;
      const parent = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
      if (!parent) return { reply: `Task id=${taskId} not found.`, action: "refine_task", data: { error: "not_found" } };

      const subtask = db.insert(schema.tasks).values({
        repoId: parent.repoId,
        title: `Refine: ${parent.title}`,
        prompt: `Refining "${parent.title}". Feedback: ${message}\n\nOriginal: ${parent.prompt}`,
        workflow: "implement-pr",
        priority: parent.priority,
        status: "pending",
        branchName: parent.branchName,
        sessionId: parent.sessionId,
        parentTaskId: taskId,
        additionalRepoIds: parent.additionalRepoIds,
      }).returning().get();
      return { reply: `Refinement task created (id=${subtask.id}) for "${parent.title}".`, action: "refine_task", data: subtask };
    }

    case "list_schedules": {
      const schedules = db.select().from(schema.schedules).all();
      const lines = schedules.map(s => {
        const interval = s.intervalMinutes ? `every ${s.intervalMinutes}min` : s.cronExpr || "no schedule";
        const window = s.windowStart && s.windowEnd ? ` (${s.windowStart}–${s.windowEnd} ${s.timezone})` : "";
        return `#${s.id} "${s.name}" — ${interval}${window} [${s.enabled ? "enabled" : "disabled"}]${s.nextRun ? ` next: ${new Date(s.nextRun).toLocaleString()}` : ""}`;
      });
      const summary = schedules.length === 0
        ? "No schedules configured."
        : `${schedules.length} schedule(s):\n\n${lines.join("\n")}`;
      return { reply: summary, action: "list_schedules", data: schedules };
    }

    case "toggle_schedule": {
      const scheduleId = params.schedule_id as number;
      const enabled = params.enabled as boolean;
      db.update(schema.schedules).set({ enabled, updatedAt: new Date().toISOString() }).where(eq(schema.schedules.id, scheduleId)).run();
      return { reply: `Schedule id=${scheduleId} ${enabled ? "enabled" : "disabled"}.`, action: "toggle_schedule", data: { scheduleId, enabled } };
    }

    case "delete_schedule": {
      const scheduleId = params.schedule_id as number;
      db.delete(schema.schedules).where(eq(schema.schedules.id, scheduleId)).run();
      return { reply: `Schedule id=${scheduleId} deleted.`, action: "delete_schedule", data: { scheduleId } };
    }

    case "reply": {
      const message = (params.message as string) || "I'm not sure how to help with that.";
      return { reply: message, action: null };
    }

    default:
      return { reply: `Unknown action "${action}". Please try again.`, action: null };
  }
}

// ── Public API ──

export async function processAgentMessage(
  message: string,
  executor: ExecutorPool,
): Promise<ActionResult> {
  try {
    const state = gatherState();
    const systemPrompt = buildSystemPrompt(state);

    log.info({ messageLength: message.length }, "Processing agent message");

    const raw = await askClaude(message, systemPrompt);

    // Parse Claude's JSON response
    let parsed: { action: string; params: Record<string, unknown>; reply: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If Claude didn't return valid JSON, treat as a plain reply
      log.warn({ raw: raw.slice(0, 200) }, "Agent returned non-JSON response");
      return { reply: raw, action: null };
    }

    if (!parsed.action) {
      return { reply: parsed.reply || raw, action: null };
    }

    log.info({ action: parsed.action, params: parsed.params }, "Executing agent action");

    // Execute the action
    const result = await executeAction(parsed.action, parsed.params || {}, executor);

    // Use Claude's reply if the action was just informational
    if (parsed.reply && result.action) {
      result.reply = parsed.reply + " " + result.reply;
    }

    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error({ error: errorMsg }, "Agent processing failed");
    return { reply: `Agent error: ${errorMsg}`, action: null };
  }
}

export function createAgentRoutes(executor: ExecutorPool) {
  const app = new Hono();

  // POST / — process a natural language message
  app.post("/", async (c) => {
    const body = await c.req.json<{ message: string }>();
    if (!body.message || typeof body.message !== "string") {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "\"message\" field is required" } }, 400);
    }

    const result = await processAgentMessage(body.message, executor);
    return c.json({ data: result });
  });

  return app;
}
