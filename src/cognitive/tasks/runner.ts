import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { TaskStore } from "./store.js";
import {
  clampText,
  TASK_RESULT_MAX_CHARS,
  TASK_SUMMARY_MAX_CHARS,
  type TaskRecord,
  type TaskStep,
} from "./types.js";

const log = createSubsystemLogger("cognitive/tasks");

/** Outcome of one executed task step, produced by the agent-turn driver. */
export type TaskStepOutcome = {
  summary: string;
  /** The goal has been achieved; summary is the final result. */
  done?: boolean;
  /** Step failed; the runner marks the task failed and delivers the error. */
  error?: string;
};

export type TaskRunnerDeps = {
  store: TaskStore;
  /**
   * Execute one agent turn toward the task goal. Receives the task snapshot
   * including prior steps (progress context). Must NOT mutate the record.
   */
  runStep: (task: TaskRecord) => Promise<TaskStepOutcome>;
  /** Deliver a terminal notification (done/failed/halted) to the user. */
  deliver: (task: TaskRecord, message: string) => Promise<void>;
  now?: () => number;
};

/**
 * Bounded task execution loop.
 *
 * Each tick claims the oldest runnable task (queued, or running from a
 * crashed prior process) and drives it to a terminal state, checkpointing
 * after every step. Budgets are hard brakes: reaching maxSteps or the
 * wall-clock ceiling halts the task with a partial-result notification
 * instead of running forever.
 *
 * Single-process assumption: one gateway process owns the loop; a stale
 * "running" task is resumed (steps are idempotent-ish from the checkpoint).
 */
export class TaskRunner {
  private readonly deps: TaskRunnerDeps;
  private running = false;

  constructor(deps: TaskRunnerDeps) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * Claim the oldest queued task, or a running task left behind by a crash.
   * Atomic claim via store.update under the scoped lock.
   */
  private async claimNext(agentId: string, userId: string): Promise<TaskRecord | undefined> {
    const tasks = await this.deps.store.list(agentId, userId);
    const runnable = tasks
      .filter((t) => t.status === "queued" || t.status === "running")
      .toSorted((a, b) => a.createdAt - b.createdAt);
    const candidate = runnable[0];
    if (!candidate) {
      return undefined;
    }
    const claimed = await this.deps.store.update(agentId, userId, candidate.id, (task) => {
      if (task.status !== "queued" && task.status !== "running") {
        // Lost the claim race; caller re-reads.
        return task;
      }
      return {
        ...task,
        status: "running",
        budget: {
          ...task.budget,
          startedAt: task.budget.startedAt ?? this.now(),
        },
      };
    });
    if (!claimed || (claimed.status !== "running" && claimed.status !== "queued")) {
      return undefined;
    }
    return claimed;
  }

  private budgetExceeded(task: TaskRecord): { reason: "steps" | "wallclock" } | undefined {
    if (task.budget.usedSteps >= task.budget.maxSteps) {
      return { reason: "steps" };
    }
    if (
      task.budget.startedAt !== undefined &&
      this.now() - task.budget.startedAt > task.budget.maxWallClockMs
    ) {
      return { reason: "wallclock" };
    }
    return undefined;
  }

  private async halt(
    agentId: string,
    userId: string,
    task: TaskRecord,
    reason: "steps" | "wallclock",
  ): Promise<TaskRecord> {
    const message =
      reason === "steps"
        ? `任务「${task.goal}」达到步数上限（${task.budget.maxSteps} 步），已暂停。已完成 ${task.budget.usedSteps} 步。`
        : `任务「${task.goal}」超过时间预算（${Math.round(task.budget.maxWallClockMs / 60000)} 分钟），已暂停。已完成 ${task.budget.usedSteps} 步。`;
    const partial =
      task.steps
        .filter((s) => s.status === "ok")
        .map((s) => s.summary)
        .join("\n\n") || "无已完成步骤";
    const halted = await this.deps.store.update(agentId, userId, task.id, (current) => ({
      ...current,
      status: "halted",
      result: clampText(partial, TASK_RESULT_MAX_CHARS),
    }));
    const finalTask = halted ?? task;
    await this.deps.deliver(finalTask, `${message}\n\n部分进展：\n${clampText(partial, 2000)}`);
    log.info("task halted", { taskId: task.id, reason, steps: finalTask.budget.usedSteps });
    return finalTask;
  }

