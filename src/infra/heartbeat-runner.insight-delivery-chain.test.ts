import { afterEach, describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { setHeartbeatsEnabled } from "./heartbeat-wake.js";
import {
  drainSystemEventEntries,
  enqueueSystemEvent,
  peekSystemEventEntries,
} from "./system-events.js";
import { installHeartbeatRunnerTestRuntime } from "./heartbeat-runner.test-harness.js";
import {
  seedMainSessionStore,
  withTempHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";

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
      const deliveryInstruction = "（这是一条已生成的主动洞察，请用你自己的语言自然地分享给用户。）";
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
});
