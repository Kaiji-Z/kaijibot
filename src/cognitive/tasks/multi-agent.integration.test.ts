import { describe, expect, it, vi } from "vitest";
import { createTaskTool, createTaskStepReportTool } from "../../agents/tools/task-tool.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { aggregateOnTaskTerminal } from "./aggregate.js";
import { TaskRunner } from "./runner.js";
import { createTaskSafely } from "./service.js";
import { createProductionStepDriver } from "./step-driver.js";
import { TaskStore } from "./store.js";

/**
 * T9 — dual-agent task e2e (stub LLM).
 *
 * The parent task's first agent turn splits it into two subtasks via the
 * REAL task_create tool (assignToAgent researcher/writer); each assigned
 * agent's runner executes its child unattended (production step driver +
 * real task_step_report); when both children finish, aggregation releases
 * the parent whose next step merges the results and delivers them.
 *
 * The store directory follows the runtime CONFIG_DIR constant so the real
 * tool (which resolves it the same way) shares this store.
 */

const USER = "ou_t9";
const PARENT_SESSION = "agent:main:ou_t9";

/**
 * Wait until a matching system event has been enqueued. Coordination via
 * waitFor instead of fixed sleeps: full-CI parallel load regularly blew the
 * fixed 50ms budgets and turned this suite into the flakiest lane.
 */
function waitForEnqueued(
  enqueued: Array<{ text: string; sessionKey: string }>,
  match: (text: string, sessionKey: string) => boolean,
) {
  return vi.waitFor(
    () => {
      // Last match: any earlier duplicate is superseded by the freshest one.
      const hit = [...enqueued].reverse().find((e) => match(e.text, e.sessionKey));
      expect(
        hit,
        `no enqueued event matched within the wait window (${enqueued.length} events so far)`,
      ).toBeTruthy();
      return hit;
    },
    { timeout: 10_000 },
  );
}

function config(): KaijiBotConfig {
  return {
    cognitive: { enabled: true, tasks: { enabled: true } },
    agents: { list: [{ id: "main" }, { id: "researcher" }, { id: "writer" }] },
  } as unknown as KaijiBotConfig;
}

