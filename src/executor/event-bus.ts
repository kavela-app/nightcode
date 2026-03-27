import { EventEmitter } from "node:events";

export interface TaskEvent {
  taskId: number;
  type: "message" | "step_update" | "task_update";
  step?: string;
  data: unknown;
  timestamp: string;
}

class TaskEventBus extends EventEmitter {
  emit(event: "task", payload: TaskEvent): boolean {
    return super.emit("task", payload);
  }

  on(event: "task", listener: (payload: TaskEvent) => void): this {
    return super.on("task", listener);
  }

  off(event: "task", listener: (payload: TaskEvent) => void): this {
    return super.off("task", listener);
  }
}

export const taskEventBus = new TaskEventBus();
taskEventBus.setMaxListeners(100);
