import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskRunner, type TaskStepOutcome } from "./runner.js";
import { TaskStore } from "./store.js";
import type { TaskRecord } from "./types.js";

const AGENT = "main";
const USER = "test-user";

describe("TaskRunner", () => {
  let tempDir: string;
  let store: TaskStore;
  let delivered: Array<{ taskId: string; message: string }>;
  let deliver: (task: TaskRecord, message: string) => Promise<void>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kaijibot-task-runner-"));
    store = new TaskStore(tempDir);
    delivered = [];
    deliver = async (task, message) => {
      delivered.push({ taskId: task.id, message });
    };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeRunner(runStep: (task: TaskRecord) => Promise<TaskStepOutcome>) {
    return new TaskRunner({ store, runStep, deliver });
  }

  it("drives a multi-step task to done with checkpoints and delivery (T1 core)", async () => {
    const created = await store.create(AGENT, USER, { goal: "调研并写摘要" });
    let calls = 0;
    const runner = makeRunner(async (task) => {
      calls++;
      expect(task.steps).toHaveLength(calls - 1); // each call sees prior checkpoints
      if (calls < 3) {
        return { summary: `进展 ${calls}` };
      }
      return { summary: "最终摘要", done: true };
    });

    const progressed = await runner.tick(AGENT, USER);
    expect(progressed).toBe(1);
    expect(calls).toBe(3);

    const final = await store.get(AGENT, USER, created.id);
    expect(final?.status).toBe("done");
    expect(final?.budget.usedSteps).toBe(3);
    expect(final?.steps.map((s) => s.summary)).toEqual(["进展 1", "进展 2", "最终摘要"]);
    expect(final?.result).toBe("最终摘要");

    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.taskId).toBe(created.id);
    expect(delivered[0]!.message).toContain("任务完成");
    expect(delivered[0]!.message).toContain("最终摘要");
  });

  it("halts at maxSteps with partial-result notification (T2)", async () => {
    const created = await store.create(AGENT, USER, { goal: "无限任务", maxSteps: 3 });
    let calls = 0;
    const runner = makeRunner(async () => {
      calls++;
      return { summary: `第 ${calls} 步进展` }; // never done
    });

    await runner.tick(AGENT, USER);

    expect(calls).toBe(3);
    const final = await store.get(AGENT, USER, created.id);
    expect(final?.status).toBe("halted");
    expect(final?.budget.usedSteps).toBe(3);
    expect(final?.result).toContain("第 3 步进展");

    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.message).toContain("步数上限");
    expect(delivered[0]!.message).toContain("部分进展");
  });

  it("halts when the wall-clock budget is exceeded", async () => {
    let fakeNow = 1_000_000;
    const created = await store.create(AGENT, USER, {
      goal: "慢任务",
      maxSteps: 100,
      maxWallClockMs: 60_000,
    });
    const runner = new TaskRunner({
      store,
      deliver,
      now: () => fakeNow,
      runStep: async () => {
        fakeNow += 30_000; // each step burns 30 fake-minutes... 30s
        return { summary: "进展" };
      },
    });

    await runner.tick(AGENT, USER);

    const final = await store.get(AGENT, USER, created.id);
    // startedAt=1_000_000; after 3 steps fakeNow=1_090_000 > 60_000ms budget → halted at step 4 check
    expect(final?.status).toBe("halted");
    expect(final?.budget.usedSteps).toBe(3);
  });

  it("reports progress only for non-terminal steps (chat-first visibility)", async () => {
    const created = await store.create(AGENT, USER, { goal: "三步任务" });
    let calls = 0;
    const progress: Array<{ taskId: string; stepIndex: number; summary: string }> = [];
    const runner = new TaskRunner({
      store,
      runStep: async () => {
        calls++;
        return calls < 3 ? { summary: `进展 ${calls}` } : { summary: "完成", done: true };
      },
      deliver,
      deliverProgress: async (task, stepIndex, summary) => {
        progress.push({ taskId: task.id, stepIndex, summary });
      },
    });

    await runner.tick(AGENT, USER);

    // Steps 1-2 continue the task → progress fires; step 3 is terminal
    // (done) → covered by the final deliver, never double-notified.
    expect(progress).toEqual([
      { taskId: created.id, stepIndex: 1, summary: "进展 1" },
      { taskId: created.id, stepIndex: 2, summary: "进展 2" },
    ]);
    expect(delivered).toHaveLength(1);
  });

  it("does not fire progress for error steps, and a failing progress channel never breaks the loop", async () => {
    await store.create(AGENT, USER, { goal: "先成功后失败" });
    let calls = 0;
    const progressCalls: number[] = [];
    const runner = new TaskRunner({
      store,
      runStep: async () => {
        calls++;
        return calls === 1 ? { summary: "ok" } : { summary: "", error: "第二步挂了" };
      },
      deliver,
      deliverProgress: async (_task, stepIndex) => {
        progressCalls.push(stepIndex);
        throw new Error("progress channel down");
      },
    });

    await runner.tick(AGENT, USER);

    // Step 1 would fire progress (channel errors are swallowed); step 2 is
    // an error step → no progress call at all, only the failure delivery.
    expect(progressCalls).toEqual([1]);
    expect(delivered[0]!.message).toContain("第二步挂了");
    const final = await store.list(AGENT, USER);
    expect(final[0]?.status).toBe("failed");
  });

  it("marks a task failed when a step errors, and delivers the error", async () => {
    const created = await store.create(AGENT, USER, { goal: "会失败的任务" });
    const runner = makeRunner(async () => ({
      summary: "",
      error: "工具不可用",
    }));

    await runner.tick(AGENT, USER);

    const final = await store.get(AGENT, USER, created.id);
    expect(final?.status).toBe("failed");
    expect(final?.steps[0]?.status).toBe("error");
    expect(delivered[0]!.message).toContain("工具不可用");
  });

  it("treats a thrown runStep as a step error", async () => {
    await store.create(AGENT, USER, { goal: "抛错任务" });
    const runner = makeRunner(async () => {
      throw new Error("boom");
    });

    await runner.tick(AGENT, USER);

    const tasks = await store.list(AGENT, USER);
    expect(tasks[0]?.status).toBe("failed");
    expect(tasks[0]?.steps[0]?.error).toContain("boom");
  });

  it("resumes a running task left by a crashed process (crash recovery)", async () => {
    const created = await store.create(AGENT, USER, { goal: "恢复任务" });
    // Simulate a crash after one checkpointed step.
    await store.update(AGENT, USER, created.id, (task) => ({
      ...task,
      status: "running",
      budget: { ...task.budget, usedSteps: 1, startedAt: Date.now(), lastStepAt: Date.now() },
      steps: [
        { index: 1, startedAt: Date.now(), endedAt: Date.now(), summary: "步骤一", status: "ok" },
      ],
    }));

    const runner = makeRunner(async () => ({ summary: "恢复后完成", done: true }));
    const progressed = await runner.tick(AGENT, USER);

    expect(progressed).toBe(1);
    const final = await store.get(AGENT, USER, created.id);
    expect(final?.status).toBe("done");
    expect(final?.steps).toHaveLength(2);
    expect(final?.steps[1]?.summary).toBe("恢复后完成");
  });

  it("tick is a no-op when nothing is runnable, and does not touch terminal tasks", async () => {
    const done = await store.create(AGENT, USER, { goal: "已完成" });
    await store.update(AGENT, USER, done.id, (t) => ({ ...t, status: "done", result: "ok" }));

    let calls = 0;
    const runner = makeRunner(async () => {
      calls++;
      return { summary: "x", done: true };
    });

    const progressed = await runner.tick(AGENT, USER);
    expect(progressed).toBe(0);
    expect(calls).toBe(0);
  });

  it("is re-entrancy guarded: a stacked tick returns 0", async () => {
    await store.create(AGENT, USER, { goal: "慢步骤" });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = makeRunner(async () => {
      await gate;
      return { summary: "done", done: true };
    });

    const first = runner.tick(AGENT, USER);
    const stacked = await runner.tick(AGENT, USER); // runs while first is in-flight
    expect(stacked).toBe(0);
    release!();
    await first;
  });
});
