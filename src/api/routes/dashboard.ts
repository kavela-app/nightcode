import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import type { ExecutorPool } from "../../executor/index.js";

export function createDashboardRoutes(executor: ExecutorPool) {
  const app = new Hono();

  // Dashboard stats
  app.get("/stats", (c) => {
    const db = getDb();

    const allTasks = db.select().from(schema.tasks).all();

    const stats = {
      tasks: {
        total: allTasks.length,
        pending: allTasks.filter((t) => t.status === "pending").length,
        queued: allTasks.filter((t) => t.status === "queued").length,
        running: allTasks.filter((t) => t.status === "running").length,
        paused: allTasks.filter((t) => t.status === "paused").length,
        completed: allTasks.filter((t) => t.status === "completed").length,
        failed: allTasks.filter((t) => t.status === "failed").length,
      },
      executor: {
        runningTaskIds: executor.runningTaskIds,
        runningCount: executor.runningCount,
      },
      repos: db.select().from(schema.repos).all().length,
      schedules: db
        .select()
        .from(schema.schedules)
        .where(eq(schema.schedules.enabled, true))
        .all().length,
      recentPrs: allTasks
        .filter((t) => t.prUrl)
        .sort((a, b) =>
          (b.completedAt || "").localeCompare(a.completedAt || ""),
        )
        .slice(0, 5)
        .map((t) => ({
          taskId: t.id,
          title: t.title,
          prUrl: t.prUrl,
          completedAt: t.completedAt,
        })),
    };

    return c.json({ data: stats });
  });

  return app;
}
