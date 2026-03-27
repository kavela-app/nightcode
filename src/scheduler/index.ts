import { eq } from "drizzle-orm";
import cronParser from "cron-parser";
import { DateTime } from "luxon";
import { getDb, schema } from "../db/index.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("scheduler");

const POLL_INTERVAL = 5000; // 5 seconds

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  start() {
    log.info("Scheduler started");
    this.timer = setInterval(() => this.evaluate(), POLL_INTERVAL);
    // Compute next runs on start
    this.computeNextRuns();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info("Scheduler stopped");
  }

  /**
   * Manually trigger a schedule, creating tasks from its template.
   */
  triggerSchedule(scheduleId: number): number[] {
    const db = getDb();
    const schedule = db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.id, scheduleId))
      .get();

    if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);

    return this.createTasksFromTemplate(schedule);
  }

  private evaluate() {
    const db = getDb();
    const now = new Date().toISOString();

    // Find enabled schedules whose next_run is in the past
    const dueSchedules = db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.enabled, true))
      .all()
      .filter((s) => s.nextRun && s.nextRun <= now);

    for (const schedule of dueSchedules) {
      log.info(
        { scheduleId: schedule.id, name: schedule.name },
        "Schedule triggered",
      );

      try {
        const taskIds = this.createTasksFromTemplate(schedule);
        log.info(
          { scheduleId: schedule.id, tasksCreated: taskIds.length },
          "Tasks created from schedule",
        );

        // Update last run and compute next run
        const nextRun = this.computeNextRun(
          schedule.cronExpr,
          schedule.timezone,
        );

        db.update(schema.schedules)
          .set({
            lastRun: now,
            nextRun,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.schedules.id, schedule.id))
          .run();
      } catch (err) {
        log.error(
          {
            scheduleId: schedule.id,
            error: err instanceof Error ? err.message : String(err),
          },
          "Failed to trigger schedule",
        );
      }
    }
  }

  private createTasksFromTemplate(
    schedule: typeof schema.schedules.$inferSelect,
  ): number[] {
    const db = getDb();
    const template = JSON.parse(schedule.taskTemplate) as {
      repoId: number;
      title: string;
      prompt: string;
      workflow?: string;
      priority?: number;
    };

    const result = db
      .insert(schema.tasks)
      .values({
        repoId: template.repoId,
        title: template.title,
        prompt: template.prompt,
        workflow: template.workflow || "plan-implement-pr",
        priority: template.priority || 5,
        status: "queued",
      })
      .returning({ id: schema.tasks.id })
      .all();

    return result.map((r) => r.id);
  }

  computeNextRuns() {
    const db = getDb();
    const activeSchedules = db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.enabled, true))
      .all();

    for (const schedule of activeSchedules) {
      const nextRun = this.computeNextRun(
        schedule.cronExpr,
        schedule.timezone,
      );

      if (nextRun) {
        db.update(schema.schedules)
          .set({ nextRun, updatedAt: new Date().toISOString() })
          .where(eq(schema.schedules.id, schedule.id))
          .run();
      }
    }
  }

  private computeNextRun(
    cronExpr: string,
    timezone: string,
  ): string | null {
    try {
      const now = DateTime.now().setZone(timezone);
      const interval = cronParser.parseExpression(cronExpr, {
        currentDate: now.toJSDate(),
        tz: timezone,
      });
      const next = interval.next();
      return next.toISOString();
    } catch (err) {
      log.error(
        { cronExpr, timezone, error: err instanceof Error ? err.message : String(err) },
        "Failed to parse cron expression",
      );
      return null;
    }
  }
}
