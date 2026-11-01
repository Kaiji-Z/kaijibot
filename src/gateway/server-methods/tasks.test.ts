import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cognitiveTaskHandlers } from "./cognitive.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

/**
 * T11 — tasks.list / tasks.get RPC contract tests.
 *
 * tasks.list returns the ACTIVE task snapshot (queued/running/blocked) with
 * budget fields, newest-first, filterable by agent/user, and includes
 * terminal tasks only on request; tasks.get returns the FULL record
 * (complete steps trail, result, subtask results) across agent namespaces.
 */

const mocks = vi.hoisted(() => ({
  resolveConfigDir: vi.fn(() => ""),
}));

vi.mock("../../utils.js", () => ({
  resolveConfigDir: mocks.resolveConfigDir,
}));

type Captured = { ok: boolean; result?: unknown; error?: { message?: string } };

function makeOpts(params: Record<string, unknown>): {
  opts: GatewayRequestHandlerOptions;
  responses: Captured[];
} {
  const responses: Captured[] = [];
  const opts = {
    params,
    respond: (ok: boolean, result?: unknown, error?: Captured["error"]) => {
      responses.push({ ok, result, error });
    },
    req: { id: "t", method: "test" },
    client: null,
    isWebchatConnect: () => false,
    context: {},
  } as unknown as GatewayRequestHandlerOptions;
  return { opts, responses };
}

describe("tasks.list / tasks.get RPC contract (T11)", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = mkdtempSync(join(tmpdir(), "kaijibot-tasks-rpc-"));
    mocks.resolveConfigDir.mockReturnValue(storeDir);
    const { TaskStore } = await import("../../cognitive/tasks/store.js");
    const store = new TaskStore(storeDir);

    // Fixtures: one active per agent + one finished + one blocked parent.
    await store.create("main", "ou_rpc", { goal: "活跃任务-main" });
    await store.create("researcher", "ou_rpc", { goal: "子任务-researcher" });
    const finished = await store.create("main", "ou_rpc", { goal: "已完结任务" });
    await store.update("main", "ou_rpc", finished.id, (t) => ({
      ...t,
      status: "done",
      result: "完结",
      steps: [
        ...t.steps,
        {
          index: 1,
          startedAt: 1,
          endedAt: 2,
          summary: "第一步",
          status: "ok",
        },
      ],
      budget: { ...t.budget, usedSteps: 1 },
    }));
    const blocked = await store.create("main", "ou_rpc", { goal: "停靠中的父任务" });
    await store.update("main", "ou_rpc", blocked.id, (t) => ({ ...t, status: "blocked" }));
    await store.create("main", "ou_other", { goal: "别人的任务" });
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("tasks.list returns the active snapshot, newest-first, with budget fields", async () => {
    const { opts, responses } = makeOpts({});
    await cognitiveTaskHandlers["tasks.list"]!(opts);
    expect(responses).toHaveLength(1);
    expect(responses[0]!.ok).toBe(true);
    const tasks = (responses[0]!.result as { tasks: Array<Record<string, unknown>> }).tasks;
    // Active only: main活跃 + researcher子 + blocked父 + ou_other的任务 (4); 完结 excluded.
    expect(tasks).toHaveLength(4);
    expect(tasks.map((t) => t.goal)).not.toContain("已完结任务");
    const blockedSnap = tasks.find((t) => t.goal === "停靠中的父任务");
    expect(blockedSnap).toMatchObject({
      status: "blocked",
      agentId: "main",
      userId: "ou_rpc",
      usedSteps: 0,
      maxSteps: 12,
      stepCount: 0,
    });
    // Newest-first ordering.
    const updated = tasks.map((t) => t.updatedAt as number);
    expect([...updated].toSorted((a, b) => b - a)).toEqual(updated);
  });

  it("tasks.list filters by agent/user and can include finished tasks", async () => {
    const { opts, responses } = makeOpts({ userId: "ou_rpc", includeFinished: true });
    await cognitiveTaskHandlers["tasks.list"]!(opts);
    const tasks = (responses[0]!.result as { tasks: Array<Record<string, unknown>> }).tasks;
    expect(tasks).toHaveLength(4);
    expect(tasks.every((t) => t.userId === "ou_rpc")).toBe(true);

    const byAgent = makeOpts({ agentId: "researcher" });
    await cognitiveTaskHandlers["tasks.list"]!(byAgent.opts);
    const researcherTasks = (
      byAgent.responses[0]!.result as {
        tasks: Array<Record<string, unknown>>;
      }
    ).tasks;
    expect(researcherTasks.map((t) => t.goal)).toEqual(["子任务-researcher"]);
  });

  it("tasks.list rejects malformed params", async () => {
    const { opts, responses } = makeOpts({ includeFinished: "yes" });
    await cognitiveTaskHandlers["tasks.list"]!(opts);
    expect(responses[0]!.ok).toBe(false);
    expect(String(responses[0]!.error?.message)).toContain("invalid tasks.list params");
  });

  it("tasks.get returns the full record with the complete steps trail", async () => {
    const { TaskStore } = await import("../../cognitive/tasks/store.js");
    const store = new TaskStore(storeDir);
    const finished = (await store.list("main", "ou_rpc")).find((t) => t.goal === "已完结任务");

    const { opts, responses } = makeOpts({ taskId: finished!.id, userId: "ou_rpc" });
    await cognitiveTaskHandlers["tasks.get"]!(opts);
    expect(responses[0]!.ok).toBe(true);
    const task = (responses[0]!.result as { task: Record<string, unknown> }).task;
    expect(task.status).toBe("done");
    expect(task.result).toBe("完结");
    expect(task.steps).toHaveLength(1);
    expect((task.steps as Array<Record<string, unknown>>)[0]).toMatchObject({
      index: 1,
      summary: "第一步",
      status: "ok",
    });
    expect(task.budget).toMatchObject({ usedSteps: 1, maxSteps: 12 });
  });

  it("tasks.get resolves tasks across agent namespaces and 404s unknown ids", async () => {
    const { TaskStore } = await import("../../cognitive/tasks/store.js");
    const store = new TaskStore(storeDir);
    const child = (await store.list("researcher", "ou_rpc")).find(
      (t) => t.goal === "子任务-researcher",
    );

    const { opts, responses } = makeOpts({ taskId: child!.id, userId: "ou_rpc" });
    await cognitiveTaskHandlers["tasks.get"]!(opts);
    expect(responses[0]!.ok).toBe(true);
    expect((responses[0]!.result as { task: { agentId: string } }).task.agentId).toBe("researcher");

    const missing = makeOpts({ taskId: "task-missing", userId: "ou_rpc" });
    await cognitiveTaskHandlers["tasks.get"]!(missing.opts);
    expect(missing.responses[0]!.ok).toBe(false);
    expect(String(missing.responses[0]!.error?.message)).toContain("not found");
  });
});
