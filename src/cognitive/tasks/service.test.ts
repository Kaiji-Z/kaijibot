import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import { createTaskSafely, tasksEnabled, type TaskServiceDeps } from "./service.js";
import { TaskStore } from "./store.js";

const AGENT = "main";
const USER = "test-user";

function cfg(tasks?: { enabled?: boolean; maxSteps?: number }): KaijiBotConfig {
  return { cognitive: { enabled: true, tasks } } as unknown as KaijiBotConfig;
}

function personaWithLedger(consecutiveNoResponses: number): PersonaTree {
  return {
    feedbackProfile: {
      topicBandits: {},
      optimalFrequencyHours: 48,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [],
      consecutiveNoResponses,
    },
    rapport: {
      trustScore: 0.9,
      totalExchanges: 50,
      avgResponseLength: 100,
      selfDisclosureLevel: 0.5,
    },
    lifecycle: { stage: "active", lastActiveAt: 0, lastStageTransitionAt: 0, totalActiveDays: 30 },
    domains: {},
  } as unknown as PersonaTree;
}

describe("createTaskSafely", () => {
  let tempDir: string;
  let store: TaskStore;
  let kicked: string[];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kaijibot-task-service-"));
    store = new TaskStore(tempDir);
    kicked = [];
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function deps(
    overrides?: Partial<{
      config: KaijiBotConfig;
      persona: PersonaTree | undefined;
    }>,
  ): TaskServiceDeps {
    return {
      store,
      config: overrides?.config ?? cfg({ enabled: true }),
      loadPersona: async () => overrides?.persona,
      onTaskCreated: async (task) => {
        kicked.push(task.id);
      },
    };
  }

  it("rejects creation when the tasks flag is off (default)", async () => {
    expect(tasksEnabled(undefined)).toBe(false);
    expect(tasksEnabled(cfg(undefined))).toBe(false);
    expect(tasksEnabled(cfg({}))).toBe(false);

    const result = await createTaskSafely(deps({ config: cfg({}) }), AGENT, USER, {
      goal: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("disabled");
    }
  });

  it("rejects creation when cognitive master switch is off even if tasks.enabled is true", async () => {
    const master = {
      cognitive: { enabled: false, tasks: { enabled: true } },
    } as unknown as KaijiBotConfig;
    expect(tasksEnabled(master)).toBe(false);
  });

  it("creates, kicks, and applies config maxSteps when healthy", async () => {
    const result = await createTaskSafely(
      deps({ config: cfg({ enabled: true, maxSteps: 5 }), persona: personaWithLedger(0) }),
      AGENT,
      USER,
      { goal: "整理周报" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.status).toBe("queued");
      expect(result.task.budget.maxSteps).toBe(5);
      expect(kicked).toEqual([result.task.id]);
    }
  });

  it("vetoes creation at ledger U >= 3 with a pacing reason (T3)", async () => {
    const result = await createTaskSafely(deps({ persona: personaWithLedger(3) }), AGENT, USER, {
      goal: "不该创建",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("pacing_vetoed");
      expect(result.reason).toContain("cap 3");
    }
    expect(kicked).toHaveLength(0);
    expect(await store.list(AGENT, USER)).toHaveLength(0);
  });

  it("allows creation when no persona exists yet (fresh relationship)", async () => {
    const result = await createTaskSafely(deps({ persona: undefined }), AGENT, USER, {
      goal: "首次任务",
    });
    expect(result.ok).toBe(true);
  });
});
