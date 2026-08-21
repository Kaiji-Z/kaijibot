import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { getActivePluginRegistry, setActivePluginRegistry } from "../plugins/runtime.js";
import { createOutboundTestPlugin, createTestRegistry } from "../test-utils/channel-plugins.js";
import { type HeartbeatDeps, runHeartbeatOnce } from "./heartbeat-runner.js";
import { onHeartbeatEvent } from "./heartbeat-events.js";
import { seedMainSessionStore, withTempHeartbeatSandbox } from "./heartbeat-runner.test-utils.js";
import { enqueueSystemEvent, resetSystemEventsForTest } from "./system-events.js";

vi.mock("jiti", () => ({ createJiti: () => () => ({}) }));

let previousRegistry: ReturnType<typeof getActivePluginRegistry> | null = null;

const INSIGHT_CONTENT =
  "周报缺「身体回应」数据：建议每月末加体重、腰围、静息心率三行。周日可加膝触墙测试。";

function incidentStyleDegenerateText(repeat: number): string {
  const chunk = [
    "The insight: clean, short, warm, my reply now:",
    "My reply's the plan: apologize + relay. My reply:",
    "Here's the plan: apologize + apology + relay, once:",
    "The final message is the clean relay. Outputting it now, once, and ending the generation:",
  ].join("\n");
  return Array.from({ length: repeat }, () => chunk).join("\n");
}

describe("heartbeat degeneration guard (insight relay)", () => {
  let sentTexts: string[];

  beforeAll(() => {
    previousRegistry = getActivePluginRegistry();
    const captureOutbound = {
      deliveryMode: "direct" as const,
      sendText: async (params: { text: string }) => {
        sentTexts.push(params.text);
        return { channel: "telegram" as const, messageId: "1", chatId: "1" };
      },
      sendMedia: async () => ({ channel: "telegram" as const, messageId: "1", chatId: "1" }),
    };
    const telegramPlugin = createOutboundTestPlugin({ id: "telegram", outbound: captureOutbound });
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "telegram", plugin: telegramPlugin, source: "test" }]),
    );
  });

  afterAll(() => {
    if (previousRegistry) {
      setActivePluginRegistry(previousRegistry);
    }
  });

  beforeEach(() => {
    resetSystemEventsForTest();
    sentTexts = [];
  });

  it("replaces a degenerate insight relay with the stored insight text", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "5m", target: "telegram" },
            model: { primary: "test/model" },
          },
        },
        channels: {
          telegram: {
            token: "fake",
            allowFrom: ["*"],
            heartbeat: { showOk: false },
          },
        },
        session: { store: storePath },
      } as unknown as KaijiBotConfig;

      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "123",
      });

      enqueueSystemEvent(`[Cognitive Insight] ${INSIGHT_CONTENT}`, {
        sessionKey,
        contextKey: "insight:guard-test-1",
      });

      replySpy.mockResolvedValue({ text: incidentStyleDegenerateText(30) });

      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = onHeartbeatEvent((evt) => {
        if (evt.status === "sent") {
          events.push(evt as unknown as Record<string, unknown>);
        }
      });

      try {
        const result = await runHeartbeatOnce({
          cfg,
          reason: "exec-event",
          deps: {
            getQueueSize: () => 0,
            nowMs: () => Date.now(),
            getReplyFromConfig: replySpy,
          } as HeartbeatDeps,
        });
        expect(result.status).toBe("ran");
      } finally {
        unsubscribe();
      }

      expect(sentTexts.length).toBeGreaterThan(0);
      const delivered = sentTexts.join("\n");
      expect(delivered).toContain(INSIGHT_CONTENT);
      expect(delivered).toContain("已自动拦截");
      expect(delivered).not.toContain("My reply now");

      const sent = events[0];
      expect(sent?.degenerateBlocked).toBe("repetition");
      expect(typeof sent?.blockedReplyChars).toBe("number");
      expect((sent?.blockedReplyChars as number) ?? 0).toBeGreaterThan(6_000);
    });
  });

  it("delivers a normal relay reply untouched", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "5m", target: "telegram" },
            model: { primary: "test/model" },
          },
        },
        channels: {
          telegram: {
            token: "fake",
            allowFrom: ["*"],
            heartbeat: { showOk: false },
          },
        },
        session: { store: storePath },
      } as unknown as KaijiBotConfig;

      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "123",
      });

      enqueueSystemEvent(`[Cognitive Insight] ${INSIGHT_CONTENT}`, {
        sessionKey,
        contextKey: "insight:guard-test-2",
      });

      replySpy.mockResolvedValue({ text: `给你转述一条洞察：${INSIGHT_CONTENT}` });

      await runHeartbeatOnce({
        cfg,
        reason: "exec-event",
        deps: {
          getQueueSize: () => 0,
          nowMs: () => Date.now(),
          getReplyFromConfig: replySpy,
        } as HeartbeatDeps,
      });

      expect(sentTexts.length).toBeGreaterThan(0);
      expect(sentTexts.join("\n")).toContain("给你转述一条洞察");
      expect(sentTexts.join("\n")).not.toContain("已自动拦截");
    });
  });
});
