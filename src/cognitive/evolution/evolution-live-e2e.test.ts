/**
 * Live evolution end-to-end test — verifies the full self-evolution pipeline
 * from hard-trigger signal through agent tool draft generation.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 pnpm test src/cognitive/evolution/evolution-live-e2e.test.ts
 *
 * What this tests:
 *   1. Hard-trigger: evaluateHardTrigger enqueues signal for 3+ user tools (real function, no helper)
 *   2. Agent tool: evaluate_skill_evolution always generates draft (no shouldSuggest gate)
 *   3. No-cooldown flow: multiple suggestions for same user all succeed
 *   4. Signal format: [Evolution Signal] contains concise summary + guidance (no tool sequence or error info)
 *   5. recentSuggestions context: prior records appear in subsequent evaluations
 *   6. Simple tasks also generate drafts (agent decides, not code)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvolutionCandidate } from "./types.js";
import { EvolutionEngine } from "./engine.js";
import { EvolutionStore } from "./store.js";
import { evaluateHardTrigger } from "./hard-trigger.js";
import { generateSkillDraftLLM } from "./llm-draft-generator.js";
import {
  peekSystemEventEntries,
  resetSystemEventsForTest,
} from "../../infra/system-events.js";
import { resetHeartbeatWakeStateForTests } from "../../infra/heartbeat-wake.js";

const { mockRequestHeartbeatNow } = vi.hoisted(() => ({
  mockRequestHeartbeatNow: vi.fn(),
}));

vi.mock("../../infra/heartbeat-wake.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    requestHeartbeatNow: mockRequestHeartbeatNow,
  };
});

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";

async function callLLM(prompt: string): Promise<string> {
  const res = await fetch(ZAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 3000,
    }),
  });
  const data = (await res.json()) as {
    error?: { message: string };
    choices?: Array<{ message: { content: string } }>;
  };
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content ?? "";
}

let tempDir: string;
let store: EvolutionStore;

function makeCandidate(overrides: Partial<EvolutionCandidate> = {}): EvolutionCandidate {
  return {
    taskSummary: "auto",
    toolCalls: [],
    uniqueToolCount: 0,
    reasoningTurns: 0,
    durationMs: 0,
    domain: "auto",
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kaijibot-evo-e2e-"));
  store = new EvolutionStore(tempDir);
  resetSystemEventsForTest();
  resetHeartbeatWakeStateForTests();
  mockRequestHeartbeatNow.mockClear();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  resetSystemEventsForTest();
  resetHeartbeatWakeStateForTests();
});

// ===========================================================================
// PHASE 1: Hard-trigger signal generation (no LLM needed)
// ===========================================================================
describe("Phase 1: hard-trigger signal generation via evaluateHardTrigger", () => {
  const testSessionKey = "agent:main:ou_test_user";

  it("enqueues concise signal for 3+ user-triggered tool calls", async () => {
    await evaluateHardTrigger({
      toolMetas: [
        { toolName: "web_search" }, { toolName: "read_file" }, { toolName: "web_search" },
        { toolName: "write_file" }, { toolName: "read_file" }, { toolName: "web_search" },
        { toolName: "write_file" }, { toolName: "read_file" }, { toolName: "web_search" },
        { toolName: "write_file" },
      ],
      sessionKey: testSessionKey,
      trigger: "user",
      started: Date.now() - 280_000,
    });

    const events = peekSystemEventEntries(testSessionKey);
    expect(events).toHaveLength(1);
    const signalText = events[0]!.text;
    expect(signalText).toContain("[Evolution Signal]");
    expect(signalText).toContain("10 次工具调用");
    expect(signalText).toContain("3 种");
    expect(signalText).toContain("280 秒");
    expect(signalText).toContain("evaluate_skill_evolution");
    expect(signalText).toContain("自主判断");
    expect(signalText).not.toContain("web_search, read_file");
    expect(signalText).not.toContain("工具错误");
    expect(signalText).not.toContain("工具序列");
  });

  it("signal omits tool sequence even when tool metas contain error info", async () => {
    await evaluateHardTrigger({
      toolMetas: [
        { toolName: "feishu_doc_fetch" },
        { toolName: "feishu_doc_fetch", meta: "Error: permission denied" },
        { toolName: "feishu_wiki_create" },
      ],
      sessionKey: testSessionKey,
      trigger: "manual",
      started: Date.now() - 15_000,
    });

    const events = peekSystemEventEntries(testSessionKey);
    expect(events).toHaveLength(1);
    const signalText = events[0]!.text;
    expect(signalText).not.toContain("feishu_doc_fetch");
    expect(signalText).not.toContain("permission denied");
    expect(signalText).not.toContain("⚠");
  });

  it("requests heartbeat with cognitive-evolution reason on original sessionKey", async () => {
    const customKey = "agent:main:user_abc123";
    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: customKey,
      trigger: "user",
      started: Date.now() - 5000,
    });

    expect(mockRequestHeartbeatNow).toHaveBeenCalledTimes(1);
    expect(mockRequestHeartbeatNow).toHaveBeenCalledWith({
      reason: "cognitive-evolution",
      sessionKey: customKey,
    });
    expect(peekSystemEventEntries(customKey)).toHaveLength(1);
  });

  it("skips for non-user triggers (cron, system, heartbeat)", async () => {
    for (const trigger of ["cron", "system", "heartbeat"]) {
      await evaluateHardTrigger({
        toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
        sessionKey: testSessionKey,
        trigger,
        started: Date.now() - 5000,
      });
    }

    expect(peekSystemEventEntries(testSessionKey)).toHaveLength(0);
    expect(mockRequestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("skips for fewer than 3 tool calls", async () => {
    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }],
      sessionKey: testSessionKey,
      trigger: "user",
      started: Date.now() - 5000,
    });

    expect(peekSystemEventEntries(testSessionKey)).toHaveLength(0);
    expect(mockRequestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("skips when no userId can be resolved from sessionKey", async () => {
    await evaluateHardTrigger({
      toolMetas: [{ toolName: "a" }, { toolName: "b" }, { toolName: "c" }],
      sessionKey: "agent:main:main",
      trigger: "user",
      started: Date.now() - 5000,
    });

    expect(peekSystemEventEntries("agent:main:main")).toHaveLength(0);
    expect(mockRequestHeartbeatNow).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// PHASE 2: No-cooldown flow + recentSuggestions (no LLM needed)
// ===========================================================================
describe("Phase 2: no-cooldown — multiple suggestions all pass", () => {
  it("allows 5 consecutive suggestions for same user", async () => {
    const engine = new EvolutionEngine(store);
    const candidate = makeCandidate({
      toolCalls: Array.from({ length: 15 }, (_, i) => `tool_${i}`),
      uniqueToolCount: 10,
      reasoningTurns: 12,
      durationMs: 400_000,
      domain: "test",
    });

    for (let i = 0; i < 5; i++) {
      const decision = await engine.evaluate(candidate, "user-no-cooldown");
      expect(decision.shouldSuggest).toBe(true);
      expect(decision.recentSuggestions).toHaveLength(i);

      await store.save({
        id: `rec-no-cooldown-${i}`,
        userId: "user-no-cooldown",
        candidate,
        decision,
        timestamp: Date.now(),
      });
    }
  });

  it("provides recentSuggestions with prior records", async () => {
    const engine = new EvolutionEngine(store);

    await store.save({
      id: "rec-1",
      userId: "user-ctx",
      candidate: makeCandidate({ domain: "feishu-wiki" }),
      decision: { shouldSuggest: true, confidence: 0.8, complexityScore: 0.7, reasoning: "ok" },
      draft: { name: "wiki-skill", description: "d", triggerPhrases: ["wiki"], bodyMarkdown: "# W" },
      timestamp: Date.now() - 7_200_000,
    });

    await store.save({
      id: "rec-2",
      userId: "user-ctx",
      candidate: makeCandidate({ domain: "data-analysis" }),
      decision: { shouldSuggest: true, confidence: 0.7, complexityScore: 0.6, reasoning: "ok" },
      draft: { name: "data-skill", description: "d", triggerPhrases: ["data"], bodyMarkdown: "# D" },
      timestamp: Date.now() - 1_800_000,
    });

    const candidate = makeCandidate({
      toolCalls: Array.from({ length: 15 }, (_, i) => `tool_${i}`),
      uniqueToolCount: 10,
      reasoningTurns: 12,
      durationMs: 400_000,
      domain: "test",
    });
    const decision = await engine.evaluate(candidate, "user-ctx");

    expect(decision.shouldSuggest).toBe(true);
    expect(decision.recentSuggestions).toHaveLength(2);
    expect(decision.recentSuggestions![0]!.domain).toBe("feishu-wiki");
    expect(decision.recentSuggestions![0]!.skillName).toBe("wiki-skill");
    expect(decision.recentSuggestions![0]!.hoursAgo).toBeGreaterThanOrEqual(2);
    expect(decision.recentSuggestions![1]!.domain).toBe("data-analysis");
  });

  it("recentSuggestions reflects userResponse", async () => {
    const engine = new EvolutionEngine(store);

    await store.save({
      id: "rec-accepted",
      userId: "user-resp",
      candidate: makeCandidate({ domain: "wiki" }),
      decision: { shouldSuggest: true, confidence: 0.8, complexityScore: 0.7, reasoning: "ok" },
      draft: { name: "w", description: "d", triggerPhrases: ["w"], bodyMarkdown: "# W" },
      userResponse: "accepted",
      timestamp: Date.now() - 1000,
    });

    await store.save({
      id: "rec-rejected",
      userId: "user-resp",
      candidate: makeCandidate({ domain: "data" }),
      decision: { shouldSuggest: true, confidence: 0.8, complexityScore: 0.7, reasoning: "ok" },
      draft: { name: "d", description: "d", triggerPhrases: ["d"], bodyMarkdown: "# D" },
      userResponse: "rejected",
      timestamp: Date.now() - 1000,
    });

    const candidate = makeCandidate({
      toolCalls: Array.from({ length: 15 }, (_, i) => `tool_${i}`),
      uniqueToolCount: 10,
      reasoningTurns: 12,
      durationMs: 400_000,
    });
    const decision = await engine.evaluate(candidate, "user-resp");

    expect(decision.recentSuggestions).toHaveLength(2);
    const accepted = decision.recentSuggestions!.find((r) => r.domain === "wiki");
    const rejected = decision.recentSuggestions!.find((r) => r.domain === "data");
    expect(accepted!.userResponse).toBe("accepted");
    expect(rejected!.userResponse).toBe("rejected");
  });
});

// ===========================================================================
// PHASE 3: Full pipeline with real LLM (requires API key)
//
// Tests the actual flow: candidate → engine.evaluate (for context) → engine.generate (LLM draft)
// No gating: the tool always generates a draft regardless of complexityScore.
// ===========================================================================
describe.skipIf(!isLive || !ZAI_API_KEY)("Phase 3: full pipeline with real LLM", () => {
  it("complex task → generate draft with real LLM", async () => {
    const engine = new EvolutionEngine(store, undefined, undefined, (c) =>
      generateSkillDraftLLM(c, { generateText: callLLM }),
    );

    const candidate = makeCandidate({
      taskSummary: "归档产品评审会议纪要到飞书知识库并创建跟踪任务",
      toolCalls: [
        "feishu_vc_search",
        "feishu_vc_notes",
        "feishu_doc_fetch",
        "feishu_wiki_spaces",
        "feishu_wiki_create",
        "feishu_doc_write",
        "feishu_task_create",
      ],
      uniqueToolCount: 6,
      reasoningTurns: 8,
      durationMs: 180_000,
      domain: "feishu-meeting",
    });

    // evaluate returns context (recentSuggestions, complexityScore) — NOT used for gating
    const decision = await engine.evaluate(candidate, "user-live-1");

    // generate always runs — no shouldSuggest gate
    const draft = await engine.generate(candidate);

    console.log(`\n  ═══ Live Draft ═══`);
    console.log(`  Name: ${draft.name}`);
    console.log(`  Description: ${draft.description}`);
    console.log(`  Triggers: ${draft.triggerPhrases.join(", ")}`);
    console.log(`  Body lines: ${draft.bodyMarkdown.split("\n").length}`);
    console.log(`  complexityScore: ${decision.complexityScore.toFixed(2)} (reference only)`);
    console.log(`  recentSuggestions: ${JSON.stringify(decision.recentSuggestions)}`);
    console.log(`  ═══════════════════\n`);

    expect(draft.name).toBeTruthy();
    expect(draft.description.length).toBeGreaterThan(5);
    expect(draft.triggerPhrases.length).toBeGreaterThanOrEqual(2);
    expect(draft.bodyMarkdown.length).toBeGreaterThan(100);
    expect(decision.recentSuggestions).toEqual([]);
  }, 120_000);

  it("second round shows recentSuggestions from first round", async () => {
    const engine = new EvolutionEngine(store, undefined, undefined, (c) =>
      generateSkillDraftLLM(c, { generateText: callLLM }),
    );

    const candidate1 = makeCandidate({
      taskSummary: "批量导出飞书多维表格数据到Excel",
      toolCalls: [
        "feishu_base_list", "feishu_base_records", "xlsx_create",
        "xlsx_write", "xlsx_formula", "feishu_base_fields",
        "xlsx_write", "feishu_base_records", "xlsx_formula",
        "feishu_base_fields", "xlsx_write",
      ],
      uniqueToolCount: 5,
      reasoningTurns: 9,
      durationMs: 260_000,
      domain: "feishu-data",
    });

    const decision1 = await engine.evaluate(candidate1, "user-live-2");
    const draft1 = await engine.generate(candidate1);
    await store.save({
      id: "rec-live-1",
      userId: "user-live-2",
      candidate: candidate1,
      decision: decision1,
      draft: draft1,
      timestamp: Date.now(),
    });

    const candidate2 = makeCandidate({
      taskSummary: "搜索竞品分析报告并整理到知识库",
      toolCalls: [
        "web_search", "web_search", "feishu_wiki_create", "feishu_doc_write",
        "web_search", "read_file", "feishu_doc_write", "feishu_wiki_create",
        "web_search",
      ],
      uniqueToolCount: 4,
      reasoningTurns: 8,
      durationMs: 250_000,
      domain: "research",
    });

    const decision2 = await engine.evaluate(candidate2, "user-live-2");
    const draft2 = await engine.generate(candidate2);

    console.log(`\n  [Round 1] ${draft1.name} → saved`);
    console.log(`  [Round 2] ${draft2.name}`);
    console.log(`  [Round 2] recentSuggestions: ${JSON.stringify(decision2.recentSuggestions)}`);
    console.log(`  [Round 2] complexityScore: ${decision2.complexityScore.toFixed(2)} (reference)\n`);

    expect(decision2.recentSuggestions).toHaveLength(1);
    expect(decision2.recentSuggestions![0]!.skillName).toBe(draft1.name);
    expect(decision2.recentSuggestions![0]!.domain).toBe("feishu-data");
    expect(draft2.name).toBeTruthy();
  }, 240_000);

  it("simple task with errors → still generates draft (agent decides)", async () => {
    // In the old architecture this would be gated by errorComplexityThreshold.
    // Now: hard-trigger sends signal on 3+ tools regardless,
    // and the tool always generates a draft — the Agent decides worthiness.
    const engine = new EvolutionEngine(store, undefined, undefined, (c) =>
      generateSkillDraftLLM(c, { generateText: callLLM }),
    );

    const simpleWithErrors = makeCandidate({
      taskSummary: "查询天气（有工具错误）",
      toolCalls: ["weather_get", "weather_get", "weather_get"],
      uniqueToolCount: 1,
      reasoningTurns: 3,
      durationMs: 15_000,
      domain: "weather",
      errorProfile: { errorCount: 2, failedToolNames: ["weather_get"], hasMutatingErrors: false },
    });

    // evaluate is called for context only — complexityScore is reference info
    const decision = await engine.evaluate(simpleWithErrors, "user-live-err");

    // generate always runs — no gate
    const draft = await engine.generate(simpleWithErrors);

    console.log(`\n  Simple task with errors:`);
    console.log(`  complexityScore: ${decision.complexityScore.toFixed(2)} (reference only)`);
    console.log(`  Draft generated: ${draft.name}`);
    console.log(`  Description: ${draft.description}\n`);

    // Draft is always generated regardless of score
    expect(draft.name).toBeTruthy();
    expect(draft.description.length).toBeGreaterThan(0);
    // Score is still computed (as reference info for the Agent)
    expect(typeof decision.complexityScore).toBe("number");
  }, 120_000);
});


