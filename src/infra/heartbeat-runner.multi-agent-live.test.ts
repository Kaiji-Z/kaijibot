/**
 * Live multi-agent insight delivery test.
 *
 * Simulates the exact production scenario:
 *   3 insights generated → enqueued to main, lambda, meongmeong sessions
 *   → requestHeartbeatNow for each
 *   → HeartbeatRunner dispatches wakes to all 3 agents
 *   → each agent's heartbeat fires (including non-default via Fix 1 bypass)
 *   → real LLM generates delivery message for each
 *
 * Phase A (always runs): proves Fix 1 — all 3 wakes reach runOnce,
 *   including lambda and meongmeong which are NOT in state.agents.
 *   If Fix 1 is broken, lambda/meongmeong runOnce calls will be missing.
 *
 * Phase B (requires KAIJIBOT_LIVE_TEST=1 + ZAI_API_KEY): for each agent
 *   that was reached, calls the real GLM model with the insight prompt
 *   and verifies the delivery message quality.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY pnpm test src/infra/heartbeat-runner.multi-agent-live.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { buildInsightEventPrompt } from "./heartbeat-events-filter.js";
import { startHeartbeatRunner } from "./heartbeat-runner.js";
import { requestHeartbeatNow, resetHeartbeatWakeStateForTests } from "./heartbeat-wake.js";
import { enqueueSystemEvent, resetSystemEventsForTest } from "./system-events.js";

// ─── Live LLM config ────────────────────────────────────────────────────────

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";

async function callLLM(params: { system: string; user: string }): Promise<string> {
  const res = await fetch(ZAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ZAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
      temperature: 0.85,
      max_tokens: 800,
    }),
  });
  const data = (await res.json()) as {
    error?: { message: string };
    choices?: Array<{ message: { content: string } }>;
  };
  if (data.error) {
    throw new Error(data.error.message);
  }
  return data.choices?.[0]?.message?.content ?? "";
}

// ─── Test insights (one per agent) ──────────────────────────────────────────

const TEST_AGENTS = [
  {
    agentId: "main",
    sessionKey: "agent:main:feishu:direct:ou_user_main",
    insight:
      "你一直在优化认知系统的 PRISM 门控参数，但你调的是阈值——真正的杠杆可能在 pNeed 的估算模型本身。",
    keywords: ["PRISM", "门控", "参数", "阈值"],
  },
  {
    agentId: "lambda",
    sessionKey: "agent:lambda:feishu:direct:ou_user_lambda",
    insight:
      "你学机器学习课程时总是先推导数学公式再写代码，但反过来可能更高效——先跑最小例子建立直觉，再回头理解推导。",
    keywords: ["机器学习", "数学", "代码", "直觉"],
  },
  {
    agentId: "meongmeong",
    sessionKey: "agent:meongmeong:feishu:direct:ou_user_meong",
    insight:
      "你追踪健康数据的颗粒度越来越细，但更高分辨率的观察不等于更深层的理解——有时候聚合视图比原始数据更能揭示模式。",
    keywords: ["健康", "数据", "分辨率", "模式"],
  },
] as const;

const DELIVERY_INSTRUCTION =
  "（这是一条已生成的主动洞察，请用你自己的语言自然地分享给用户。）";

// ═══════════════════════════════════════════════════════════════════════════
// PHASE A: Wake dispatch — all 3 agents must reach runOnce
//
// This is the CODE FIX test. If Fix 1 (state.agents bypass) is broken,
// lambda and meongmeong will be missing from heartbeatCalls.
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase A: multi-agent wake dispatch (3 insights → 3 heartbeats)", () => {
  beforeEach(() => {
    resetHeartbeatWakeStateForTests();
    resetSystemEventsForTest();
  });

  afterEach(() => {
    resetHeartbeatWakeStateForTests();
    resetSystemEventsForTest();
    vi.useRealTimers();
  });

  it("fires heartbeat for all 3 agents including non-default lambda and meongmeong", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    // Config mirrors production: only main (default) has heartbeat.
    // lambda and meongmeong are NOT in state.agents.
    const cfg = {
      agents: {
        defaults: { heartbeat: { every: "30m" }, model: { primary: "zai/glm-5-turbo" } },
        list: [
          { id: "main", default: true, name: "Main" },
          { id: "lambda", name: "Lambda" },
          { id: "meongmeong", name: "Meongmeong" },
        ],
      },
    } as unknown as KaijiBotConfig;

    // Track which agents received heartbeat calls
    const heartbeatCalls: Array<{
      agentId: string;
      reason?: string;
      sessionKey?: string;
    }> = [];

    const runOnce = vi.fn().mockImplementation(async (opts: Record<string, unknown>) => {
      heartbeatCalls.push({
        agentId: opts.agentId as string,
        reason: opts.reason as string,
        sessionKey: opts.sessionKey as string,
      });
      return { status: "ran" as const, durationMs: 1 };
    });

    const runner = startHeartbeatRunner({ cfg, runOnce });

    // Simulate: ProactiveScheduler generates 3 insights, onInsightReady fires for each
    for (const agent of TEST_AGENTS) {
      const eventText = `[Cognitive Insight] ${agent.insight}\n${DELIVERY_INSTRUCTION}`;
      enqueueSystemEvent(eventText, { sessionKey: agent.sessionKey });
      requestHeartbeatNow({
        reason: "cognitive-insight",
        sessionKey: agent.sessionKey,
        coalesceMs: 0,
      });
      await vi.advanceTimersByTimeAsync(1);
    }

    runner.stop();

    // ── Assert: all 3 agents received heartbeat calls ──────────────────────
    expect(heartbeatCalls).toHaveLength(3);

    const calledAgentIds = heartbeatCalls.map((c) => c.agentId).toSorted();
    expect(calledAgentIds).toEqual(["lambda", "main", "meongmeong"]);

    // ── Assert: all calls have cognitive-insight reason ────────────────────
    for (const call of heartbeatCalls) {
      expect(call.reason).toBe("cognitive-insight");
    }

    // ── Assert: session keys are correctly routed per agent ────────────────
    const callMap = new Map(heartbeatCalls.map((c) => [c.agentId, c]));
    expect(callMap.get("main")?.sessionKey).toContain("agent:main:");
    expect(callMap.get("lambda")?.sessionKey).toContain("agent:lambda:");
    expect(callMap.get("meongmeong")?.sessionKey).toContain("agent:meongmeong:");

    console.log("\n  ═══ Phase A: Wake Dispatch ═══");
    for (const call of heartbeatCalls) {
      const inState = call.agentId === "main" ? "(in state.agents)" : "(Fix 1 bypass)";
      console.log(`  ✅ ${call.agentId} ${inState} → ${call.sessionKey}`);
    }
    console.log("  ═══════════════════════════════\n");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE B: Live LLM delivery — all 3 agents get delivery messages
//
// For each agent that was reached in Phase A, calls the real GLM model
// with the insight prompt + system event, verifies delivery quality.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!isLive || !ZAI_API_KEY)(
  "Phase B: live LLM delivery for all 3 agents",
  () => {
    it("LLM generates natural delivery messages for main, lambda, and meongmeong insights", async () => {
      const heartbeatPrompt = buildInsightEventPrompt();
      const results: Array<{
        agentId: string;
        reply: string;
        duration: number;
      }> = [];

      for (const agent of TEST_AGENTS) {
        const eventText = `[Cognitive Insight] ${agent.insight}\n${DELIVERY_INSTRUCTION}`;
        const systemLine = `System: [test-time] ${eventText}`;

        const t0 = Date.now();
        const reply = await callLLM({ system: systemLine, user: heartbeatPrompt });
        const duration = Date.now() - t0;

        results.push({ agentId: agent.agentId, reply: reply.trim(), duration });
      }

      // ── Console output ────────────────────────────────────────────────────
      console.log("\n  ═══ Phase B: Live LLM Delivery ═══");
      for (const r of results) {
        console.log(`\n  ── ${r.agentId} (${(r.duration / 1000).toFixed(1)}s) ──`);
        console.log(`  ${r.reply}`);
      }
      console.log("\n  ═══════════════════════════════════\n");

      // ── Assert: all 3 got delivery messages ───────────────────────────────
      expect(results).toHaveLength(3);

      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        const agent = TEST_AGENTS[i]!;

        // Not empty
        expect(r.reply.length).toBeGreaterThan(20);

        // Not a token
        expect(r.reply).not.toContain("HEARTBEAT_OK");
        expect(r.reply).not.toMatch(/^ok$/i);

        // Contains at least one keyword from the insight
        const hasKeyword = agent.keywords.some((kw) =>
          r.reply.toLowerCase().includes(kw.toLowerCase()),
        );
        expect(hasKeyword).toBe(true);

        // Conversational tone
        const hasFirstPerson = /我|I /.test(r.reply);
        const hasQuestion = /[？?]/.test(r.reply);
        const hasCasualMarker = /其实|说真的|你看|你想|话说|对了|你知道吗|突然|觉得|聊个|注意到/.test(
          r.reply,
        );
        expect(hasFirstPerson || hasQuestion || hasCasualMarker).toBe(true);

        // Not push notification style
        expect(r.reply).not.toMatch(/亲爱的用户|尊敬的|您好/i);

        // Reasonable length
        expect(r.reply.length).toBeLessThanOrEqual(2000);
      }

      // ── Summary ───────────────────────────────────────────────────────────
      const avgDuration = results.reduce((s, r) => s + r.duration, 0) / results.length;
      console.log(
        `  平均 LLM 响应时间: ${(avgDuration / 1000).toFixed(1)}s (idle timeout: 60s)`,
      );
      expect(avgDuration).toBeLessThan(60_000);
    }, 300_000); // 5 min for 3 sequential LLM calls
  },
);
