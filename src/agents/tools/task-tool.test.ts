import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskStore } from "../../cognitive/tasks/store.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { createTempHomeEnv } from "../../test-utils/temp-home.js";
import { createTaskStatusTool, createTaskTool } from "./task-tool.js";

function cfg(tasks?: { enabled?: boolean }): KaijiBotConfig {
  return { cognitive: { enabled: true, tasks } } as unknown as KaijiBotConfig;
}

function parsePayload(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  const text = content.find((b) => typeof b?.text === "string")?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

describe("task tools", () => {
  let tempHome: Awaited<ReturnType<typeof createTempHomeEnv>>;

  beforeAll(async () => {
    tempHome = await createTempHomeEnv("kaijibot-task-tool-");
  });

  afterAll(async () => {
    await tempHome.restore();
  });

  const sessionDeps = {
    sessionKey: "agent:main:ou_alice",
    agentId: "main",
  };

  it("task_create rejects when the flag is off", async () => {
    const tool = createTaskTool({ config: cfg({}), ...sessionDeps })!;
    const result = await tool.execute("call-1", { goal: "x" });
    const payload = parsePayload(result);
    expect(payload.status).toBe("disabled");
  });

  it("task_create creates a queued task under the session user", async () => {
    const tool = createTaskTool({ config: cfg({ enabled: true }), ...sessionDeps })!;
    const result = await tool.execute("call-2", { goal: "调研并写周报" });
    const payload = parsePayload(result);
    expect(payload.status).toBe("created");
    expect(payload.maxSteps).toBe(12); // config default

    const { resolveConfigDir } = await import("../../utils.js");
    const store = new TaskStore(resolveConfigDir());
    const tasks = await store.list("main", "ou_alice");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("queued");
    expect(tasks[0]?.origin).toBe("user");
  });

  it("task_create respects an explicit maxSteps override", async () => {
    const tool = createTaskTool({ config: cfg({ enabled: true }), ...sessionDeps })!;
    const result = await tool.execute("call-3", { goal: "少步任务", maxSteps: 3 });
    expect(parsePayload(result).maxSteps).toBe(3);
  });

  it("task_create vetoes at ledger U >= 3 (persona present)", async () => {
    const { resolveConfigDir } = await import("../../utils.js");
    const { PersonaStore } = await import("../../cognitive/persona/store.js");
    const personaStore = new PersonaStore(resolveConfigDir());
    // Seed a persona with ledger debt for ou_bob.
    await personaStore.update("main", "ou_bob", (p) => {
      p.feedbackProfile.consecutiveNoResponses = 3;
      return p;
    });

    const tool = createTaskTool({
      config: cfg({ enabled: true }),
      sessionKey: "agent:main:ou_bob",
      agentId: "main",
    })!;
    const result = await tool.execute("call-4", { goal: "被否决的任务" });
    const payload = parsePayload(result);
    expect(payload.status).toBe("pacing_vetoed");
  });

  it("task_status lists active and finished tasks", async () => {
    const createTool = createTaskTool({ config: cfg({ enabled: true }), ...sessionDeps })!;
    await createTool.execute("call-5", { goal: "状态任务" });

    const statusTool = createTaskStatusTool({ config: cfg({ enabled: true }), ...sessionDeps })!;
    const result = await statusTool.execute("call-6", {});
    const payload = parsePayload(result);
    expect(payload.status).toBe("ok");
    expect((payload.active as string[]).some((s) => s.includes("状态任务"))).toBe(true);
  });

  it("task_status reports none when empty", async () => {
    const statusTool = createTaskStatusTool({
      config: cfg({ enabled: true }),
      sessionKey: "agent:main:ou_nobody",
      agentId: "main",
    })!;
    const payload = parsePayload(await statusTool.execute("call-7", {}));
    expect(payload.status).toBe("none");
  });

  it("task_status with taskId returns the full step trajectory (chat-side detail view)", async () => {
    const { resolveConfigDir } = await import("../../utils.js");
    const store = new TaskStore(resolveConfigDir());
    // Seed a finished two-step task for ou_alice.
    const created = await store.create("main", "ou_alice", { goal: "详情任务" });
    await store.update("main", "ou_alice", created.id, (t) => ({
      ...t,
      status: "done",
      result: "最终结果",
      steps: [
        { index: 1, startedAt: 1, endedAt: 2, summary: "第一步", status: "ok" },
        { index: 2, startedAt: 2, endedAt: 3, summary: "第二步", status: "ok" },
      ],
      budget: { ...t.budget, usedSteps: 2 },
    }));

    const statusTool = createTaskStatusTool({ config: cfg({ enabled: true }), ...sessionDeps })!;
    const payload = parsePayload(await statusTool.execute("call-8", { taskId: created.id }));
    expect(payload.status).toBe("ok");
    const task = payload.task as {
      goal: string;
      status: string;
      result?: string;
      steps: Array<{ summary: string }>;
    };
    expect(task.goal).toBe("详情任务");
    expect(task.status).toBe("done");
    expect(task.result).toBe("最终结果");
    expect(task.steps.map((s) => s.summary)).toEqual(["第一步", "第二步"]);
  });

  it("task_status with an unknown taskId reports not_found", async () => {
    const statusTool = createTaskStatusTool({ config: cfg({ enabled: true }), ...sessionDeps })!;
    const payload = parsePayload(await statusTool.execute("call-9", { taskId: "no-such-task" }));
    expect(payload.status).toBe("not_found");
  });
});
