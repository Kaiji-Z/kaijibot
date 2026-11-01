import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import { aggregateOnTaskTerminal } from "./aggregate.js";
import { TaskRunner } from "./runner.js";
import { createTaskSafely } from "./service.js";
import { createProductionStepDriver } from "./step-driver.js";
import { TaskStore } from "./store.js";

/**
 * M3-R3 — parent aggregation.
 *
 * A child's terminal transition (runner hook) checks the sibling set: when
 * every subtask is terminal the blocked parent re-queues with the children's
 * results attached; its next step prompt carries them for aggregation, and
 * the parent session is woken.
 */

function config(): KaijiBotConfig {
  return {
    cognitive: { enabled: true, tasks: { enabled: true } },
    agents: { list: [{ id: "main" }, { id: "researcher" }, { id: "writer" }] },
  } as unknown as KaijiBotConfig;
}

describe("parent aggregation (M3-R3)", () => {
  let storeDir: string;
  let store: TaskStore;
  const wakes: Array<{ agentId: string; userId: string; taskId: string }> = [];

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), "kaijibot-task-aggregation-"));
    store = new TaskStore(storeDir);
    wakes.length = 0;
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  function aggregator() {
    return (task: { parentTaskId?: string; parentAgentId?: string; userId: string }) =>
      aggregateOnTaskTerminal(
        {
          store,
          wakeParent: async (p) => {
            wakes.push(p);
          },
        },
        task as Parameters<typeof aggregateOnTaskTerminal>[1],
      );
  }

  it("releases the parent only when all subtasks are terminal", async () => {
    const parent = await store.create("main", "ou_alice", { goal: "父任务" });
    await store.update("main", "ou_alice", parent.id, (t) => ({ ...t, status: "blocked" }));
    const childA = await store.create("researcher", "ou_alice", {
      goal: "子任务A",
      parentTaskId: parent.id,
      parentAgentId: "main",
    });
    const childB = await store.create("writer", "ou_alice", {
      goal: "子任务B",
      parentTaskId: parent.id,
      parentAgentId: "main",
    });

    // First child done → still waiting on B.
    const doneA = await store.update("researcher", "ou_alice", childA.id, (t) => ({
      ...t,
      status: "done",
      result: "A 的结论",
    }));
    expect(await aggregator()(doneA!)).toBe("waiting");
    expect(wakes).toHaveLength(0);
    expect((await store.get("main", "ou_alice", parent.id))?.status).toBe("blocked");

    // Second child failed → all terminal → parent released with results.
    const failedB = await store.update("writer", "ou_alice", childB.id, (t) => ({
      ...t,
      status: "failed",
      result: "B 失败原因",
    }));
    expect(await aggregator()(failedB!)).toBe("released");

    const released = await store.get("main", "ou_alice", parent.id);
    expect(released?.status).toBe("queued");
    expect(released?.subtaskResults).toHaveLength(2);
    const byGoal = new Map(released?.subtaskResults?.map((s) => [s.goal, s]));
    expect(byGoal.get("子任务A")).toMatchObject({
      status: "done",
      agentId: "researcher",
      result: "A 的结论",
    });
    expect(byGoal.get("子任务B")).toMatchObject({ status: "failed", agentId: "writer" });
    expect(wakes).toEqual([{ agentId: "main", userId: "ou_alice", taskId: parent.id }]);
  });

  it("non-subtasks and unblocked parents are ignored", async () => {
    const plain = await store.create("main", "ou_alice", { goal: "普通任务" });
    expect(await aggregator()(plain)).toBe("none");

    const parent = await store.create("main", "ou_alice", { goal: "未停靠的父任务" });
    const child = await store.create("researcher", "ou_alice", {
      goal: "孤儿子任务",
      parentTaskId: parent.id,
      parentAgentId: "main",
    });
    const done = await store.update("researcher", "ou_alice", child.id, (t) => ({
      ...t,
      status: "done",
    }));
    // Parent is queued (not blocked) — aggregation does not touch it.
    expect(await aggregator()(done!)).toBe("none");
    expect((await store.get("main", "ou_alice", parent.id))?.status).toBe("queued");
    expect(wakes).toHaveLength(0);
  });

  it("the released parent's next step prompt carries subtask results (full chain)", async () => {
    const enqueued: Array<{ text: string; contextKey?: string }> = [];
    const heartbeats: Array<{ reason: string }> = [];
    const deliveries: string[] = [];

    // Parent + one child via the service (parent parks as blocked).
    const createdParent = await createTaskSafely(
      { store, config: config(), loadPersona: async () => undefined },
      "main",
      "ou_alice",
      { goal: "需要拆分的任务", maxSteps: 4 },
    );
    expect(createdParent.ok).toBe(true);
    const parent = createdParent.ok ? createdParent.task : undefined;
    const createdChild = await createTaskSafely(
      { store, config: config(), loadPersona: async () => undefined },
      "main",
      "ou_alice",
      { goal: "子任务", assignToAgent: "researcher", parentTaskId: parent!.id },
    );
    expect(createdChild.ok).toBe(true);
    const child = createdChild.ok ? createdChild.task : undefined;
    expect((await store.get("main", "ou_alice", parent!.id))?.status).toBe("blocked");

    const makeRunner = (agentId: string) =>
      new TaskRunner({
        store,
        runStep: createProductionStepDriver({
          sessionKey: `agent:${agentId}:ou_alice`,
          enqueueSystemEvent: (text, options) => {
            enqueued.push({ text, contextKey: options.contextKey });
            return true;
          },
          requestHeartbeatNow: (opts) => {
            heartbeats.push({ reason: opts.reason });
          },
          stepTimeoutMs: 5_000,
          resolveSharedTaskDir: (task) => `/tmp/ws/${task.parentTaskId ?? task.id}`,
        }),
        deliver: async (_task, message) => {
          deliveries.push(message);
        },
        onTaskTerminal: async (task) => {
          await aggregateOnTaskTerminal({ store }, task);
        },
      });

    // Parent's first step reports "not done" → parks blocked via the service
    // call above; simulate: parent step 1 runs BEFORE the child creation
    // would have happened in prod. Here the parent is already blocked, so the
    // runner will not claim it — drive the child instead.
    const childRunner = makeRunner("researcher");
    const childTick = childRunner.tick("researcher", "ou_alice");
    await new Promise((r) => setTimeout(r, 50));
    // The child's agent turn: report done.
    const { createTaskStepReportTool } = await import("../../agents/tools/task-tool.js");
    const report = createTaskStepReportTool();
    await report.execute("child-report", {
      taskId: child!.id,
      stepIndex: 1,
      summary: "子任务结论：X",
      done: true,
    });
    expect(await childTick).toBe(1);

    // Child terminal → aggregation released the parent.
    const released = await store.get("main", "ou_alice", parent!.id);
    expect(released?.status).toBe("queued");
    expect(released?.subtaskResults?.[0]?.result).toBe("子任务结论：X");

    // Parent resumes; its next step prompt must include the results.
    const parentRunner = makeRunner("main");
    const parentTick = parentRunner.tick("main", "ou_alice");
    await new Promise((r) => setTimeout(r, 50));
    const stepPrompt = enqueued.find(
      (e) => e.text.includes("[Task Step") && e.text.includes("需要拆分的任务"),
    );
    expect(stepPrompt?.text).toContain("子任务结果");
    expect(stepPrompt?.text).toContain("子任务结论：X");
    expect(stepPrompt?.text).toContain("/tmp/ws/");
    await report.execute("parent-report", {
      taskId: parent!.id,
      stepIndex: 1,
      summary: "汇总：结合子任务结论 X，任务完成",
      done: true,
    });
    expect(await parentTick).toBe(1);

    const final = await store.get("main", "ou_alice", parent!.id);
    expect(final?.status).toBe("done");
    expect(final?.result).toContain("汇总");
    const resultDelivery = deliveries.find((d) => d.includes("需要拆分的任务"));
    expect(resultDelivery).toContain("汇总");
  });
});
