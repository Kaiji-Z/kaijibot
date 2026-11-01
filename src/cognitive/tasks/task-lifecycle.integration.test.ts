import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskStepReportTool } from "../../agents/tools/task-tool.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { createTempHomeEnv } from "../../test-utils/temp-home.js";
import { TaskRunner } from "./runner.js";
import { createTaskSafely } from "./service.js";
import { createProductionStepDriver } from "./step-driver.js";
import { TaskStore } from "./store.js";

/**
 * T1 — task lifecycle e2e (stub LLM).
 *
 * Full assembly: service (flag + pacing gate) → TaskRunner bounded loop →
 * PRODUCTION step driver (prompt build, awaiter registry, system-event +
 * heartbeat wake) → the real task_step_report tool standing in for the
 * agent's turn end → checkpointed store lifecycle → result delivery via the
 * insight-delivery idiom (enqueue + heartbeat, recorded here).
 *
 * Named as an integration test rather than the e2e name used elsewhere in
 * the repo, because vitest projects exclude e2e-named files globally; the
 * criterion is command-based (the tasks suite must pass with this file).
 */

const AGENT = "main";
const USER = "ou_alice";
const SESSION_KEY = `agent:${AGENT}:${USER}`;

describe("task lifecycle e2e (T1)", () => {
  let tempHome: Awaited<ReturnType<typeof createTempHomeEnv>>;
  let storeDir: string;
  let store: TaskStore;
  let enqueued: Array<{ text: string; contextKey?: string; sessionKey: string }>;
  let heartbeats: Array<{ reason: string; sessionKey: string }>;

  beforeAll(async () => {
    tempHome = await createTempHomeEnv("kaijibot-task-e2e-");
  });

  afterAll(async () => {
    await tempHome.restore();
  });

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), "kaijibot-task-e2e-store-"));
    store = new TaskStore(storeDir);
    enqueued = [];
    heartbeats = [];
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeProductionRunner(): TaskRunner {
    const stepDriver = createProductionStepDriver({
      sessionKey: SESSION_KEY,
      enqueueSystemEvent: (text, options) => {
        enqueued.push({
          text,
          contextKey: options.contextKey,
          sessionKey: options.sessionKey,
        });
        return true;
      },
      requestHeartbeatNow: (opts) => {
        heartbeats.push({ reason: opts.reason, sessionKey: opts.sessionKey });
      },
    });
    return new TaskRunner({
      store,
      runStep: stepDriver,
      deliver: async (task, message) => {
        enqueued.push({
          text: `[Task Result] ${message}`,
          contextKey: `task-result:${task.id}`,
          sessionKey: SESSION_KEY,
        });
        heartbeats.push({ reason: "cognitive-task", sessionKey: SESSION_KEY });
      },
    });
  }

  function config(tasksEnabledFlag: boolean): KaijiBotConfig {
    return {
      cognitive: { enabled: true, tasks: { enabled: tasksEnabledFlag } },
    } as unknown as KaijiBotConfig;
  }

  it("flag off → creation rejected, nothing runs", async () => {
    const runner = makeProductionRunner();
    const created = await createTaskSafely(
      { store, config: config(false), loadPersona: async () => undefined },
      AGENT,
      USER,
      { goal: "不该跑" },
    );
    expect(created.ok).toBe(false);

    const progressed = await runner.tick(AGENT, USER);
    expect(progressed).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it("creates via service, executes 3 steps unattended, delivers result, records lifecycle", async () => {
    // 1. Creation through the service with a healthy persona (gate passes).
    const created = await createTaskSafely(
      { store, config: config(true), loadPersona: async () => undefined },
      AGENT,
      USER,
      { goal: "调研本地 Grok Bot 对标并写一页摘要", maxSteps: 5 },
    );
    expect(created.ok).toBe(true);
    const task = created.ok ? created.task : undefined;
    expect(task?.status).toBe("queued");

    // 2. Start the unattended run (runner drives steps via the production
    //    step driver; each step ends when the agent's task_step_report
    //    arrives — simulated below by calling the REAL tool).
    const runner = makeProductionRunner();
    const tickPromise = runner.tick(AGENT, USER);
    const reportTool = createTaskStepReportTool();

    const summaries = ["收集了资料", "整理了要点", "摘要已完成"];
    for (let step = 1; step <= 3; step++) {
      // Wait until the step's wake has been requested (the agent turn start).
      await vi.waitFor(() => {
        expect(
          heartbeats.filter((h) => h.reason === "cognitive-task").length,
        ).toBeGreaterThanOrEqual(step);
      });
      const result = await reportTool.execute(`report-${step}`, {
        taskId: task!.id,
        stepIndex: step,
        summary: summaries[step - 1]!,
        ...(step === 3 ? { done: true } : {}),
      });
      expect(JSON.parse((result.content[0] as { text: string }).text).status).toBe("recorded");
    }
    expect(await tickPromise).toBe(1);

    // 3. Lifecycle recorded end-to-end.
    const final = await store.get(AGENT, USER, task!.id);
    expect(final?.status).toBe("done");
    expect(final?.budget.usedSteps).toBe(3);
    expect(final?.steps.map((s) => s.summary)).toEqual(summaries);
    expect(final?.result).toBe("摘要已完成");
    expect(final?.origin).toBe("user");

    // 4. Step prompts enqueued on the user session with wake heartbeats;
    //    exactly one terminal delivery with the final result.
    const stepPrompts = enqueued.filter((e) => e.text.includes("[Task Step"));
    expect(stepPrompts).toHaveLength(3);
    expect(stepPrompts[0]!.text).toContain("调研本地 Grok Bot 对标并写一页摘要");
    expect(stepPrompts[0]!.text).toContain("（这是第一步）");
    expect(stepPrompts[0]!.text).not.toContain("已完成步骤");
    expect(stepPrompts[1]!.text).toContain("已完成步骤");
    expect(stepPrompts[1]!.text).toContain("收集了资料");
    const deliveries = enqueued.filter((e) => e.text.includes("[Task Result]"));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.text).toContain("任务完成");
    expect(deliveries[0]!.text).toContain("摘要已完成");

    // 5. Nothing left runnable.
    expect(await runner.tick(AGENT, USER)).toBe(0);
  });

  it("pacing gate (U>=3) vetoes creation before any step runs (T3 in-chain)", async () => {
    const created = await createTaskSafely(
      {
        store,
        config: config(true),
        loadPersona: async () =>
          ({
            feedbackProfile: {
              topicBandits: {},
              optimalFrequencyHours: 48,
              lastProactiveAt: 0,
              recentInsightIds: [],
              recentInsightContents: [],
              consecutiveNoResponses: 3,
            },
            rapport: {
              trustScore: 0.9,
              totalExchanges: 50,
              avgResponseLength: 100,
              selfDisclosureLevel: 0.5,
            },
            lifecycle: {
              stage: "active",
              lastActiveAt: 0,
              lastStageTransitionAt: 0,
              totalActiveDays: 30,
            },
          }) as never,
      },
      AGENT,
      USER,
      { goal: "被门控的任务" },
    );
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.code).toBe("pacing_vetoed");
    }
    expect(await store.list(AGENT, USER)).toHaveLength(0);
  });
});
