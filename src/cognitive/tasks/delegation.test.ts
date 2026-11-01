import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import { TaskRunner } from "./runner.js";
import { createTaskSafely } from "./service.js";
import { TaskStore } from "./store.js";

/**
 * M3-R2 — delegation semantics.
 *
 * `assignToAgent` creates the task in the target agent's namespace (its
 * runner drives it there); `parentTaskId` flips the parent to `blocked`, and
 * the runner PAUSES a task that became blocked mid-step (subtasks spawned).
 */

function config(extraAgents: string[] = []): KaijiBotConfig {
  return {
    cognitive: { enabled: true, tasks: { enabled: true } },
    ...(extraAgents.length > 0 ? { agents: { list: extraAgents.map((id) => ({ id })) } } : {}),
  } as unknown as KaijiBotConfig;
}

describe("task delegation (M3-R2)", () => {
  let storeDir: string;
  let store: TaskStore;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), "kaijibot-task-delegation-"));
    store = new TaskStore(storeDir);
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  it("assignToAgent creates the task under the target agent", async () => {
    const created = await createTaskSafely(
      { store, config: config(["main", "researcher"]), loadPersona: async () => undefined },
      "main",
      "ou_alice",
      { goal: "调研课题", assignToAgent: "researcher" },
    );
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.task.agentId).toBe("researcher");
      const stored = await store.get("researcher", "ou_alice", created.task.id);
      expect(stored?.goal).toBe("调研课题");
      expect(await store.list("main", "ou_alice")).toHaveLength(0);
    }
  });

  it("rejects assignment to an unknown agent", async () => {
    const created = await createTaskSafely(
      { store, config: config(["main"]), loadPersona: async () => undefined },
      "main",
      "ou_alice",
      { goal: "指派给不存在的 agent", assignToAgent: "ghost" },
    );
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.code).toBe("unknown_agent");
      expect(created.reason).toContain("ghost");
    }
    expect(await store.listAgentIds()).toHaveLength(0);
  });

  it("creating a subtask parks a running parent as blocked", async () => {
    const parentCreated = await createTaskSafely(
      { store, config: config(["main", "researcher"]), loadPersona: async () => undefined },
      "main",
      "ou_alice",
      { goal: "父任务" },
    );
    expect(parentCreated.ok).toBe(true);
    const parent = parentCreated.ok ? parentCreated.task : undefined;
    await store.update("main", "ou_alice", parent!.id, (t) => ({ ...t, status: "running" }));

    const childCreated = await createTaskSafely(
      { store, config: config(["main", "researcher"]), loadPersona: async () => undefined },
      "main",
      "ou_alice",
      { goal: "子任务", assignToAgent: "researcher", parentTaskId: parent!.id },
    );
    expect(childCreated.ok).toBe(true);
    if (childCreated.ok) {
      expect(childCreated.task.parentTaskId).toBe(parent!.id);
      expect(childCreated.task.parentAgentId).toBe("main");
    }

    const parked = await store.get("main", "ou_alice", parent!.id);
    expect(parked?.status).toBe("blocked");

    // Terminal parents are not resurrected into blocked.
    await store.update("main", "ou_alice", parent!.id, (t) => ({ ...t, status: "done" }));
    const again = await createTaskSafely(
      { store, config: config(["main", "researcher"]), loadPersona: async () => undefined },
      "main",
      "ou_alice",
      { goal: "迟到子任务", assignToAgent: "researcher", parentTaskId: parent!.id },
    );
    expect(again.ok).toBe(true);
    const stillDone = await store.get("main", "ou_alice", parent!.id);
    expect(stillDone?.status).toBe("done");
  });

  it("runner pauses (no delivery) when a step spawns subtasks", async () => {
    const deliveries: string[] = [];
    const created = await createTaskSafely(
      { store, config: config(["main", "researcher"]), loadPersona: async () => undefined },
      "main",
      "ou_alice",
      { goal: "会拆分的父任务", maxSteps: 5 },
    );
    expect(created.ok).toBe(true);
    const parent = created.ok ? created.task : undefined;

    const runner = new TaskRunner({
      store,
      runStep: async () => {
        // The agent turn splits the task: creating a linked subtask parks the
        // parent (this is exactly what the task_create tool does in prod).
        await store.create("researcher", "ou_alice", {
          goal: "子任务",
          parentTaskId: parent!.id,
          parentAgentId: "main",
        });
        await store.update("main", "ou_alice", parent!.id, (t) => ({
          ...t,
          status: "blocked",
        }));
        return { summary: "已拆出子任务，等待完成" };
      },
      deliver: async (_task, message) => {
        deliveries.push(message);
      },
    });

    expect(await runner.tick("main", "ou_alice")).toBe(1);
    const paused = await store.get("main", "ou_alice", parent!.id);
    expect(paused?.status).toBe("blocked");
    expect(paused?.budget.usedSteps).toBe(1);
    expect(paused?.steps[0]?.summary).toBe("已拆出子任务，等待完成");
    expect(deliveries).toHaveLength(0);
    // Paused parent is not re-claimed.
    expect(await runner.tick("main", "ou_alice")).toBe(0);
  });
});
