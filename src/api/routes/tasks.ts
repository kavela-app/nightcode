import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../../db/index.js";
import type { ExecutorPool } from "../../executor/index.js";
import { taskEventBus, type TaskEvent } from "../../executor/event-bus.js";

const createTaskSchema = z.object({
  repoId: z.number().int().positive(),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1),
  workflow: z
    .enum(["implement-pr", "plan-implement-pr", "plan-audit-implement-pr"])
    .default("plan-implement-pr"),
  priority: z.number().int().min(1).max(10).default(5),
  notes: z.string().optional(),
  scheduleId: z.number().int().positive().optional(),
});

export function createTaskRoutes(executor: ExecutorPool) {
  const app = new Hono();

  // List tasks
  app.get("/", (c) => {
    const db = getDb();
    const status = c.req.query("status");
    const repoId = c.req.query("repo_id");

    let query = db.select().from(schema.tasks);

    // Apply filters using where chains
    const tasks = query.all().filter((t) => {
      if (status && t.status !== status) return false;
      if (repoId && t.repoId !== parseInt(repoId, 10)) return false;
      return true;
    });

    return c.json({ data: tasks });
  });

  // Stream task events via SSE
  app.get("/:id/stream", (c) => {
    const id = parseInt(c.req.param("id"), 10);

    // Also send recent messages from DB for catch-up
    const db = getDb();
    const recentMessages = db
      .select()
      .from(schema.sessionMessages)
      .where(eq(schema.sessionMessages.taskId, id))
      .all()
      .slice(-50); // Last 50 messages

    return c.body(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          function send(event: string, data: unknown) {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          }

          // Send catch-up messages
          for (const msg of recentMessages) {
            try {
              const parsed = JSON.parse(msg.content);
              send("message", {
                taskId: id,
                type: "message",
                step: msg.stepName,
                data: parsed,
                timestamp: msg.timestamp,
              });
            } catch {}
          }

          // Send current task + step state
          const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
          if (task) {
            send("task_update", { taskId: id, type: "task_update", data: task, timestamp: new Date().toISOString() });
          }
          const steps = db.select().from(schema.taskSteps).where(eq(schema.taskSteps.taskId, id)).all();
          for (const step of steps) {
            send("step_update", { taskId: id, type: "step_update", step: step.stepName, data: step, timestamp: new Date().toISOString() });
          }

          // Listen for live events
          function onEvent(payload: TaskEvent) {
            if (payload.taskId !== id) return;
            try {
              send(payload.type, payload);
            } catch {
              taskEventBus.off("task", onEvent);
            }
          }

          taskEventBus.on("task", onEvent);

          // Heartbeat to keep connection alive
          const heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": heartbeat\n\n"));
            } catch {
              clearInterval(heartbeat);
            }
          }, 15000);

          // Cleanup when client disconnects
          c.req.raw.signal.addEventListener("abort", () => {
            taskEventBus.off("task", onEvent);
            clearInterval(heartbeat);
            try { controller.close(); } catch {}
          });
        },
      }),
      200,
      {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      }
    );
  });

  // Get single task with steps
  app.get("/:id", (c) => {
    const db = getDb();
    const id = parseInt(c.req.param("id"), 10);

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) return c.json({ error: { code: "NOT_FOUND", message: "Task not found" } }, 404);

    const steps = db
      .select()
      .from(schema.taskSteps)
      .where(eq(schema.taskSteps.taskId, id))
      .all();

    return c.json({ data: { ...task, steps } });
  });

  // Create task
  app.post("/", async (c) => {
    const db = getDb();
    const body = await c.req.json();
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
    }

    // Auto-assign scheduleId if not provided and exactly 1 active schedule exists
    if (!parsed.data.scheduleId) {
      const activeSchedules = db.select().from(schema.schedules)
        .where(eq(schema.schedules.enabled, true)).all();
      if (activeSchedules.length === 1) {
        (parsed.data as any).scheduleId = activeSchedules[0].id;
      }
    }

    // Verify repo exists
    const repo = db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.id, parsed.data.repoId))
      .get();
    if (!repo) {
      return c.json({ error: { code: "NOT_FOUND", message: "Repo not found" } }, 404);
    }

    const result = db.insert(schema.tasks).values(parsed.data).returning().get();
    return c.json({ data: result }, 201);
  });

  // Update task
  app.patch("/:id", async (c) => {
    const db = getDb();
    const id = parseInt(c.req.param("id"), 10);
    const body = await c.req.json();

    const result = db
      .update(schema.tasks)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, id))
      .returning()
      .get();

    if (!result) return c.json({ error: { code: "NOT_FOUND", message: "Task not found" } }, 404);
    return c.json({ data: result });
  });

  // Delete task
  app.delete("/:id", (c) => {
    const db = getDb();
    const id = parseInt(c.req.param("id"), 10);
    executor.cancelTask(id); // Cancel if running
    db.delete(schema.tasks).where(eq(schema.tasks.id, id)).run();
    return c.json({ data: { deleted: true } });
  });

  // Run task immediately
  app.post("/:id/run", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const db = getDb();

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) return c.json({ error: { code: "NOT_FOUND", message: "Task not found" } }, 404);

    if (task.status === "running") {
      return c.json({ error: { code: "CONFLICT", message: "Task is already running" } }, 409);
    }

    await executor.triggerTask(id);
    return c.json({ data: { status: "queued", taskId: id } });
  });

  // Pause task
  app.post("/:id/pause", (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const paused = executor.pauseTask(id);
    if (!paused) {
      return c.json({ error: { code: "NOT_FOUND", message: "Task not running" } }, 404);
    }
    return c.json({ data: { status: "paused", taskId: id } });
  });

  // Resume task
  app.post("/:id/resume", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const db = getDb();

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) return c.json({ error: { code: "NOT_FOUND", message: "Task not found" } }, 404);

    if (task.status !== "paused" && task.status !== "failed") {
      return c.json({ error: { code: "CONFLICT", message: "Task is not paused or failed" } }, 409);
    }

    await executor.triggerTask(id);
    return c.json({ data: { status: "queued", taskId: id } });
  });

  // Cancel task
  app.post("/:id/cancel", (c) => {
    const id = parseInt(c.req.param("id"), 10);
    executor.cancelTask(id);
    return c.json({ data: { status: "cancelled", taskId: id } });
  });

  // Get task steps
  app.get("/:id/steps", (c) => {
    const db = getDb();
    const id = parseInt(c.req.param("id"), 10);

    const steps = db
      .select()
      .from(schema.taskSteps)
      .where(eq(schema.taskSteps.taskId, id))
      .all();

    return c.json({ data: steps });
  });

  // Export task chat as Markdown
  app.get("/:id/export", (c) => {
    const db = getDb();
    const id = parseInt(c.req.param("id"), 10);

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (!task) return c.json({ error: { code: "NOT_FOUND", message: "Task not found" } }, 404);

    const repo = db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.id, task.repoId))
      .get();

    const steps = db
      .select()
      .from(schema.taskSteps)
      .where(eq(schema.taskSteps.taskId, id))
      .all();

    const messages = db
      .select()
      .from(schema.sessionMessages)
      .where(eq(schema.sessionMessages.taskId, id))
      .all();

    // Build Markdown export
    let md = `# Task: ${task.title}\n\n`;
    md += `**Repo:** ${repo?.name || "unknown"} (${repo?.url || ""})\n`;
    md += `**Branch:** ${task.branchName || "N/A"}\n`;
    md += `**Status:** ${task.status}\n`;
    md += `**Workflow:** ${task.workflow}\n`;
    if (task.prUrl) md += `**PR:** ${task.prUrl}\n`;
    md += `**Started:** ${task.startedAt || "N/A"}\n`;
    md += `**Completed:** ${task.completedAt || "N/A"}\n`;
    md += `\n---\n\n`;

    // Group messages by step
    for (const step of steps) {
      md += `## Step: ${step.stepName}\n`;
      md += `*Status: ${step.status}*\n`;
      if (step.startedAt) md += `*Started: ${step.startedAt}*\n`;
      if (step.completedAt) md += `*Completed: ${step.completedAt}*\n`;
      md += `\n`;

      const stepMessages = messages.filter(
        (m) => m.stepName === step.stepName,
      );

      for (const msg of stepMessages) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.type === "assistant" && parsed.content) {
            md += `### Claude\n${parsed.content}\n\n`;
          } else if (parsed.type === "tool_use") {
            md += `> Tool: \`${parsed.tool_name || "unknown"}\`\n\n`;
          }
        } catch {
          md += `${msg.content}\n\n`;
        }
      }

      if (step.result) {
        md += `### Result\n${step.result}\n\n`;
      }

      md += `---\n\n`;
    }

    md += `\n*Generated by [nightcode](https://github.com/Shubhamsaboo/awesome-llm-apps/tree/main/nightcode)*\n`;

    // Return as Markdown or JSON based on Accept header
    const accept = c.req.header("Accept");
    if (accept?.includes("text/markdown")) {
      return c.text(md, 200, { "Content-Type": "text/markdown" });
    }
    return c.json({ data: { markdown: md, task, steps, messageCount: messages.length } });
  });

  return app;
}
