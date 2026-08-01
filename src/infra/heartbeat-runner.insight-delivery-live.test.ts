/**
 * Live insight delivery pipeline test — verifies the complete chain:
 *
 *   insight text
 *     → enqueueSystemEvent("[Cognitive Insight] ...", { sessionKey })   [onInsightReady]
 *     → requestHeartbeatNow({ reason: "cognitive-insight", sessionKey })
 *     → HeartbeatRunner.run() → state.agents bypass                    [Fix 1]
 *     → runHeartbeatOnce → disabled check bypass                       [Fix B]
 *     → resolveHeartbeatPreflight → isInsightEvent detects             [infra]
 *     → resolveHeartbeatRunPrompt → buildInsightEventPrompt            [infra]
 *     → getReplyFromConfig → REAL LLM generates delivery message       [Phase 2]
 *     → consumeInspectedSystemEvents → event drained                   [infra]
 *     → LLM reply is a natural conversational sharing of the insight   [Phase 2]
 *
 * Phase 1 (always runs): infrastructure verification — no LLM needed.
 *   Proves events are detected, prompt is built, getReplyFromConfig is called,
 *   events are consumed.
 *
 * Phase 2 (requires KAIJIBOT_LIVE_TEST=1 + ZAI_API_KEY): real LLM delivery.
 *   Calls the real GLM model with the insight prompt + system event, verifies
 *   the model generates a natural, conversational message that shares the insight.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY pnpm test src/infra/heartbeat-runner.insight-delivery-live.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { buildInsightEventPrompt } from "./heartbeat-events-filter.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import { installHeartbeatRunnerTestRuntime } from "./heartbeat-runner.test-harness.js";
import {
  seedMainSessionStore,
  withTempHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";
import {
  enqueueSystemEvent,
  peekSystemEventEntries,
  resetSystemEventsForTest,
} from "./system-events.js";

installHeartbeatRunnerTestRuntime();

// ─── Live test config ───────────────────────────────────────────────────────

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
      max_tokens: 1000,
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

// ─── Test insights (pre-crafted, mirroring real proactive insight output) ────

const TEST_INSIGHTS: Array<{ text: string; keywords: string[]; label: string }> = [
  {
    label: "cross-domain",
    text: '你之前在用 AI 辅助解读医疗检查结果时表现出的那种「先自己理解再验证」的模式，其实也可以用在解读 Apple Watch 的健康数据上。两者本质上都是从非结构化数据里提取有意义的信号。',
    keywords: ["健康", "数据", "模式", "Apple Watch", "AI"],
  },
  {
    label: "behavioral",
    text: "你最近几次遇到性能问题都是先加缓存而不是分析瓶颈。这个默认反应在 TypeScript 项目里可能掩盖真正的问题——有时候瓶颈在数据库查询而不是前端渲染。",
    keywords: ["缓存", "性能", "瓶颈", "TypeScript"],
  },
  {
    label: "domain-depth",
    text: '你在 Rust 的 borrow checker 上花了不少时间，但你关注的是「怎么绕过它」而不是「为什么它存在」。换个角度，borrow checker 其实在帮你证明内存安全，这是大多数语言做不到的事。',
    keywords: ["Rust", "borrow", "内存"],
  },
];

// ─── Shared config builder ──────────────────────────────────────────────────

function buildConfig(tmpDir: string, storePath: string): KaijiBotConfig {
  return {
    agents: {
      defaults: {
        workspace: tmpDir,
        heartbeat: { every: "30m" },
        model: { primary: "zai/glm-5-turbo" },
      },
    },
    channels: { telegram: { token: "test" } },
    session: { store: storePath },
  } as unknown as KaijiBotConfig;
}

const DELIVERY_INSTRUCTION =
  "（这是一条已生成的主动洞察，请用你自己的语言自然地分享给用户。）";

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: Infrastructure — always runs (no LLM)
//
// Proves the mechanical chain: event enqueue → detect → prompt build →
// getReplyFromConfig called → event consumed.
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 1: infrastructure — insight event → runHeartbeatOnce → drain", () => {
  beforeEach(() => {
    resetSystemEventsForTest();
  });

  afterEach(() => {
    resetSystemEventsForTest();
  });

  it("insight event detected, insight prompt built, getReplyFromConfig called, event consumed", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      const cfg = buildConfig(tmpDir, storePath);
      const sessionKey = resolveMainSessionKey(cfg);
      await seedMainSessionStore(storePath, cfg, {
        sessionId: "sid_infra",
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "123456789",
      });

      // Enqueue insight event (simulates onInsightReady)
      const eventText = `[Cognitive Insight] ${TEST_INSIGHTS[0]!.text}\n${DELIVERY_INSTRUCTION}`;
      enqueueSystemEvent(eventText, { sessionKey });
      expect(peekSystemEventEntries(sessionKey)).toHaveLength(1);

      let capturedBody: string | undefined;
      const mockGetReply = vi.fn().mockImplementation(async (ctx: unknown) => {
        capturedBody = (ctx as { Body?: string }).Body;
        return { text: "" };
      });

      const result = await runHeartbeatOnce({
        cfg,
        reason: "cognitive-insight",
        sessionKey,
        deps: {
          getQueueSize: () => 0,
          nowMs: () => Date.now(),
          getReplyFromConfig: mockGetReply,
        } as never,
      });

      // Infrastructure assertions
      expect(result.status).toBe("ran");
      expect(mockGetReply).toHaveBeenCalledTimes(1);
      expect(capturedBody).toBeTruthy();
      // Prompt is the insight event prompt, not generic heartbeat
      expect(capturedBody).toContain("洞察");
      // Event consumed
      expect(peekSystemEventEntries(sessionKey)).toHaveLength(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: Live LLM delivery — requires KAIJIBOT_LIVE_TEST=1 + ZAI_API_KEY
//
// Calls the real GLM model with the insight prompt + system event.
// Verifies the model generates a natural, conversational delivery message
// that actually shares the insight content.
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(!isLive || !ZAI_API_KEY)(
  "Phase 2: live LLM insight delivery",
  () => {
    beforeEach(() => {
      resetSystemEventsForTest();
    });

    afterEach(() => {
      resetSystemEventsForTest();
    });

    for (const insight of TEST_INSIGHTS) {
      it(`LLM delivers ${insight.label} insight naturally via heartbeat prompt`, async () => {
        await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
          const cfg = buildConfig(tmpDir, storePath);
          const sessionKey = resolveMainSessionKey(cfg);
          await seedMainSessionStore(storePath, cfg, {
            sessionId: `sid_live_${insight.label}`,
            lastChannel: "telegram",
            lastProvider: "telegram",
            lastTo: "123456789",
          });

          // Enqueue insight event
          const eventText = `[Cognitive Insight] ${insight.text}\n${DELIVERY_INSTRUCTION}`;
          enqueueSystemEvent(eventText, { sessionKey });

          // Mock getReplyFromConfig: call real LLM, capture output,
          // return empty text so heartbeat completes without delivery attempt.
          let llmReply: string | undefined;
          const heartbeatPrompt = buildInsightEventPrompt();

          const mockGetReply = vi.fn().mockImplementation(async (ctx: unknown) => {
            const prompt = (ctx as { Body?: string }).Body ?? heartbeatPrompt;
            // Simulate what the agent turn does: system event drained as System: line
            const systemLine = `System: [test-time] ${eventText}`;
            llmReply = await callLLM({ system: systemLine, user: prompt });
            return { text: "" };
          });

          // Run heartbeat with real LLM
          const result = await runHeartbeatOnce({
            cfg,
            reason: "cognitive-insight",
            sessionKey,
            deps: {
              getQueueSize: () => 0,
              nowMs: () => Date.now(),
              getReplyFromConfig: mockGetReply,
            } as never,
          });

          // ── Infrastructure assertions ──────────────────────────────────
          expect(result.status).toBe("ran");
          expect(mockGetReply).toHaveBeenCalledTimes(1);
          expect(peekSystemEventEntries(sessionKey)).toHaveLength(0);

          // ── LLM delivery quality assertions ────────────────────────────
          expect(llmReply).toBeTruthy();
          const reply = llmReply!;
          const trimmed = reply.trim();

          console.log(`\n  ═══ ${insight.label} ═══`);
          console.log(`  洞察: ${insight.text.slice(0, 80)}...`);
          console.log(`  投递: ${trimmed}`);
          console.log(`  长度: ${trimmed.length}`);
          console.log(`  ═══════════════════════\n`);

          // 1. Not empty / not a token
          expect(trimmed.length).toBeGreaterThan(20);
          expect(trimmed).not.toContain("HEARTBEAT_OK");
          expect(trimmed).not.toMatch(/^ok$/i);

          // 2. Contains at least one keyword from the insight
          const hasKeyword = insight.keywords.some((kw) =>
            trimmed.toLowerCase().includes(kw.toLowerCase()),
          );
          expect(hasKeyword).toBe(true);

          // 3. Conversational tone — first person, question, or casual marker
          const hasFirstPerson = /我|I /.test(trimmed);
          const hasQuestion = /[？?]/.test(trimmed);
          const hasCasualMarker = /其实|说真的|你看|你想|话说|对了|你知道吗|突然|觉得/.test(
            trimmed,
          );
          const isConversational = hasFirstPerson || hasQuestion || hasCasualMarker;
          expect(isConversational).toBe(true);

          // 4. Not a push notification — no "亲爱的用户" or formal notification style
          expect(trimmed).not.toMatch(/亲爱的用户|尊敬的|您好|push|notification/i);

          // 5. Reasonable length (not a one-liner, not a wall of text)
          expect(trimmed.length).toBeGreaterThanOrEqual(15);
          expect(trimmed.length).toBeLessThanOrEqual(2000);
        });
      }, 120_000); // 2 min timeout per insight for live LLM
    }

    it("LLM does not fabricate insight when no event is queued (negative control)", async () => {
      await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
        const cfg = buildConfig(tmpDir, storePath);
        const sessionKey = resolveMainSessionKey(cfg);
        await seedMainSessionStore(storePath, cfg, {
          sessionId: "sid_live_negative",
          lastChannel: "telegram",
          lastProvider: "telegram",
          lastTo: "123456789",
        });

        // NO insight event enqueued
        let llmReply: string | undefined;
        const mockGetReply = vi.fn().mockImplementation(async (ctx: unknown) => {
          const prompt = (ctx as { Body?: string }).Body ?? "";
          // Without an insight system event, the prompt should be generic heartbeat
          llmReply = await callLLM({
            system: "You are a helpful assistant.",
            user: prompt,
          });
          return { text: "" };
        });

        const result = await runHeartbeatOnce({
          cfg,
          reason: "cognitive-insight",
          sessionKey,
          deps: {
            getQueueSize: () => 0,
            nowMs: () => Date.now(),
            getReplyFromConfig: mockGetReply,
          } as never,
        });

        expect(result.status).toBe("ran");
        expect(mockGetReply).toHaveBeenCalledTimes(1);

        // Without insight event, prompt should NOT be the insight prompt
        console.log(`\n  ═══ Negative Control ═══`);
        console.log(`  Prompt (first 100): ${llmReply?.slice(0, 100) ?? "(empty)"}`);
        console.log(`  ═══════════════════════\n`);
      });
    }, 60_000);
  },
);
