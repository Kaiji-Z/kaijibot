import { afterEach, describe, expect, it, vi } from "vitest";
import { InsightStore } from "../cognitive/insight/store.js";
import type { InsightRecord } from "../cognitive/types.js";
import type { KaijiBotConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import { installHeartbeatRunnerTestRuntime } from "./heartbeat-runner.test-harness.js";
import { seedMainSessionStore, withTempHeartbeatSandbox } from "./heartbeat-runner.test-utils.js";
import { setHeartbeatsEnabled } from "./heartbeat-wake.js";
import {
  drainSystemEventEntries,
  enqueueSystemEvent,
  peekSystemEventEntries,
} from "./system-events.js";

// Register telegram + whatsapp test plugins so delivery resolution can proceed.
installHeartbeatRunnerTestRuntime();

// ┌─────────────────────────────────────────────────────────────────────────────
// │ PROOF: runHeartbeatOnce end-to-end insight delivery chain                   │
// │                                                                             │
// │ Tests 1-6 in cognitive-wake-fix.test.ts proved: wake handler → runOnce.     │
// │ cognitive-bypass.test.ts proved: runHeartbeatOnce doesn't skip cognitive.   │
// │                                                                             │
// │ THIS test proves the remaining chain inside runHeartbeatOnce:               │
// │                                                                             │
// │   1. Insight system event is detected by isInsightEvent                     │
// │   2. resolveHeartbeatRunPrompt builds insight prompt (not generic heartbeat)│
// │   3. getReplyFromConfig IS called (agent turn executes)                     │
// │   4. The prompt contains insight delivery instructions                      │
// │   5. After the run, system event IS consumed (drained from queue)           │
// │                                                                             │
// │ If any link fails, the insight never reaches the user despite the wake      │
// │ handler fix working correctly.                                             │
// └─────────────────────────────────────────────────────────────────────────────

describe("runHeartbeatOnce insight event → prompt → reply → drain", () => {
  afterEach(() => {
    setHeartbeatsEnabled(true);
  });

  it("detects insight event, builds insight prompt, calls agent, drains event", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      const cfg = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "30m" },
            model: { primary: "test/model" },
          },
        },
        channels: {
          telegram: { token: "test" },
        },
        session: { store: storePath },
      } as unknown as KaijiBotConfig;

      const sessionKey = resolveMainSessionKey(cfg);
      await seedMainSessionStore(storePath, cfg, {
        sessionId: "sid_test",
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "123456789",
      });

      // ── Step 1: Enqueue a cognitive insight system event ───────────────────
      //
      // This simulates what onInsightReady does in server.impl.ts after the
      // proactive scheduler generates an insight:
      //   enqueueSystemEvent(`[Cognitive Insight] ${text}\n（投递指令）`, { sessionKey })
      const insightText = "你在肩背恢复方面的行为模式有一个有趣的矛盾";
      const deliveryInstruction =
        "（这是一条已生成的主动洞察，请用你自己的语言自然地分享给用户。）";
      const eventText = `[Cognitive Insight] ${insightText}\n${deliveryInstruction}`;
      enqueueSystemEvent(eventText, { sessionKey });

      // Verify event is in queue before heartbeat
      const beforePeek = peekSystemEventEntries(sessionKey);
      expect(beforePeek).toHaveLength(1);
      expect(beforePeek[0]?.text).toContain("[Cognitive Insight]");

      // ── Step 2: Mock getReplyFromConfig to capture the prompt ──────────────
      //
      // Return empty text so the heartbeat completes without attempting
      // outbound delivery (line 1037: empty reply → consume events → return "ran").
      let capturedBody: string | undefined;
      const mockGetReplyFromConfig = vi.fn().mockImplementation(async (ctx: unknown) => {
        capturedBody = (ctx as { Body?: string }).Body;
        return { text: "" };
      });

      // ── Step 3: Run heartbeat with cognitive-insight reason ────────────────
      const result = await runHeartbeatOnce({
        cfg,
        reason: "cognitive-insight",
        sessionKey,
        deps: {
          getQueueSize: () => 0,
          nowMs: () => Date.now(),
          getReplyFromConfig: mockGetReplyFromConfig,
        } as never,
      });

      // ── Step 4: Assert the full chain worked ───────────────────────────────

      // 4a: Heartbeat ran (not skipped/failed)
      expect(result.status).toBe("ran");

      // 4b: getReplyFromConfig WAS called — the agent turn executed
      expect(mockGetReplyFromConfig).toHaveBeenCalledTimes(1);

      // 4c: The prompt is the insight event prompt, not the generic heartbeat prompt.
      // buildInsightEventPrompt() returns INSIGHT_EVENT_PROMPT which contains
      // "主动洞察" / "proactive insight" delivery instructions.
      expect(capturedBody).toBeTruthy();
      expect(capturedBody).toContain("洞察");

      // 4d: System event was consumed — drained from the queue after the run.
      // consumeInspectedSystemEvents() is called at line 1055 after the reply.
      const afterPeek = peekSystemEventEntries(sessionKey);
      expect(afterPeek).toHaveLength(0);

      // 4e: drainSystemEventEntries also returns empty (queue fully consumed)
      const drained = drainSystemEventEntries(sessionKey);
      expect(drained).toHaveLength(0);
    });
  });

  it("does NOT build insight prompt when no insight event is queued", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      const cfg = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "30m" },
            model: { primary: "test/model" },
          },
        },
        channels: {
          telegram: { token: "test" },
        },
        session: { store: storePath },
      } as unknown as KaijiBotConfig;

      const sessionKey = resolveMainSessionKey(cfg);
      await seedMainSessionStore(storePath, cfg, {
        sessionId: "sid_test",
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "123456789",
      });

      // NO insight event enqueued — just a regular cognitive-insight wake
      // (e.g. wake fired but event was already consumed by a prior run)
      let capturedBody: string | undefined;
      const mockGetReplyFromConfig = vi.fn().mockImplementation(async (ctx: unknown) => {
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
          getReplyFromConfig: mockGetReplyFromConfig,
        } as never,
      });

      // Heartbeat should still run (cognitive bypass prevents "disabled" skip)
      expect(result.status).toBe("ran");

      // But the prompt should NOT contain insight delivery instructions
      // (it falls through to the default heartbeat prompt)
      if (capturedBody) {
        expect(capturedBody).not.toContain("主动洞察已生成");
      }
    });
  });

  it("writes deliveryMessageId to the exact insight referenced by contextKey, not the first undelivered record", async () => {
    await withTempHeartbeatSandbox(
      async ({ tmpDir, storePath, replySpy }) => {
        const prevStateDir = process.env.KAIJIBOT_STATE_DIR;
        process.env.KAIJIBOT_STATE_DIR = tmpDir;
        try {
          const cfg = {
            agents: {
              defaults: {
                workspace: tmpDir,
                heartbeat: { every: "30m" },
                model: { primary: "test/model" },
              },
            },
            channels: { telegram: { allowFrom: ["*"] } },
            session: { store: storePath },
          } as unknown as KaijiBotConfig;

          const sessionKey = await seedMainSessionStore(storePath, cfg, {
            sessionId: "sid_wb",
            lastChannel: "telegram",
            lastProvider: "telegram",
            lastTo: "-100155462274",
          });

          // Seed two undelivered insights. The decoy has NEWER generatedAt, so
          // the old "first record without deliveryMessageId" heuristic (listActive
          // sorts by generatedAt desc) would write the msgId to the decoy. The
          // contextKey targets the older record — this test proves the fix writes
          // deliveryMessageId to the correct (contextKey-referenced) record.
          const insightStore = new InsightStore(tmpDir);
          const now = Date.now();
          const decoy: InsightRecord = {
            id: "insight-decoy",
            generatedAt: now - 60_000,
            triggerSource: "scheduled",
            targetDomains: ["测试"],
            sourceDomains: [],
            content: "诱饵洞察",
            rationale: "test",
            sources: [],
            deliveredAt: now - 30_000,
          };
          const target: InsightRecord = {
            id: "insight-target",
            generatedAt: now - 300_000,
            triggerSource: "scheduled",
            targetDomains: ["软件开发"],
            sourceDomains: [],
            content: "目标洞察",
            rationale: "test",
            sources: [],
            deliveredAt: now - 200_000,
          };
          // resolveCognitiveUserId("agent:main:main") → "operator"
          await insightStore.save("main", "operator", decoy);
          await insightStore.save("main", "operator", target);

          const sendTelegram = vi
            .fn()
            .mockResolvedValue({ messageId: "m1", chatId: "-100155462274" });
          replySpy.mockResolvedValue({ text: "这是一条主动洞察，分享给你。" });

          const eventText =
            "[Cognitive Insight] 目标洞察\n（这是一条已生成的主动洞察，请用你自己的语言自然地分享给用户。）";
          enqueueSystemEvent(eventText, {
            sessionKey,
            contextKey: "insight:insight-target",
          });

          const result = await runHeartbeatOnce({
            cfg,
            agentId: "main",
            reason: "cognitive-insight",
            sessionKey,
            deps: {
              getReplyFromConfig: replySpy,
              telegram: sendTelegram,
              getQueueSize: () => 0,
              nowMs: () => Date.now(),
            } as never,
          });

          expect(result.status).toBe("ran");
          expect(sendTelegram).toHaveBeenCalled();

          const targetAfter = await insightStore.load("main", "operator", "insight-target");
          const decoyAfter = await insightStore.load("main", "operator", "insight-decoy");
          expect(targetAfter?.deliveryMessageId).toBe("m1");
          expect(decoyAfter?.deliveryMessageId).toBeUndefined();
        } finally {
          if (prevStateDir === undefined) {
            delete process.env.KAIJIBOT_STATE_DIR;
          } else {
            process.env.KAIJIBOT_STATE_DIR = prevStateDir;
          }
        }
      },
      { prefix: "kaijibot-insight-wb-", unsetEnvVars: ["TELEGRAM_BOT_TOKEN"] },
    );
  });

  it("fires onInsightDeliveryOutcome with delivered=false when agent returns empty reply", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      const cfg = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "30m" },
            model: { primary: "test/model" },
          },
        },
        channels: {
          telegram: { token: "test" },
        },
        session: { store: storePath },
      } as unknown as KaijiBotConfig;

      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        sessionId: "sid_outcome",
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "123456789",
      });

      enqueueSystemEvent(
        "[Cognitive Insight] 测试洞察内容\n（这是一条已生成的主动洞察，请用你自己的语言自然地分享给用户。）",
        { sessionKey, contextKey: "insight:insight-outcome-test" },
      );

      const outcomes: Array<{
        agentId: string;
        sessionKey: string;
        insightId: string;
        delivered: boolean;
      }> = [];
      const mockGetReply = vi.fn().mockResolvedValue({ text: "" });

      const result = await runHeartbeatOnce({
        cfg,
        reason: "cognitive-insight",
        sessionKey,
        deps: {
          getQueueSize: () => 0,
          nowMs: () => Date.now(),
          getReplyFromConfig: mockGetReply,
          onInsightDeliveryOutcome: async (params: {
            agentId: string;
            sessionKey: string;
            insightId: string;
            delivered: boolean;
          }) => {
            outcomes.push(params);
          },
        } as never,
      });

      expect(result.status).toBe("ran");
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]?.delivered).toBe(false);
      expect(outcomes[0]?.insightId).toBe("insight-outcome-test");
      expect(outcomes[0]?.agentId).toBe("main");
    });
  });

  it("fires onInsightDeliveryOutcome with delivered=true on successful delivery", async () => {
    await withTempHeartbeatSandbox(
      async ({ tmpDir, storePath, replySpy }) => {
        const prevStateDir = process.env.KAIJIBOT_STATE_DIR;
        process.env.KAIJIBOT_STATE_DIR = tmpDir;
        try {
          const cfg = {
            agents: {
              defaults: {
                workspace: tmpDir,
                heartbeat: { every: "30m" },
                model: { primary: "test/model" },
              },
            },
            channels: { telegram: { allowFrom: ["*"] } },
            session: { store: storePath },
          } as unknown as KaijiBotConfig;

          const sessionKey = await seedMainSessionStore(storePath, cfg, {
            sessionId: "sid_outcome_ok",
            lastChannel: "telegram",
            lastProvider: "telegram",
            lastTo: "-100155462274",
          });

          enqueueSystemEvent(
            "[Cognitive Insight] 成功投递的洞察\n（这是一条已生成的主动洞察，请用你自己的语言自然地分享给用户。）",
            { sessionKey, contextKey: "insight:insight-ok-test" },
          );

          const outcomes: Array<{ insightId: string; delivered: boolean }> = [];
          const sendTelegram = vi
            .fn()
            .mockResolvedValue({ messageId: "m-ok", chatId: "-100155462274" });
          replySpy.mockResolvedValue({ text: "这是洞察内容，分享给你。" });

          const result = await runHeartbeatOnce({
            cfg,
            agentId: "main",
            reason: "cognitive-insight",
            sessionKey,
            deps: {
              getReplyFromConfig: replySpy,
              telegram: sendTelegram,
              getQueueSize: () => 0,
              nowMs: () => Date.now(),
              onInsightDeliveryOutcome: async (params: {
                agentId: string;
                sessionKey: string;
                insightId: string;
                delivered: boolean;
              }) => {
                outcomes.push(params);
              },
            } as never,
          });

          expect(result.status).toBe("ran");
          expect(sendTelegram).toHaveBeenCalled();
          expect(outcomes).toHaveLength(1);
          expect(outcomes[0]?.delivered).toBe(true);
          expect(outcomes[0]?.insightId).toBe("insight-ok-test");
        } finally {
          if (prevStateDir === undefined) {
            delete process.env.KAIJIBOT_STATE_DIR;
          } else {
            process.env.KAIJIBOT_STATE_DIR = prevStateDir;
          }
        }
      },
      { prefix: "kaijibot-insight-ok-", unsetEnvVars: ["TELEGRAM_BOT_TOKEN"] },
    );
  });

  it("does not fire onInsightDeliveryOutcome when no insight event is present", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      const cfg = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "30m" },
            model: { primary: "test/model" },
          },
        },
        channels: {
          telegram: { token: "test" },
        },
        session: { store: storePath },
      } as unknown as KaijiBotConfig;

      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        sessionId: "sid_no_insight",
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "123456789",
      });

      // No system event enqueued — no insight event
      const outcomes: Array<{ insightId: string; delivered: boolean }> = [];
      const mockGetReply = vi.fn().mockResolvedValue({ text: "" });

      const result = await runHeartbeatOnce({
        cfg,
        reason: "cognitive-insight",
        sessionKey,
        deps: {
          getQueueSize: () => 0,
          nowMs: () => Date.now(),
          getReplyFromConfig: mockGetReply,
          onInsightDeliveryOutcome: async (params: {
            agentId: string;
            sessionKey: string;
            insightId: string;
            delivered: boolean;
          }) => {
            outcomes.push(params);
          },
        } as never,
      });

      expect(result.status).toBe("ran");
      expect(outcomes).toHaveLength(0);
    });
  });

  it("reports delivered=true (not false) for an already-delivered insight on a redundant empty wake", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
      const prevStateDir = process.env.KAIJIBOT_STATE_DIR;
      process.env.KAIJIBOT_STATE_DIR = tmpDir;
      try {
        const cfg = {
          agents: {
            defaults: {
              workspace: tmpDir,
              heartbeat: { every: "30m" },
              model: { primary: "test/model" },
            },
          },
          channels: {
            telegram: { token: "test" },
          },
          session: { store: storePath },
        } as unknown as KaijiBotConfig;

        const sessionKey = await seedMainSessionStore(storePath, cfg, {
          sessionId: "sid_armed",
          lastChannel: "telegram",
          lastProvider: "telegram",
          lastTo: "123456789",
        });

        // Seed the insight record as ALREADY delivered (deliveryMessageId set),
        // simulating a prior heartbeat run that successfully sent it.
        const insightStore = new InsightStore(tmpDir);
        await insightStore.save("main", "operator", {
          id: "insight-armed-test",
          generatedAt: Date.now() - 300_000,
          triggerSource: "scheduled",
          targetDomains: ["软件开发"],
          sourceDomains: [],
          content: "已经投递过的洞察",
          rationale: "test",
          sources: [],
          deliveredAt: Date.now() - 200_000,
          deliveryMessageId: "already-sent-msg",
        });

        enqueueSystemEvent(
          "[Cognitive Insight] 已经投递过的洞察\n（这是一条已生成的主动洞察，请用你自己的语言自然地分享给用户。）",
          { sessionKey, contextKey: "insight:insight-armed-test" },
        );

        const outcomes: Array<{ insightId: string; delivered: boolean }> = [];
        const mockGetReply = vi.fn().mockResolvedValue({ text: "" });

        const result = await runHeartbeatOnce({
          cfg,
          agentId: "main",
          reason: "cognitive-insight",
          sessionKey,
          deps: {
            getQueueSize: () => 0,
            nowMs: () => Date.now(),
            getReplyFromConfig: mockGetReply,
            onInsightDeliveryOutcome: async (params: {
              agentId: string;
              sessionKey: string;
              insightId: string;
              delivered: boolean;
            }) => {
              outcomes.push(params);
            },
          } as never,
        });

        expect(result.status).toBe("ran");
        expect(outcomes).toHaveLength(1);
        // Critical: an already-delivered insight must report true, NOT false.
        // Reporting false here re-arms pendingInsightDelivery and causes the
        // scheduler to redeliver an insight the user already received.
        expect(outcomes[0]?.delivered).toBe(true);
        expect(outcomes[0]?.insightId).toBe("insight-armed-test");
      } finally {
        if (prevStateDir === undefined) {
          delete process.env.KAIJIBOT_STATE_DIR;
        } else {
          process.env.KAIJIBOT_STATE_DIR = prevStateDir;
        }
      }
    });
  });
});
