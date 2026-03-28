import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { runClaude, type ClaudeStreamMessage } from "./claude-cli.js";
import {
  ensureRepo,
  createTaskBranch,
  generateBranchName,
  checkoutExistingBranch,
} from "./git-ops.js";
import {
  generateMcpConfig,
  buildKavelaSystemPrompt,
} from "./mcp-config.js";
import { planStep } from "./steps/plan.js";
import { auditStep } from "./steps/audit.js";
import { implementStep } from "./steps/implement.js";
import { testStep } from "./steps/test.js";
import { prStep } from "./steps/pr.js";
import { createChildLogger } from "../utils/logger.js";
import type { NightcodeConfig } from "../config/index.js";
import { taskEventBus } from "./event-bus.js";

const log = createChildLogger("workflow");

export interface StepDefinition {
  name: string;
  allowedTools: string[];
  resumeFromPrevious?: boolean;
  buildPrompt: (
    task: TaskContext,
    repo: RepoContext,
  ) => string;
  systemPrompt: (repo: RepoContext) => string;
}

export interface TaskContext {
  id: number;
  title: string;
  prompt: string;
  workflow: string;
  branchName: string | null;
  sessionId: string | null;
  notes: string | null;
  nightcodeUrl: string;
  stepResults: Record<string, string>; // step name → result summary
  kavelaSkills: string[]; // skills loaded from Kavela MCP
}

export interface RepoContext {
  id: number;
  name: string;
  url: string;
  branch: string;
  systemPrompt: string | null;
  mcpConfig: string | null;
  kavelaGroup: string | null;
  allowedTools: string | null;
}

const WORKFLOW_STEPS: Record<string, StepDefinition[]> = {
  "implement-pr": [implementStep, prStep],
  "plan-implement-pr": [planStep, implementStep, prStep],
  "plan-audit-implement-pr": [
    planStep,
    auditStep,
    implementStep,
    testStep,
    prStep,
  ],
};

/**
 * Execute a full task workflow: creates branch, runs each step sequentially,
 * creates PR at the end.
 */