describe("multi-agent task e2e (T9)", () => {
  it("splits into two subtasks, both agents execute, parent merges and delivers", async () => {
    const { CONFIG_DIR } = await import("../../utils.js");
    const store = new TaskStore(CONFIG_DIR);

    const enqueued: Array<{ text: string; sessionKey: string }> = [];
    const deliveries: string[] = [];

    const makeRunner = (agentId: string) =>
      new TaskRunner({
        store,
        runStep: createProductionStepDriver({
          sessionKey: `agent:${agentId}:${USER}`,
          enqueueSystemEvent: (text, options) => {
            enqueued.push({ text, sessionKey: options.sessionKey });
            return true;
          },
          requestHeartbeatNow: () => {},
          stepTimeoutMs: 5_000,
          resolveSharedTaskDir: (task) =>
            `/ws/${task.parentAgentId ?? task.agentId}/${task.parentTaskId ?? task.id}`,
        }),
        deliver: async (task, message) => {
          deliveries.push(`[${task.agentId}] ${message}`);
        },
        onTaskTerminal: async (task) => {
          await aggregateOnTaskTerminal({ store }, task);
        },
      });

    // 1. User-facing parent task on the main agent.
    const created = await createTaskSafely(
      { store, config: config(), loadPersona: async () => undefined },
      "main",
      USER,
      { goal: "分别调研 A 与起草 B，并合并成一份简报", maxSteps: 4 },
    );
    expect(created.ok).toBe(true);
    const parent = created.ok ? created.task : undefined;

    // 2. Parent step 1 — the agent turn splits via the REAL task_create tool.
    const createTool = createTaskTool({
      config: config(),
      sessionKey: PARENT_SESSION,
      agentId: "main",
    })!;
    const parentRunner = makeRunner("main");
    const parentTick1 = parentRunner.tick("main", USER);
    await waitForEnqueued(
      enqueued,
      (text, sessionKey) =>
        sessionKey === PARENT_SESSION &&
        text.includes("[Task Step 1/") &&
        text.includes("分别调研 A 与起草 B"),
    );

    const splitA = await createTool.execute("split-a", {
      goal: "调研 A 侧事实",
      assignToAgent: "researcher",
      parentTaskId: parent!.id,
    });
    expect(JSON.parse((splitA.content[0] as { text: string }).text).status).toBe("created");
    const splitB = await createTool.execute("split-b", {
      goal: "起草 B 侧草稿",
      assignToAgent: "writer",
      parentTaskId: parent!.id,
    });
    const childBId = JSON.parse((splitB.content[0] as { text: string }).text).taskId as string;
    const childAId = JSON.parse((splitA.content[0] as { text: string }).text).taskId as string;

    const reportTool = createTaskStepReportTool();
    await reportTool.execute("parent-step-1", {
      taskId: parent!.id,
      stepIndex: 1,
      summary: "已拆分为两个子任务，等待两路结果",
    });
    expect(await parentTick1).toBe(1);

    const parked = await store.get("main", USER, parent!.id);
    expect(parked?.status).toBe("blocked");
    expect(parked?.budget.usedSteps).toBe(1);

    // 3. Both assigned agents execute their subtasks unattended.
    const researcherTick = makeRunner("researcher").tick("researcher", USER);
    await waitForEnqueued(
      enqueued,
      (text, sessionKey) =>
        sessionKey === `agent:researcher:${USER}` &&
        text.includes("[Task Step 1/") &&
        text.includes("调研 A 侧事实"),
    );
    await reportTool.execute("researcher-step-1", {
      taskId: childAId,
      stepIndex: 1,
      summary: "A 侧结论：事实甲成立",
      done: true,
    });
    expect(await researcherTick).toBe(1);

    // One child done → parent still blocked.
    expect((await store.get("main", USER, parent!.id))?.status).toBe("blocked");

    const writerTick = makeRunner("writer").tick("writer", USER);
    await waitForEnqueued(
      enqueued,
      (text, sessionKey) =>
        sessionKey === `agent:writer:${USER}` &&
        text.includes("[Task Step 1/") &&
        text.includes("起草 B 侧草稿"),
    );
    await reportTool.execute("writer-step-1", {
      taskId: childBId,
      stepIndex: 1,
      summary: "B 侧草稿：建议乙",
      done: true,
    });
    expect(await writerTick).toBe(1);

    // 4. All children terminal → parent released with both results (results
    // must be fully visible, not just agent ids — the merge prompt below is
    // built from this record).
    await vi.waitFor(
      async () => {
        const r = await store.get("main", USER, parent!.id);
        expect(r?.status).toBe("queued");
        const results = r?.subtaskResults ?? [];
        expect(results.map((s) => s.agentId).toSorted()).toEqual(["researcher", "writer"]);
        for (const s of results) {
          expect(s.result?.length ?? 0).toBeGreaterThan(0);
        }
      },
      { timeout: 10_000 },
    );

    // 5. Parent resumes, merges, delivers.
    const parentTick2 = parentRunner.tick("main", USER);
    const mergePrompt = await waitForEnqueued(
      enqueued,
      (text, sessionKey) =>
        sessionKey === PARENT_SESSION &&
        text.includes("[Task Step 2/") &&
        text.includes("合并成一份简报"),
    );
    expect(mergePrompt.text).toContain("事实甲成立");
    expect(mergePrompt.text).toContain("建议乙");
    expect(mergePrompt.text).toContain("/ws/main/");

    await reportTool.execute("parent-step-2", {
      taskId: parent!.id,
      stepIndex: 2,
      summary: "合并简报：A 侧事实甲成立；B 侧建议乙。任务完成。",
      done: true,
    });
    expect(await parentTick2).toBe(1);

    // 6. Trajectories + merged result.
    const finalParent = await store.get("main", USER, parent!.id);
    expect(finalParent?.status).toBe("done");
    expect(finalParent?.steps).toHaveLength(2);
    expect(finalParent?.result).toContain("事实甲成立");
    expect(finalParent?.result).toContain("建议乙");

    const childAFinal = await store.get("researcher", USER, childAId);
    const childBFinal = await store.get("writer", USER, childBId);
    expect(childAFinal?.status).toBe("done");
    expect(childBFinal?.status).toBe("done");
    expect(childAFinal?.result).toContain("事实甲成立");
    expect(childBFinal?.result).toContain("建议乙");

    // Deliveries: two child results + one merged parent result.
    const parentDelivery = deliveries.find((d) => d.includes("合并简报"));
    expect(parentDelivery).toContain("任务完成");
    expect(deliveries.filter((d) => d.includes("任务完成"))).toHaveLength(3);
  });
});
