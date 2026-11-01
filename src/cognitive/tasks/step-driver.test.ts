import { describe, expect, it, vi } from "vitest";
import { createProductionStepDriver, pendingStepCount, reportStepOutcome } from "./step-driver.js";

describe("step driver", () => {
  it("resolves a pending step via reportStepOutcome (task_step_report path)", async () => {
    const enqueued: Array<{ text: string; contextKey?: string }> = [];
    const heartbeats: string[] = [];
    const driver = createProductionStepDriver({
      sessionKey: "agent:main:ou_alice",
      enqueueSystemEvent: (text, options) => {
        enqueued.push({ text, contextKey: options.contextKey });
        return true;
      },
      requestHeartbeatNow: (opts) => {
        heartbeats.push(opts.reason);
      },
    });

    const task = {
      id: "task-x",
      budget: { usedSteps: 0, maxSteps: 5, maxWallClockMs: 60_000 },
      steps: [],
    } as never;

    const pending = driver(task);
    await vi.waitFor(() => expect(pendingStepCount()).toBe(1));
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.text).toContain("[Task Step 1/5]");
    expect(enqueued[0]!.text).toContain("task_step_report");
    expect(enqueued[0]!.contextKey).toBe("task:task-x:1");
    expect(heartbeats).toEqual(["cognitive-task"]);

    const report = reportStepOutcome({
      taskId: "task-x",
      stepIndex: 1,
      summary: "第一步完成",
      done: true,
    });
    expect(report.delivered).toBe(true);

    const outcome = await pending;
    expect(outcome.summary).toBe("第一步完成");
    expect(outcome.done).toBe(true);
    expect(pendingStepCount()).toBe(0);
  });

  it("returns an error outcome when enqueue fails (no routable session)", async () => {
    const driver = createProductionStepDriver({
      sessionKey: "agent:main:ou_ghost",
      enqueueSystemEvent: () => false,
      requestHeartbeatNow: () => {},
    });
    const task = { id: "task-y", budget: { usedSteps: 0, maxSteps: 3 }, steps: [] } as never;
    const outcome = await driver(task);
    expect(outcome.error).toContain("Failed to enqueue");
    expect(pendingStepCount()).toBe(0);
  });

  it("times out a step that never reports", async () => {
    vi.useFakeTimers();
    try {
      const driver = createProductionStepDriver({
        sessionKey: "agent:main:ou_slow",
        enqueueSystemEvent: () => true,
        requestHeartbeatNow: () => {},
        stepTimeoutMs: 1000,
      });
      const task = { id: "task-z", budget: { usedSteps: 0, maxSteps: 3 }, steps: [] } as never;
      const pending = driver(task);
      await vi.waitFor(() => expect(pendingStepCount()).toBe(1));
      vi.advanceTimersByTime(1500);
      const outcome = await pending;
      expect(outcome.error).toContain("timed out");
      expect(pendingStepCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a report for an unknown step", () => {
    const result = reportStepOutcome({ taskId: "nope", stepIndex: 1, summary: "x" });
    expect(result.delivered).toBe(false);
  });
});