export async function executeWorkflow(
  taskId: number,
  config: NightcodeConfig,
  onMessage?: (taskId: number, step: string, msg: ClaudeStreamMessage) => void,
  abortSignal?: AbortSignal,
): Promise<void> {
  const db = getDb();

  // Load task and repo
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  if (!task) throw new Error(`Task ${taskId} not found`);

  const repo = db.select().from(schema.repos).where(eq(schema.repos.id, task.repoId)).get();
  if (!repo) throw new Error(`Repo ${task.repoId} not found`);

  const steps = WORKFLOW_STEPS[task.workflow];
  if (!steps) throw new Error(`Unknown workflow: ${task.workflow}`);

  log.info(
    { taskId, workflow: task.workflow, steps: steps.map((s) => s.name) },
    "Starting workflow execution",
  );

  // Ensure repo is cloned and up to date
  const workDir = await ensureRepo(repo.url, config.reposDir, repo.name);

  // Run npm install in background (non-blocking) if package.json exists
  const packageJsonPath = join(workDir, "package.json");
  if (existsSync(packageJsonPath)) {
    log.info({ taskId }, "Running npm install in background");
    execFile("npm", ["install", "--prefer-offline"], { cwd: workDir, timeout: 120_000 }, (err) => {
      if (err) log.warn({ taskId, error: err.message }, "npm install failed (non-blocking)");
      else log.info({ taskId }, "npm install completed");
    });
  }

  // Create or resume branch
  let branchName = task.branchName;
  if (!branchName) {
    branchName = generateBranchName(task.title);
    await createTaskBranch(workDir, repo.branch, branchName);
    db.update(schema.tasks)
      .set({ branchName, status: "running", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, taskId))
      .run();
  } else if (task.parentTaskId) {
    // Subtask: checkout existing branch and pull latest
    log.info({ taskId, branchName }, "Subtask: checking out existing branch");
    await checkoutExistingBranch(workDir, branchName);
  }

  // Create step records if they don't exist
  const existingSteps = db
    .select()
    .from(schema.taskSteps)
    .where(eq(schema.taskSteps.taskId, taskId))
    .all();

  if (existingSteps.length === 0) {
    for (let i = 0; i < steps.length; i++) {
      db.insert(schema.taskSteps)
        .values({
          taskId,
          stepName: steps[i].name,
          stepOrder: i,
          status: "pending",
        })
        .run();
    }
  }

  // Resolve Kavela API key: prefer env var, fall back to database settings
  let kavelaApiKey = config.kavela.apiKey;
  if (!kavelaApiKey) {
    const row = db.select().from(schema.settings).where(eq(schema.settings.key, "kavela_api_key")).get();
    if (row) kavelaApiKey = row.value;
  }

  // Generate MCP config if needed
  const mcpConfigPath = generateMcpConfig(
    taskId,
    kavelaApiKey,
    repo.mcpConfig,
  );

  let sessionId = task.sessionId;

  // Collect step results for context (e.g., plan output passed to PR step)
  const stepResults: Record<string, string> = {};
  const existingCompletedSteps = db
    .select()
    .from(schema.taskSteps)
    .where(eq(schema.taskSteps.taskId, taskId))
    .all()
    .filter((s) => s.status === "completed" && s.result);
  for (const s of existingCompletedSteps) {
    stepResults[s.stepName] = s.result!;
  }

  // Resolve nightcode URL: env var → settings DB → fallback to localhost
  let nightcodeUrl = config.publicUrl || "";
  if (!nightcodeUrl) {
    const urlRow = db.select().from(schema.settings).where(eq(schema.settings.key, "nightcode_url")).get();
    if (urlRow) nightcodeUrl = urlRow.value;
  }
  if (!nightcodeUrl) {
    nightcodeUrl = `http://localhost:${config.port}`;
  }

  const taskContext: TaskContext = {
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    workflow: task.workflow,
    branchName,
    sessionId,
    notes: task.notes,
    nightcodeUrl,
    stepResults,
    kavelaSkills: [],
  };

  const repoContext: RepoContext = {
    id: repo.id,
    name: repo.name,
    url: repo.url,
    branch: repo.branch,
    systemPrompt: repo.systemPrompt,
    mcpConfig: repo.mcpConfig,
    kavelaGroup: repo.kavelaGroup,
    allowedTools: repo.allowedTools,
  };

  // Execute each step
  for (const stepDef of steps) {
    // Check if aborted
    if (abortSignal?.aborted) {
      log.info({ taskId }, "Workflow aborted");
      db.update(schema.tasks)
        .set({ status: "paused", updatedAt: new Date().toISOString() })
        .where(eq(schema.tasks.id, taskId))
        .run();
      return;
    }

    // Check if task was paused externally
    const currentTask = db
      .select({ status: schema.tasks.status })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .get();

    if (currentTask?.status === "paused" || currentTask?.status === "cancelled") {
      log.info({ taskId, status: currentTask.status }, "Task paused/cancelled, stopping workflow");
      return;
    }

    // Skip completed steps (for resumed tasks)
    const stepRecord = db
      .select()
      .from(schema.taskSteps)
      .where(eq(schema.taskSteps.taskId, taskId))
      .all()
      .find((s) => s.stepName === stepDef.name);

    if (stepRecord?.status === "completed") {
      log.info({ taskId, step: stepDef.name }, "Step already completed, skipping");
      if (stepRecord.sessionId) {
        sessionId = stepRecord.sessionId;
      }
      continue;
    }

    // Execute the step
    await executeStep(
      taskId,
      stepDef,
      taskContext,
      repoContext,
      workDir,
      sessionId,
      mcpConfigPath,
      config,
      (msg) => onMessage?.(taskId, stepDef.name, msg),
      abortSignal,
    );

    // Get updated session ID
    const updatedStep = db
      .select()
      .from(schema.taskSteps)
      .where(eq(schema.taskSteps.taskId, taskId))
      .all()
      .find((s) => s.stepName === stepDef.name);

    // Collect step result for downstream steps (e.g., plan → PR body)
    if (updatedStep?.result) {
      taskContext.stepResults[stepDef.name] = updatedStep.result;
    }

    if (updatedStep?.sessionId) {
      sessionId = updatedStep.sessionId;
      // Update task's session ID for resume capability
      db.update(schema.tasks)
        .set({
          sessionId,
          currentStep: stepDef.name,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.tasks.id, taskId))
        .run();
    }
  }

  // Mark task as completed
  db.update(schema.tasks)
    .set({
      status: "completed",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tasks.id, taskId))
    .run();

  taskEventBus.emit("task", {
    taskId,
    type: "task_update",
    data: { status: "completed", completedAt: new Date().toISOString() },
    timestamp: new Date().toISOString(),
  });

  log.info({ taskId }, "Workflow completed successfully");
}