  /** Drive one task to a terminal state with checkpoints after every step. */
  private async drive(agentId: string, userId: string, task: TaskRecord): Promise<void> {
    let current = task;
    for (;;) {
      const exceeded = this.budgetExceeded(current);
      if (exceeded) {
        await this.halt(agentId, userId, current, exceeded.reason);
        return;
      }

      const stepIndex = current.budget.usedSteps + 1;
      const stepStartedAt = this.now();
      let outcome: TaskStepOutcome;
      try {
        outcome = await this.deps.runStep(current);
      } catch (err) {
        outcome = { summary: "", error: err instanceof Error ? err.message : String(err) };
      }

      const step: TaskStep = {
        index: stepIndex,
        startedAt: stepStartedAt,
        endedAt: this.now(),
        summary: clampText(outcome.summary, TASK_SUMMARY_MAX_CHARS),
        status: outcome.error ? "error" : "ok",
        ...(outcome.error ? { error: clampText(outcome.error, 500) } : {}),
      };

      // Checkpoint: persist the step before deciding the next transition, so
      // a crash mid-task loses at most one step of bookkeeping.
      const updated = await this.deps.store.update(agentId, userId, current.id, (t) => ({
        ...t,
        steps: [...t.steps, step],
        budget: {
          ...t.budget,
          usedSteps: t.budget.usedSteps + 1,
          lastStepAt: step.endedAt,
        },
      }));
      if (!updated) {
        // Task vanished (evicted/deleted) — stop silently.
        return;
      }
      current = updated;

      if (outcome.error) {
        const message = `任务「${current.goal}」第 ${stepIndex} 步失败：${step.error ?? "unknown error"}`;
        const failed = await this.deps.store.update(agentId, userId, current.id, (t) => ({
          ...t,
          status: "failed",
          result: clampText(message, TASK_RESULT_MAX_CHARS),
        }));
        await this.deps.deliver(failed ?? current, message);
        log.warn("task step failed", { taskId: current.id, step: stepIndex });
        return;
      }

      if (outcome.done) {
        const message = `任务完成「${current.goal}」：\n${step.summary}`;
        const doneTask = await this.deps.store.update(agentId, userId, current.id, (t) => ({
          ...t,
          status: "done",
          result: clampText(step.summary, TASK_RESULT_MAX_CHARS),
        }));
        await this.deps.deliver(doneTask ?? current, message);
        log.info("task done", { taskId: current.id, steps: current.budget.usedSteps });
        return;
      }

      // The step delegated subtasks (creation flips this task to `blocked`):
      // pause driving here — aggregation wakes the parent when children reach
      // terminal states (M3 multi-agent).
      if (updated.status === "blocked") {
        log.info("task paused waiting on subtasks", { taskId: current.id });
        return;
      }
      // Not done, budget remains — continue to the next step.
    }
  }

  /**
   * One scheduler pass: drive at most `maxTasksPerTick` tasks to terminal
   * state. Re-entrancy guarded (a slow tick must not stack with the next).
   */
  async tick(agentId: string, userId: string, maxTasksPerTick = 1): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    let progressed = 0;
    try {
      while (progressed < maxTasksPerTick) {
        const claimed = await this.claimNext(agentId, userId);
        if (!claimed) {
          break;
        }
        await this.drive(agentId, userId, claimed);
        progressed++;
      }
    } finally {
      this.running = false;
    }
    return progressed;
  }
}
