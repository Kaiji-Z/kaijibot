import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskRunner } from "./runner.js";
import { TaskStore } from "./store.js";

/**
 * M3-R1 — task hierarchy storage + blocked semantics.
 *
 * Delegated subtasks live in the assigned agent's namespace and carry
 * parent linkage; cross-agent queries resolve them for aggregation. A
 * `blocked` parent is never claimed by the runner (it waits for children).
 */

describe("task hierarchy storage (M3-R1)", () => {
  let storeDir: string;
  let store: TaskStore;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), "kaijibot-task-hierarchy-"));
    store = new TaskStore(storeDir);
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  it("persists parent linkage on subtasks", async () => {
    const parent = await store.create("main", "ou_alice", { goal: "父任务" });
    const child = await store.create("researcher", "ou_alice", {
      goal: "子任务",
      parentTaskId: parent.id,
      parentAgentId: "main",
    });
    expect(child.parentTaskId).toBe(parent.id);
    expect(child.parentAgentId).toBe("main");
    expect(child.agentId).toBe("researcher");

    // Linkage omitted for plain tasks.
    const plain = await store.create("main", "ou_alice", { goal: "普通任务" });
    expect(plain.parentTaskId).toBeUndefined();
    expect(plain.parentAgentId).toBeUndefined();
  });

  it("listSubtasks finds children across agent namespaces", async () => {
    const parent = await store.create("main", "ou_alice", { goal: "父任务" });
    await store.create("researcher", "ou_alice", {
      goal: "子任务A",
      parentTaskId: parent.id,
      parentAgentId: "main",
    });
    await store.create("writer", "ou_alice", {
      goal: "子任务B",
      parentTaskId: parent.id,
      parentAgentId: "main",
    });
    await store.create("writer", "ou_alice", { goal: "无关任务" });

    const subtasks = await store.listSubtasks("ou_alice", parent.id);
    expect(subtasks.map((s) => s.task.goal)).toEqual(["子任务A", "子任务B"]);
    expect(subtasks.map((s) => s.agentId).toSorted()).toEqual(["researcher", "writer"]);

    // Other users' tasks are not mixed in.
    await store.create("researcher", "ou_bob", {
      goal: "别人的子任务",
      parentTaskId: parent.id,
      parentAgentId: "main",
    });
    expect(await store.listSubtasks("ou_alice", parent.id)).toHaveLength(2);
  });

  it("findTaskAcrossAgents resolves a task without knowing the agent", async () => {
    const child = await store.create("researcher", "ou_alice", { goal: "子任务" });
    const found = await store.findTaskAcrossAgents("ou_alice", child.id);
    expect(found?.agentId).toBe("researcher");
    expect(found?.task.id).toBe(child.id);

    expect(await store.findTaskAcrossAgents("ou_alice", "task-missing")).toBeUndefined();
    expect(await store.findTaskAcrossAgents("ou_bob", child.id)).toBeUndefined();
  });

  it("runner never claims a blocked task (waits for children)", async () => {
    const parent = await store.create("main", "ou_alice", { goal: "等待中的父任务" });
    await store.update("main", "ou_alice", parent.id, (t) => ({ ...t, status: "blocked" }));
    // A queued task IS claimable — blocked is not.
    const other = await store.create("main", "ou_alice", { goal: "可运行任务" });

    const claimed: string[] = [];
    const runner = new TaskRunner({
      store,
      runStep: async (task) => {
        claimed.push(task.goal);
        return { summary: "ok", done: true };
      },
      deliver: async () => {},
    });
    const progressed = await runner.tick("main", "ou_alice");
    expect(progressed).toBe(1);
    expect(claimed).toEqual(["可运行任务"]);

    const stillBlocked = await store.get("main", "ou_alice", parent.id);
    expect(stillBlocked?.status).toBe("blocked");
    expect(await runner.tick("main", "ou_alice")).toBe(0);
    const finishedOther = await store.get("main", "ou_alice", other.id);
    expect(finishedOther?.status).toBe("done");
  });
});
