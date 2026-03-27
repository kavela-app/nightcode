import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../../db/index.js";
import type { Scheduler } from "../../scheduler/index.js";

const createScheduleSchema = z.object({
  name: z.string().min(1).max(100),
  cronExpr: z.string().min(1),
  timezone: z.string().default("UTC"),
  enabled: z.boolean().default(true),
  taskTemplate: z.object({
    repoId: z.number().int().positive(),
    title: z.string().min(1),
    prompt: z.string().min(1),
    workflow: z.string().default("plan-implement-pr"),
    priority: z.number().int().min(1).max(10).default(5),
  }),
});

export function createScheduleRoutes(scheduler: Scheduler) {
  const app = new Hono();

  // List schedules
  app.get("/", (c) => {
    const db = getDb();
    const schedules = db.select().from(schema.schedules).all();
    return c.json({ data: schedules });
  });

  // Get single schedule
  app.get("/:id", (c) => {
    const db = getDb();
    const id = parseInt(c.req.param("id"), 10);
    const schedule = db.select().from(schema.schedules).where(eq(schema.schedules.id, id)).get();
    if (!schedule) return c.json({ error: { code: "NOT_FOUND", message: "Schedule not found" } }, 404);
    return c.json({ data: schedule });
  });

  // Create schedule
  app.post("/", async (c) => {
    const db = getDb();
    const body = await c.req.json();
    const parsed = createScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
    }

    const result = db
      .insert(schema.schedules)
      .values({
        name: parsed.data.name,
        cronExpr: parsed.data.cronExpr,
        timezone: parsed.data.timezone,
        enabled: parsed.data.enabled,
        taskTemplate: JSON.stringify(parsed.data.taskTemplate),
      })
      .returning()
      .get();

    // Recompute next runs
    scheduler.computeNextRuns();

    return c.json({ data: result }, 201);
  });

  // Update schedule
  app.patch("/:id", async (c) => {
    const db = getDb();
    const id = parseInt(c.req.param("id"), 10);
    const body = await c.req.json();

    if (body.taskTemplate && typeof body.taskTemplate === "object") {
      body.taskTemplate = JSON.stringify(body.taskTemplate);
    }

    const result = db
      .update(schema.schedules)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(schema.schedules.id, id))
      .returning()
      .get();

    if (!result) return c.json({ error: { code: "NOT_FOUND", message: "Schedule not found" } }, 404);

    scheduler.computeNextRuns();

    return c.json({ data: result });
  });

  // Delete schedule
  app.delete("/:id", (c) => {
    const db = getDb();
    const id = parseInt(c.req.param("id"), 10);
    db.delete(schema.schedules).where(eq(schema.schedules.id, id)).run();
    return c.json({ data: { deleted: true } });
  });

  // Manually trigger schedule
  app.post("/:id/trigger", (c) => {
    const id = parseInt(c.req.param("id"), 10);
    try {
      const taskIds = scheduler.triggerSchedule(id);
      return c.json({ data: { triggered: true, taskIds } });
    } catch (err) {
      return c.json(
        { error: { code: "NOT_FOUND", message: err instanceof Error ? err.message : "Schedule not found" } },
        404,
      );
    }
  });

  return app;
}