async function executeStep(
  taskId: number,
  stepDef: StepDefinition,
  task: TaskContext,
  repo: RepoContext,
  workDir: string,
  prevSessionId: string | null,
  mcpConfigPath: string | null,
  config: NightcodeConfig,
  onMessage?: (msg: ClaudeStreamMessage) => void,
  abortSignal?: AbortSignal,
): Promise<void> {
  const db = getDb();

  log.info({ taskId, step: stepDef.name }, "Executing step");

  // Mark step as running
  db.update(schema.taskSteps)
    .set({ status: "running", startedAt: new Date().toISOString() })
    .where(and(eq(schema.taskSteps.taskId, taskId), eq(schema.taskSteps.stepName, stepDef.name)))
    .run();

  taskEventBus.emit("task", {
    taskId,
    type: "step_update",
    step: stepDef.name,
    data: { stepName: stepDef.name, status: "running", startedAt: new Date().toISOString() },
    timestamp: new Date().toISOString(),
  });

  // Update task current step
  db.update(schema.tasks)
    .set({ currentStep: stepDef.name, updatedAt: new Date().toISOString() })
    .where(eq(schema.tasks.id, taskId))
    .run();

  // Build prompt and system prompt
  const prompt = stepDef.buildPrompt(task, repo);
  let systemPrompt = stepDef.systemPrompt(repo);

  // Inject custom system prompt from settings (user-defined, like a CLAUDE.md)
  const customPromptRow = db.select().from(schema.settings).where(eq(schema.settings.key, "custom_system_prompt")).get();
  if (customPromptRow?.value) {
    systemPrompt = `${customPromptRow.value}\n\n${systemPrompt}`;
  }

  // Add Kavela system prompt if MCP is configured
  // Resolve Kavela API key for system prompt: prefer env var, fall back to database settings
  let resolvedKavelaKey = config.kavela.apiKey;
  if (!resolvedKavelaKey) {
    const kavelaRow = getDb().select().from(schema.settings).where(eq(schema.settings.key, "kavela_api_key")).get();
    if (kavelaRow) resolvedKavelaKey = kavelaRow.value;
  }
  const kavelaPrompt = buildKavelaSystemPrompt(!!resolvedKavelaKey, repo.url);
  if (kavelaPrompt) {
    systemPrompt = `${systemPrompt}\n\n${kavelaPrompt}`;
  }

  try {
    const result = await runClaude(
      {
        prompt,
        cwd: workDir,
        allowedTools: stepDef.allowedTools,
        systemPrompt,
        mcpConfigPath: mcpConfigPath || undefined,
        resumeSessionId:
          stepDef.resumeFromPrevious && prevSessionId
            ? prevSessionId
            : undefined,
        outputFormat: "stream-json",
      },
      (msg) => {
        // Persist each message for chat export
        db.insert(schema.sessionMessages)
          .values({
            taskId,
            stepName: stepDef.name,
            messageType: msg.type || "system",
            content: JSON.stringify(msg),
          })
          .run();

        onMessage?.(msg);
      },
      abortSignal,
    );

    // Treat non-zero exit code as failure
    if (result.exitCode !== 0 && result.exitCode !== null) {
      const stderr = result.messages
        .filter((m) => m.type === "system" || m.type === "error")
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .join("\n")
        .trim();
      throw new Error(
        `Claude exited with code ${result.exitCode}${stderr ? ": " + stderr.slice(0, 500) : ""}`
      );
    }

    // Extract result summary from the last assistant message
    const lastAssistant = result.messages
      .filter((m) => m.type === "assistant")
      .pop();
    const resultSummary =
      typeof lastAssistant?.content === "string"
        ? lastAssistant.content.slice(0, 2000)
        : "";

    // Mark THIS step as completed (not all steps!)
    db.update(schema.taskSteps)
      .set({
        status: "completed",
        sessionId: result.sessionId,
        prompt,
        result: resultSummary,
        completedAt: new Date().toISOString(),
      })
      .where(and(eq(schema.taskSteps.taskId, taskId), eq(schema.taskSteps.stepName, stepDef.name)))
      .run();

    taskEventBus.emit("task", {
      taskId,
      type: "step_update",
      step: stepDef.name,
      data: { stepName: stepDef.name, status: "completed", completedAt: new Date().toISOString() },
      timestamp: new Date().toISOString(),
    });

    // Extract PR URL if this was the PR step
    if (stepDef.name === "pr") {
      const prUrl = extractPrUrl(result.messages);
      if (prUrl) {
        const prNumber = parseInt(prUrl.split("/").pop() || "0", 10);
        db.update(schema.tasks)
          .set({ prUrl, prNumber: prNumber || null, updatedAt: new Date().toISOString() })
          .where(eq(schema.tasks.id, taskId))
          .run();
      }
    }

    // Extract Kavela skills loaded during this step
    const skills = extractKavelaSkills(result.messages);
    if (skills.length > 0) {
      // Append to task notes as structured data for PR body / UI
      const existing = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
      const existingSkills: string[] = [];
      try {
        const parsed = JSON.parse(existing?.notes || "{}");
        if (parsed._kavelaSkills) existingSkills.push(...parsed._kavelaSkills);
      } catch { /* notes is plain text, not JSON */ }
      const allSkills = [...new Set([...existingSkills, ...skills])];
      // Store as a settings entry keyed by task ID
      db.insert(schema.settings)
        .values({ key: `task_${taskId}_kavela_skills`, value: JSON.stringify(allSkills) })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value: JSON.stringify(allSkills), updatedAt: new Date().toISOString() },
        })
        .run();
      // Also update task context for downstream steps (e.g., PR body)
      task.kavelaSkills = allSkills;
      log.info({ taskId, step: stepDef.name, skills: allSkills }, "Kavela skills loaded");
    }

    log.info({ taskId, step: stepDef.name, sessionId: result.sessionId }, "Step completed");
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ taskId, step: stepDef.name, error }, "Step failed");

    db.update(schema.taskSteps)
      .set({
        status: "failed",
        result: error,
        completedAt: new Date().toISOString(),
      })
      .where(and(eq(schema.taskSteps.taskId, taskId), eq(schema.taskSteps.stepName, stepDef.name)))
      .run();

    taskEventBus.emit("task", {
      taskId,
      type: "step_update",
      step: stepDef.name,
      data: { stepName: stepDef.name, status: "failed", result: error },
      timestamp: new Date().toISOString(),
    });

    db.update(schema.tasks)
      .set({
        status: "failed",
        error,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.tasks.id, taskId))
      .run();

    throw err;
  }
}

