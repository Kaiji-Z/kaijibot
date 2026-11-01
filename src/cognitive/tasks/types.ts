import { randomUUID } from "node:crypto";

/**
 * Cognitive task system — first-class "delegate an outcome" tasks that the
 * agent executes unattended across multiple bounded steps (the local-form
 * counterpart of Grok Bot's always-on task execution).
 *
 * Persisted per (agentId, userId) at
 * `~/.kaijibot/cognitive/tasks/{agentId}/{userId}.json`.
 */

export type TaskStatus =
  | "queued"
  | "running"
  | "blocked"
  | "done"
  | "failed"
  | "halted"
  | "cancelled";

export type TaskStepStatus = "ok" | "halted" | "error";

export type TaskBudget = {
  /** Steps executed so far. */
  usedSteps: number;
  /** Hard step ceiling; reaching it halts the task (T2). */
  maxSteps: number;
  /** Hard wall-clock ceiling in ms measured from the first step start. */
  maxWallClockMs: number;
  /** Timestamp of the first executed step (budget wall-clock anchor). */
  startedAt?: number;
  /** Timestamp of the most recent step (checkpoint freshness). */
  lastStepAt?: number;
};

export type TaskStep = {
  /** 1-based step ordinal. */
  index: number;
  startedAt: number;
  endedAt?: number;
  /** Step outcome summary (assistant final text, truncated). */
  summary: string;
  status: TaskStepStatus;
  error?: string;
};

export type TaskOrigin = "user" | "agent" | "system";

/** Terminal snapshot of one subtask, attached to the parent at aggregation. */
export type SubtaskResult = {
  taskId: string;
  agentId: string;
  goal: string;
  status: TaskStatus;
  result?: string;
};

export type TaskRecord = {
  id: string;
  agentId: string;
  userId: string;
  goal: string;
  status: TaskStatus;
  budget: TaskBudget;
  steps: TaskStep[];
  /** Final result text, set when status reaches done/failed/halted. */
  result?: string;
  createdAt: number;
  updatedAt: number;
  origin: TaskOrigin;
  /**
   * Set on delegated subtasks: the task this one was split from. The parent
   * stays `blocked` while non-terminal children remain (multi-agent M3).
   */
  parentTaskId?: string;
  /** The agent that owns the parent task (direct lookup for aggregation). */
  parentAgentId?: string;
  /**
   * Filled when all subtasks reached terminal states: the parent re-queues
   * and its next step prompt carries these results for aggregation.
   */
  subtaskResults?: SubtaskResult[];
};

export type TaskStoreData = {
  version: 1;
  tasks: TaskRecord[];
};

export const TASKS_STORE_VERSION = 1;

/** Keep bounded history per user; oldest terminal tasks are evicted first. */
export const MAX_TASKS_PER_USER = 200;

export const TASK_SUMMARY_MAX_CHARS = 2000;
export const TASK_GOAL_MAX_CHARS = 4000;
export const TASK_RESULT_MAX_CHARS = 8000;

export const DEFAULT_TASK_MAX_STEPS = 12;
export const DEFAULT_TASK_MAX_WALL_CLOCK_MS = 30 * 60 * 1000;

export function clampText(text: string | undefined, maxChars: number): string {
  const trimmed = (text ?? "").trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}…[truncated]`;
}

export function freshTaskBudget(
  overrides?: Partial<Pick<TaskBudget, "maxSteps" | "maxWallClockMs">>,
): TaskBudget {
  return {
    usedSteps: 0,
    maxSteps: overrides?.maxSteps ?? DEFAULT_TASK_MAX_STEPS,
    maxWallClockMs: overrides?.maxWallClockMs ?? DEFAULT_TASK_MAX_WALL_CLOCK_MS,
  };
}

export function newTaskId(): string {
  return `task-${randomUUID()}`;
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === "done" || status === "failed" || status === "halted" || status === "cancelled";
}
