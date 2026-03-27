import { eq, and, lte } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { executeWorkflow } from "./workflow-engine.js";
import type { ClaudeStreamMessage } from "./claude-cli.js";
import type { NightcodeConfig } from "../config/index.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("executor");

const POLL_INTERVAL = 5000; // 5 seconds

type MessageCallback = (
  taskId: number,
  step: string,
  msg: ClaudeStreamMessage,
) => void;

export class ExecutorPool {
  private running = new Map<number, AbortController>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private config: NightcodeConfig;
  private onMessage?: MessageCallback;

  constructor(config: NightcodeConfig, onMessage?: MessageCallback) {
    this.config = config;
    this.onMessage = onMessage;
  }

  start() {
    log.info(
      { maxConcurrent: this.config.maxConcurrent },
      "Executor pool started",
    );
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL);
    // Run immediately on start
    this.poll();
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // Abort all running tasks
    for (const [taskId, controller] of this.running) {
      log.info({ taskId }, "Aborting running task");
      controller.abort();
    }
    this.running.clear();
    log.info("Executor pool stopped");
  }

  get runningCount(): number {
    return this.running.size;
  }

  get runningTaskIds(): number[] {
    return Array.from(this.running.keys());
  }

  /**
   * Trigger immediate execution of a specific task.
   */
  async triggerTask(taskId: number): Promise<void> {
    if (this.running.has(taskId)) {
      log.warn({ taskId }, "Task is already running");
      return;
    }

    const db = getDb();
    db.update(schema.tasks)
      .set({ status: "queued", updatedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, taskId))
      .run();

    // If we have capacity, start immediately
    if (this.running.size < this.config.maxConcurrent) {
      await this.startTask(taskId);
    }
  }

  /**
   * Pause a running task.
   */
  pauseTask(taskId: number): boolean {
    const controller = this.running.get(taskId);
    if (!controller) return false;

    const db = getDb();
    db.update(schema.tasks)
      .set({ status: "paused", updatedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, taskId))
      .run();

    controller.abort();
    this.running.delete(taskId);
    log.info({ taskId }, "Task paused");
    return true;
  }

  /**
   * Cancel a running or queued task.
   */
  cancelTask(taskId: number): boolean {
    const db = getDb();
    const controller = this.running.get(taskId);

    if (controller) {
      controller.abort();
      this.running.delete(taskId);
    }

    db.update(schema.tasks)
      .set({ status: "cancelled", updatedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, taskId))
      .run();

    log.info({ taskId }, "Task cancelled");
    return true;
  }

  private async poll() {
    if (this.running.size >= this.config.maxConcurrent) return;

    const db = getDb();
    const slotsAvailable = this.config.maxConcurrent - this.running.size;

    // Find queued tasks ordered by priority
    const queuedTasks = db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.status, "queued"))
      .orderBy(schema.tasks.priority)
      .limit(slotsAvailable)
      .all();

    for (const task of queuedTasks) {
      if (this.running.size >= this.config.maxConcurrent) break;
      await this.startTask(task.id);
    }
  }

  private async startTask(taskId: number) {
    if (this.running.has(taskId)) return;

    const controller = new AbortController();
    this.running.set(taskId, controller);

    log.info({ taskId, running: this.running.size }, "Starting task execution");

    // Run in background (don't await)
    executeWorkflow(taskId, this.config, this.onMessage, controller.signal)
      .catch((err) => {
        log.error(
          { taskId, error: err.message },
          "Task execution failed",
        );
        const db = getDb();
        db.update(schema.tasks)
          .set({
            status: "failed",
            error: err.message,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.tasks.id, taskId))
          .run();
      })
      .finally(() => {
        this.running.delete(taskId);
        log.info(
          { taskId, running: this.running.size },
          "Task finished, slot freed",
        );
      });
  }
}
