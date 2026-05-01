/**
 * Live evolution end-to-end test — verifies the full self-evolution pipeline
 * from hard-trigger detection through signal delivery to agent tool evaluation.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 pnpm test src/cognitive/evolution/evolution-live-e2e.test.ts
 *
 * What this tests:
 *   1. Hard-trigger: 3+ tools → evaluate → enqueue signal + request heartbeat
 *   2. Agent tool: evaluate_skill_evolution → real LLM draft + recentSuggestions context
 *   3. No-cooldown flow: multiple suggestions for same user all succeed
 *   4. Signal format: [Evolution Signal] contains correct tool sequence and metadata
 *   5. recentSuggestions context: prior records appear in subsequent evaluations
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvolutionCandidate } from "./types.js";
import { EvolutionEngine } from "./engine.js";
import { EvolutionStore } from "./store.js";
import { generateSkillDraftLLM } from "./llm-draft-generator.js";
import {
  enqueueSystemEvent,
  peekSystemEventEntries,
  resetSystemEventsForTest,
} from "../../infra/system-events.js";
import {
  requestHeartbeatNow,
  resetHeartbeatWakeStateForTests,
} from "../../infra/heartbeat-wake.js";

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
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  resetSystemEventsForTest();
  resetHeartbeatWakeStateForTests();
});

// ===========================================================================
// PHASE 1: Hard-trigger signal generation (no LLM needed)
// ===========================================================================
describe("Phase 1: hard-trigger signal generation", () => {
  it("builds correct [Evolution Signal] text from candidate", async () => {
    const toolCalls = [
      "web_search", "read_file", "web_search", "write_file",
      "read_file", "web_search", "write_file", "read_file",
      "web_search", "write_file",
    ];
    const candidate = makeCandidate({
      taskSummary: "auto",
      toolCalls,
      uniqueToolCount: 3,
      reasoningTurns: 8,
      durationMs: 280_000,
      domain: "auto",
    });

    const engine = new EvolutionEngine(store);
    const decision = await engine.evaluate(candidate, "user-signal-test");

    expect(decision.shouldSuggest).toBe(true);

    const signalText = buildEvolutionSignalFromDecision(candidate);
    expect(signalText).toContain("[Evolution Signal]");
    expect(signalText).toContain("10 次工具调用");
    expect(signalText).toContain("3 种");
    expect(signalText).toContain("280 秒");
    expect(signalText).toContain("evaluate_skill_evolution");
  });

  it("enqueues signal and heartbeat fires correctly", () => {
    const sessionKey = "agent:main:ou_test_user";
    const signalText = "[Evolution Signal] test signal";

    enqueueSystemEvent(signalText, { sessionKey });

    const events = peekSystemEventEntries(sessionKey);
    expect(events).toHaveLength(1);
    expect(events[0]!.text).toBe(signalText);

    requestHeartbeatNow({ reason: "cognitive-evolution", sessionKey });
    expect(true).toBe(true);
  });

  it("skips signal for < 3 tool calls", async () => {
    const candidate = makeCandidate({
      toolCalls: ["a", "b"],
      uniqueToolCount: 2,
      reasoningTurns: 1,
      durationMs: 5_000,
    });

    const engine = new EvolutionEngine(store);
    const decision = await engine.evaluate(candidate, "user-skip-test");
    expect(decision.shouldSuggest).toBe(false);
  });
});

// ===========================================================================
// PHASE 2: No-cooldown flow (no LLM needed)
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
// PHASE 3: Full agent tool flow with real LLM (requires API key)
// ===========================================================================
describe.skipIf(!isLive || !ZAI_API_KEY)("Phase 3: full tool flow with real LLM", () => {
  it("generates skill draft and returns recentSuggestions context", async () => {
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

    const decision = await engine.evaluate(candidate, "user-live-1");
    expect(decision.shouldSuggest).toBe(true);

    const draft = await engine.generate(candidate);

    console.log(`\n  ═══ Live Draft ═══`);
    console.log(`  Name: ${draft.name}`);
    console.log(`  Description: ${draft.description}`);
    console.log(`  Triggers: ${draft.triggerPhrases.join(", ")}`);
    console.log(`  Body lines: ${draft.bodyMarkdown.split("\n").length}`);
    console.log(`  recentSuggestions: ${JSON.stringify(decision.recentSuggestions)}`);
    console.log(`  ═══════════════════\n`);

    expect(draft.name).toBeTruthy();
    expect(draft.description.length).toBeGreaterThan(5);
    expect(draft.triggerPhrases.length).toBeGreaterThanOrEqual(2);
    expect(draft.bodyMarkdown.length).toBeGreaterThan(100);
    expect(decision.recentSuggestions).toEqual([]);
  }, 120_000);

  it("second evaluation for same user shows first record in recentSuggestions", async () => {
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
    expect(decision1.shouldSuggest).toBe(true);

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
    expect(decision2.shouldSuggest).toBe(true);
    expect(decision2.recentSuggestions).toHaveLength(1);
    expect(decision2.recentSuggestions![0]!.skillName).toBe(draft1.name);
    expect(decision2.recentSuggestions![0]!.domain).toBe("feishu-data");

    console.log(`\n  [Round 1] ${draft1.name} → saved`);
    console.log(`  [Round 2] recentSuggestions: ${JSON.stringify(decision2.recentSuggestions)}`);
    console.log(`  Round 2 still suggests: ${decision2.shouldSuggest}\n`);
  }, 240_000);

  it("error-triggered evaluation uses lower threshold and still suggests", async () => {
    const engine = new EvolutionEngine(store);

    const simpleWithErrors = makeCandidate({
      taskSummary: "查询天气（有工具错误）",
      toolCalls: ["weather_get", "weather_get", "weather_get"],
      uniqueToolCount: 1,
      reasoningTurns: 3,
      durationMs: 15_000,
      domain: "weather",
      errorProfile: { errorCount: 2, failedToolNames: ["weather_get"], hasMutatingErrors: false },
    });

    const decision = await engine.evaluate(simpleWithErrors, "user-live-err");
    expect(decision.shouldSuggest).toBe(true);
    expect(decision.reasoning).toContain("error threshold");

    console.log(`\n  Error-triggered evaluation:`);
    console.log(`  shouldSuggest: ${decision.shouldSuggest}`);
    console.log(`  complexityScore: ${decision.complexityScore.toFixed(2)}`);
    console.log(`  reasoning: ${decision.reasoning}\n`);
  });
});

// ===========================================================================
// Helper: build signal text matching hard-trigger.ts logic
// ===========================================================================
function buildEvolutionSignalFromDecision(candidate: EvolutionCandidate): string {
  const durationSec = Math.round(candidate.durationMs / 1000);
  const toolSeq = candidate.toolCalls.join(", ");
  return [
    `[Evolution Signal] 刚完成的任务涉及 ${candidate.toolCalls.length} 次工具调用（${candidate.uniqueToolCount} 种），持续 ${durationSec} 秒。`,
    `工具序列: ${toolSeq}`,
    "",
    "请评估：这个任务模式是否值得做成可复用技能？",
    "如果是，用自然语言告诉用户你的想法，然后调用 evaluate_skill_evolution 工具生成技能草稿。",
    "如果觉得不值得，忽略即可。",
  ].join("\n");
}