function extractKavelaSkills(messages: ClaudeStreamMessage[]): string[] {
  const skills: string[] = [];
  for (const msg of messages) {
    const blob = JSON.stringify(msg);
    // Look for get_skill tool calls — the skill name is in the input
    if (blob.includes("get_skill")) {
      const nameMatch = blob.match(/"name"\s*:\s*"([^"]+)"/g);
      if (nameMatch) {
        for (const m of nameMatch) {
          const val = m.match(/"name"\s*:\s*"([^"]+)"/);
          if (val && val[1] !== "get_skill") skills.push(val[1]);
        }
      }
    }
    // Also catch check_context results which list skill names
    if (blob.includes("check_context") && blob.includes("relevance")) {
      const skillNames = blob.match(/\{name,([^}]+)\}/g) || [];
      for (const s of skillNames) {
        // Parse "name,domain,relevance,description" entries
        const parts = s.replace(/[{}]/g, "").split(",");
        if (parts[0] === "name" && parts.length > 1) continue; // header row
      }
      // Try to extract skill names from "Name (XX.X% relevance)" patterns
      const relevanceMatches = [...blob.matchAll(/([A-Z][^,\n"]{5,60}),\w+,\d+\.\d+%/g)];
      for (const rm of relevanceMatches) {
        if (rm[1] && !skills.includes(rm[1])) skills.push(rm[1].trim());
      }
    }
  }
  return [...new Set(skills)];
}

function extractPrUrl(messages: ClaudeStreamMessage[]): string | null {
  // Search the full JSON stringification of every message — the PR URL can be
  // in assistant text, tool_result content, or nested message blocks
  const PR_RE = /https:\/\/github\.com\/[^\s)"'\\]+\/pull\/\d+/;
  for (const msg of [...messages].reverse()) {
    const blob = JSON.stringify(msg);
    const match = blob.match(PR_RE);
    if (match) return match[0];
  }
  return null;
}
