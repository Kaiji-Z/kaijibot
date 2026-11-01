import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskStore } from "./store.js";
import { isTerminalTaskStatus, MAX_TASKS_PER_USER, type TaskRecord } from "./types.js";

const AGENT = "main";
const USER = "test-user";

describe("TaskStore", () => {
  let tempDir: string;
  let store: TaskStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kaijibot-tasks-test-"));
    store = new TaskStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("create + get round-trips a queued task", async () => {
    const created = await store.create(AGENT, USER, { goal: "调研本地 Grok Bot 对标并写摘要" });
    expect(created.status).toBe("queued");
    expect(created.budget.usedSteps).toBe(0);
    expect(created.goal).toContain("Grok Bot");

    const loaded = await store.get(AGENT, USER, created.id);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(created.id);
    expect(loaded!.goal).toBe(created.goal);
  });

  it("list returns tasks in creation order", async () => {
    const a = await store.create(AGENT, USER, { goal: "task-a" });
    const b = await store.create(AGENT, USER, { goal: "task-b" });
    const tasks = await store.list(AGENT, USER);
    expect(tasks.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("rejects an empty goal", async () => {
    await expect(store.create(AGENT, USER, { goal: "   " })).rejects.toThrow(/empty/i);
  });

  it("update persists step appends and bumps updatedAt", async () => {
    const created = await store.create(AGENT, USER, { goal: "multi-step" });
    const before = created.updatedAt;

    const updated = await store.update(AGENT, USER, created.id, (task) => ({
      ...task,
      status: "running",
      budget: { ...task.budget, usedSteps: 1 },
      steps: [
        {
          index: 1,
          startedAt: Date.now(),
          endedAt: Date.now(),
          summary: "step one done",
          status: "ok",
        },
      ],
    }));

    expect(updated?.status).toBe("running");
    expect(updated?.steps).toHaveLength(1);
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(before);

    const reloaded = await store.get(AGENT, USER, created.id);
    expect(reloaded?.status).toBe("running");
    expect(reloaded?.budget.usedSteps).toBe(1);
  });

  it("update returns undefined for unknown task id", async () => {
    const result = await store.update(AGENT, USER, "task-nonexistent", (t) => t);
    expect(result).toBeUndefined();
  });

  it("isolates tasks per user and per agent", async () => {
    await store.create(AGENT, USER, { goal: "mine" });
    await store.create(AGENT, "other-user", { goal: "theirs" });
    await store.create("other-agent", USER, { goal: "other agent" });

    expect(await store.list(AGENT, USER)).toHaveLength(1);
    expect(await store.list(AGENT, "other-user")).toHaveLength(1);
    expect(await store.list("other-agent", USER)).toHaveLength(1);
  });

  it("concurrent create on separate store instances loses no tasks", async () => {
    // Regression guard: this store is instantiated per writer (agent entry,
    // CLI, runner); per-instance locks must not let writes interleave.
    const storeA = new TaskStore(tempDir);
    const storeB = new TaskStore(tempDir);

    await Promise.all([
      ...[0, 1, 2].map((i) => storeA.create(AGENT, USER, { goal: `a-${i}` })),
      ...[3, 4, 5].map((i) => storeB.create(AGENT, USER, { goal: `b-${i}` })),
    ]);

    const tasks = await store.list(AGENT, USER);
    expect(tasks).toHaveLength(6);
  });

  it("evicts oldest terminal tasks above the per-user cap", async () => {
    const capped = new TaskStore(tempDir);
    // Fill with terminal tasks slightly above cap, then one live task.
    for (let i = 0; i < MAX_TASKS_PER_USER + 5; i++) {
      const created = await capped.create(AGENT, USER, { goal: `t-${i}` });
      if (i < MAX_TASKS_PER_USER + 5 - 1) {
        await capped.update(AGENT, USER, created.id, (task) => ({
          ...task,
          status: "done",
          result: "ok",
        }));
      }
    }
    const tasks = await capped.list(AGENT, USER);
    expect(tasks).toHaveLength(MAX_TASKS_PER_USER);
    // The live (queued) task survives; the five oldest terminal tasks (t-0..t-4) are evicted.
    expect(tasks.some((t: TaskRecord) => t.status === "queued")).toBe(true);
    for (const evicted of ["t-0", "t-1", "t-2", "t-3", "t-4"]) {
      expect(tasks.some((t: TaskRecord) => t.goal === evicted)).toBe(false);
    }
    expect(isTerminalTaskStatus("done")).toBe(true);
  });
});
