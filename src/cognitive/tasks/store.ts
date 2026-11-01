import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { getOrCreateScopedAsyncLock, writeTextAtomic } from "../../infra/json-files.js";
import {
  clampText,
  isTerminalTaskStatus,
  MAX_TASKS_PER_USER,
  newTaskId,
  TASK_GOAL_MAX_CHARS,
  TASKS_STORE_VERSION,
  type TaskRecord,
  type TaskStoreData,
} from "./types.js";

const TASKS_DIR = join("cognitive", "tasks");

export type CreateTaskInput = {
  goal: string;
  origin?: TaskRecord["origin"];
  maxSteps?: number;
  maxWallClockMs?: number;
};

/**
 * Persistent task store. Follows the scoped-lock store pattern
 * (see PersonaStore): multiple instances exist in one gateway process, so
 * per-instance locks would not serialize their writes.
 */
export class TaskStore {
  constructor(private readonly configDir: string) {}

  private async withLock<T>(agentId: string, userId: string, fn: () => Promise<T>): Promise<T> {
    const lock = getOrCreateScopedAsyncLock(`tasks:${this.configDir}:${agentId}/${userId}`);
    return lock(fn);
  }

  private filePath(agentId: string, userId: string): string {
    return join(this.configDir, TASKS_DIR, agentId, `${userId}.json`);
  }

  // Raw read, for use INSIDE withLock (the scoped lock is non-reentrant).
  private async readUnlocked(agentId: string, userId: string): Promise<TaskStoreData> {
    const path = this.filePath(agentId, userId);
    if (!existsSync(path)) {
      return { version: TASKS_STORE_VERSION, tasks: [] };
    }
    try {
      const raw = await readFile(path, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as Record<string, unknown>).version !== TASKS_STORE_VERSION ||
        !Array.isArray((parsed as Record<string, unknown>).tasks)
      ) {
        return { version: TASKS_STORE_VERSION, tasks: [] };
      }
      return parsed as TaskStoreData;
    } catch {
      // Corrupt file: start fresh rather than crash the pipeline. Task
      // history is best-effort; the task system is recoverable by re-run.
      return { version: TASKS_STORE_VERSION, tasks: [] };
    }
  }

  // Raw write, for use INSIDE withLock.
  private async writeUnlocked(agentId: string, userId: string, data: TaskStoreData): Promise<void> {
    await writeTextAtomic(this.filePath(agentId, userId), JSON.stringify(data, null, 2));
  }

  /** Evict oldest terminal tasks when history exceeds the cap. */
  private enforceCap(data: TaskStoreData): TaskStoreData {
    if (data.tasks.length <= MAX_TASKS_PER_USER) {
      return data;
    }
    const terminal = new Set(
      data.tasks.filter((t) => isTerminalTaskStatus(t.status)).map((t) => t.id),
    );
    const sorted = data.tasks.toSorted((a, b) => a.updatedAt - b.updatedAt);
    const evict = new Set<string>();
    let excess = data.tasks.length - MAX_TASKS_PER_USER;
    for (const task of sorted) {
      if (excess <= 0) {
        break;
      }
      if (terminal.has(task.id)) {
        evict.add(task.id);
        excess--;
      }
    }
    // Still over cap (too many non-terminal tasks — abnormal but bounded):
    // evict oldest regardless of status.
    for (const task of sorted) {
      if (excess <= 0) {
        break;
      }
      if (!evict.has(task.id)) {
        evict.add(task.id);
        excess--;
      }
    }
    return { version: TASKS_STORE_VERSION, tasks: data.tasks.filter((t) => !evict.has(t.id)) };
  }

  async list(agentId: string, userId: string): Promise<TaskRecord[]> {
    return this.withLock(
      agentId,
      userId,
      async () => (await this.readUnlocked(agentId, userId)).tasks,
    );
  }

  async get(agentId: string, userId: string, taskId: string): Promise<TaskRecord | undefined> {
    const tasks = await this.list(agentId, userId);
    return tasks.find((t) => t.id === taskId);
  }

  /** All userIds under an agent that have a task file (for tick fan-out). */
  async listUserIds(agentId: string): Promise<string[]> {
    try {
      const entries = await readdir(join(this.configDir, TASKS_DIR, agentId));
      return entries
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -5))
        .toSorted();
    } catch {
      return [];
    }
  }

  /** All agentIds that have at least one task file. */
  async listAgentIds(): Promise<string[]> {
    try {
      const entries = await readdir(join(this.configDir, TASKS_DIR));
      const result: string[] = [];
      for (const name of entries) {
        const entryStat = await stat(join(this.configDir, TASKS_DIR, name));
        if (entryStat.isDirectory()) {
          result.push(name);
        }
      }
      return result.toSorted();
    } catch {
      return [];
    }
  }

  async create(agentId: string, userId: string, input: CreateTaskInput): Promise<TaskRecord> {
    const goal = clampText(input.goal, TASK_GOAL_MAX_CHARS);
    if (!goal) {
      throw new Error("Task goal must not be empty");
    }
    const now = Date.now();
    const record: TaskRecord = {
      id: newTaskId(),
      agentId,
      userId,
      goal,
      status: "queued",
      budget: {
        usedSteps: 0,
        maxSteps: input.maxSteps ?? 12,
        maxWallClockMs: input.maxWallClockMs ?? 30 * 60 * 1000,
      },
      steps: [],
      createdAt: now,
      updatedAt: now,
      origin: input.origin ?? "user",
    };
    await this.withLock(agentId, userId, async () => {
      const data = await this.readUnlocked(agentId, userId);
      data.tasks.push(record);
      await this.writeUnlocked(agentId, userId, this.enforceCap(data));
    });
    return record;
  }

  /**
   * Atomically load → mutate → save a task record. Returns the updated
   * record, or undefined when the task does not exist.
   */
  async update(
    agentId: string,
    userId: string,
    taskId: string,
    mutator: (task: TaskRecord) => TaskRecord | Promise<TaskRecord>,
  ): Promise<TaskRecord | undefined> {
    let updated: TaskRecord | undefined;
    await this.withLock(agentId, userId, async () => {
      const data = await this.readUnlocked(agentId, userId);
      const idx = data.tasks.findIndex((t) => t.id === taskId);
      if (idx < 0) {
        return;
      }
      const next = await mutator(data.tasks[idx]!);
      next.updatedAt = Date.now();
      data.tasks[idx] = next;
      await this.writeUnlocked(agentId, userId, this.enforceCap(data));
      updated = next;
    });
    return updated;
  }
}
