import { eq, and } from "drizzle-orm";
import cronParser from "cron-parser";
import { DateTime } from "luxon";
import { getDb, schema } from "../db/index.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("scheduler");

const POLL_INTERVAL = 5000; // 5 seconds

/**
 * Check whether the current time (in the given timezone) falls inside
 * the [windowStart, windowEnd) window.  Handles overnight windows where
 * windowEnd < windowStart (e.g. 22:00 – 06:00).
 */
function isInWindow(
  timezone: string,
  windowStart: string | null,
  windowEnd: string | null,
): boolean {
  if (!windowStart || !windowEnd) return true; // no window means always active

  const now = DateTime.now().setZone(timezone);
  const nowMinutes = now.hour * 60 + now.minute;

  const [sh, sm] = windowStart.split(":").map(Number);
  const [eh, em] = windowEnd.split(":").map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  if (startMinutes <= endMinutes) {
    // Normal window, e.g. 09:00 – 17:00
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  } else {
    // Overnight window, e.g. 22:00 – 06:00
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }
}

/**
 * Find pending tasks linked to this schedule and promote them to "queued".
 */
function activatePendingTasks(scheduleId: number): number[] {
  const db = getDb();
  const pending = db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.scheduleId, scheduleId),
        eq(schema.tasks.status, "pending"),
      ),
    )
    .all();

  const ids: number[] = [];
  for (const task of pending) {
    db.update(schema.tasks)
      .set({ status: "queued", updatedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, task.id))
      .run();
    ids.push(task.id);
  }

  return ids;
}

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
      try {
        // --- Interval-based schedule ---
        if (schedule.intervalMinutes) {
          if (
            !isInWindow(
              schedule.timezone,
              schedule.windowStart,
              schedule.windowEnd,
            )
          ) {
            log.debug(
              { scheduleId: schedule.id, name: schedule.name },
              "Outside window, skipping interval schedule",
            );
            continue;
          }

          const activated = activatePendingTasks(schedule.id);
          log.info(
            { scheduleId: schedule.id, tasksActivated: activated.length },
            "Interval schedule triggered – pending tasks activated",
          );

          const nextRun = this.computeNextRun(schedule);

          db.update(schema.schedules)
            .set({
              lastRun: now,
              nextRun,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.schedules.id, schedule.id))
            .run();

          continue;
        }

        // --- Cron-based schedule ---
        log.info(
          { scheduleId: schedule.id, name: schedule.name },
          "Schedule triggered",
        );

        const taskIds = this.createTasksFromTemplate(schedule);
        log.info(
          { scheduleId: schedule.id, tasksCreated: taskIds.length },
          "Tasks created from schedule",
        );

        // Update last run and compute next run
        const nextRun = this.computeNextRun(schedule);

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
        // Still advance nextRun to prevent infinite retry loop
        const nextRun = this.computeNextRun(schedule);
        if (nextRun) {
          db.update(schema.schedules)
            .set({ nextRun, updatedAt: new Date().toISOString() })
            .where(eq(schema.schedules.id, schedule.id))
            .run();
        }
      }
    }
  }

  private createTasksFromTemplate(
    schedule: typeof schema.schedules.$inferSelect,
  ): number[] {
    if (!schedule.taskTemplate) return [];

    const db = getDb();
    let template;
    try {
      template = JSON.parse(schedule.taskTemplate) as {
        repoId: number;
        title: string;
        prompt: string;
        workflow?: string;
        priority?: number;
      };
    } catch {
      log.error({ scheduleId: schedule.id }, "Invalid task template JSON, skipping");
      return [];
    }

    const result = db
      .insert(schema.tasks)
      .values({
        repoId: template.repoId,
        title: template.title,
        prompt: template.prompt,
        workflow: template.workflow || "plan-implement-pr",
        priority: template.priority || 5,
        status: "queued",
        scheduleId: schedule.id,
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
      const nextRun = this.computeNextRun(schedule);

      if (nextRun) {
        db.update(schema.schedules)
          .set({ nextRun, updatedAt: new Date().toISOString() })
          .where(eq(schema.schedules.id, schedule.id))
          .run();
      }
    }
  }

  private computeNextRun(
    schedule: typeof schema.schedules.$inferSelect,
  ): string | null {
    try {
      // --- Interval-based ---
      if (schedule.intervalMinutes) {
        const base = schedule.lastRun
          ? DateTime.fromISO(schedule.lastRun).setZone(schedule.timezone)
          : DateTime.now().setZone(schedule.timezone);

        let candidate = base.plus({ minutes: schedule.intervalMinutes });

        // Clamp into window if one is defined
        if (schedule.windowStart && schedule.windowEnd) {
          const [sh, sm] = schedule.windowStart.split(":").map(Number);
          const [eh, em] = schedule.windowEnd.split(":").map(Number);
          const startMinutes = sh * 60 + sm;
          const endMinutes = eh * 60 + em;
          const candMinutes = candidate.hour * 60 + candidate.minute;

          if (startMinutes <= endMinutes) {
            // Normal window
            if (candMinutes < startMinutes) {
              candidate = candidate.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
            } else if (candMinutes >= endMinutes) {
              // Next day's window start
              candidate = candidate
                .plus({ days: 1 })
                .set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
            }
          } else {
            // Overnight window – outside means between endMinutes and startMinutes
            if (candMinutes >= endMinutes && candMinutes < startMinutes) {
              candidate = candidate.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
            }
          }
        }

        return candidate.toUTC().toISO();
      }

      // --- Cron-based ---
      if (schedule.cronExpr) {
        const now = DateTime.now().setZone(schedule.timezone);
        const interval = cronParser.parseExpression(schedule.cronExpr, {
          currentDate: now.toJSDate(),
          tz: schedule.timezone,
        });
        const next = interval.next();
        return next.toISOString();
      }

      return null;
    } catch (err) {
      log.error(
        {
          scheduleId: schedule.id,
          error: err instanceof Error ? err.message : String(err),
        },
        "Failed to compute next run",
      );
      return null;
    }
  }
}
