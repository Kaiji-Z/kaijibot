import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelId, ChannelOutboundAdapter, ChannelPlugin } from "../channels/plugins/types.js";
import type { KaijiBotConfig } from "../config/config.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createOutboundTestPlugin, createTestRegistry } from "../test-utils/channel-plugins.js";
import { resolveOutboundSendDep, type OutboundSendDeps } from "./outbound/send-deps.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import {
  seedMainSessionStore,
  withTempHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";
import { enqueueSystemEvent, resetSystemEventsForTest } from "./system-events.js";

const appendTranscriptMock = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, sessionFile: "x" })),
);

vi.mock("../config/sessions/transcript.runtime.js", () => ({
  appendAssistantMessageToSessionTranscript: appendTranscriptMock,
}));

type HeartbeatSendFn = (
  to: string,
  text: string,
  opts?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

function createHeartbeatFeishuOutboundAdapter(): ChannelOutboundAdapter {
  return {
    deliveryMode: "direct",
    sendText: async ({ to, text, deps, cfg, accountId, replyToId, threadId, ...opts }) => {
      const send = resolveOutboundSendDep<HeartbeatSendFn>(deps as OutboundSendDeps, "feishu");
      if (!send) {
        throw new Error("Missing feishu outbound send dependency");
      }
      return (await send(to, text, { verbose: false, cfg, accountId, ...opts })) as never;
    },
  };
}

function createHeartbeatFeishuPlugin(): ChannelPlugin {
  return createOutboundTestPlugin({
    id: "feishu" as ChannelId,
    label: "Feishu",
    docsPath: "/channels/feishu",
    outbound: createHeartbeatFeishuOutboundAdapter(),
  });
}

function setupFeishuHeartbeatPluginRuntimeForTests() {
  setActivePluginRegistry(
    createTestRegistry([
      { pluginId: "feishu", plugin: createHeartbeatFeishuPlugin(), source: "test" },
    ]),
  );
}

beforeEach(() => {
  setupFeishuHeartbeatPluginRuntimeForTests();
  resetSystemEventsForTest();
  appendTranscriptMock.mockClear();
});

afterEach(() => {
  resetSystemEventsForTest();
  vi.restoreAllMocks();
});

describe("Cognitive insight delivery through heartbeat runner", () => {
  it("delivers cognitive-insight system event to feishu channel via heartbeat", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg: KaijiBotConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: {
              every: "5m",
              target: "last",
            },
          },
        },
        channels: { feishu: { appId: "test-app", appSecret: "test-secret" } },
        session: { store: storePath },
      };

      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        lastChannel: "feishu",
        lastProvider: "zai",
        lastTo: "ou_test123",
      });

      const sendFeishu = vi.fn().mockResolvedValue({
        messageId: "m1",
        chatId: "ou_test123",
      });
      replySpy.mockResolvedValue({ text: "Cross-domain insight: AI safety intersects with your interest in architecture patterns" });

      enqueueSystemEvent("Cognitive insight ready", {
        sessionKey,
        contextKey: "cognitive-insight",
        deliveryContext: {
          channel: "feishu",
          to: "ou_test123",
        },
      });

      const result = await runHeartbeatOnce({
        cfg,
        agentId: "main",
        reason: "cognitive-insight",
        deps: {
          getReplyFromConfig: replySpy,
          feishu: sendFeishu,
        },
      });

      expect(result.status).toBe("ran");
      expect(sendFeishu).toHaveBeenCalledTimes(1);
      expect(sendFeishu).toHaveBeenCalledWith(
        "ou_test123",
        "Cross-domain insight: AI safety intersects with your interest in architecture patterns",
        expect.anything(),
      );
    });
  });

  it("defaults to last channel when heartbeat.target is not configured", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg: KaijiBotConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: {
              every: "5m",
            },
          },
        },
        channels: { feishu: { appId: "test-app", appSecret: "test-secret" } },
        session: { store: storePath },
      };

      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        lastChannel: "feishu",
        lastProvider: "zai",
        lastTo: "ou_test123",
      });

      const sendFeishu = vi.fn().mockResolvedValue({
        messageId: "m2",
        chatId: "ou_test123",
      });
      replySpy.mockResolvedValue({ text: "Proactive insight delivered via default target" });

      enqueueSystemEvent("Insight about your interest in distributed systems", {
        sessionKey,
        contextKey: "cognitive-insight",
        deliveryContext: {
          channel: "feishu",
          to: "ou_test123",
        },
      });

      const result = await runHeartbeatOnce({
        cfg,
        agentId: "main",
        reason: "cognitive-insight",
        deps: {
          getReplyFromConfig: replySpy,
          feishu: sendFeishu,
        },
      });

      expect(result.status).toBe("ran");
      expect(sendFeishu).toHaveBeenCalledTimes(1);
      expect(sendFeishu).toHaveBeenCalledWith(
        "ou_test123",
        "Proactive insight delivered via default target",
        expect.anything(),
      );
    });
  });

  it("does not deliver when session has no lastChannel", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg: KaijiBotConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: {
              every: "5m",
            },
          },
        },
        channels: { feishu: { appId: "test-app", appSecret: "test-secret" } },
        session: { store: storePath },
      };

      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        lastChannel: "",
        lastProvider: "",
        lastTo: "",
      });

      const sendFeishu = vi.fn().mockResolvedValue({
        messageId: "m3",
        chatId: "ou_test123",
      });
      replySpy.mockResolvedValue({ text: "Should not be delivered" });

      enqueueSystemEvent("Orphaned insight", {
        sessionKey,
        contextKey: "cognitive-insight",
      });

      const result = await runHeartbeatOnce({
        cfg,
        agentId: "main",
        reason: "cognitive-insight",
        deps: {
          getReplyFromConfig: replySpy,
          feishu: sendFeishu,
        },
      });

      expect(result.status).toBe("ran");
      expect(sendFeishu).not.toHaveBeenCalled();
    });
  });

  it("writes mirror transcript when delivering cognitive insight to feishu", async () => {
      await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
        const cfg: KaijiBotConfig = {
          agents: {
            defaults: {
              workspace: tmpDir,
              heartbeat: {
                every: "5m",
                target: "last",
              },
            },
          },
          channels: { feishu: { appId: "test-app", appSecret: "test-secret" } },
          session: { store: storePath },
        };

        const sessionKey = await seedMainSessionStore(storePath, cfg, {
          lastChannel: "feishu",
          lastProvider: "zai",
          lastTo: "ou_mirror_test",
        });

        const sendFeishu = vi.fn().mockResolvedValue({
          messageId: "m-mirror",
          chatId: "ou_mirror_test",
        });
        replySpy.mockResolvedValue({ text: "Mirror test insight content" });

        enqueueSystemEvent("Cognitive insight for mirror test", {
          sessionKey,
          contextKey: "cognitive-insight",
          deliveryContext: {
            channel: "feishu",
            to: "ou_mirror_test",
          },
        });

        const result = await runHeartbeatOnce({
          cfg,
          agentId: "main",
          reason: "cognitive-insight",
          deps: {
            getReplyFromConfig: replySpy,
            feishu: sendFeishu,
          },
        });

        expect(result.status).toBe("ran");
        expect(sendFeishu).toHaveBeenCalledTimes(1);
        expect(appendTranscriptMock).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionKey,
            agentId: "main",
            text: expect.stringContaining("Mirror test insight content"),
          }),
        );
      });
    });
  });
