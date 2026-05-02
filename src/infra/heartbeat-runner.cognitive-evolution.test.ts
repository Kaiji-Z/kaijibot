import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { heartbeatRunnerTelegramPlugin } from "../../test/helpers/infra/heartbeat-runner-channel-plugins.js";
import type { KaijiBotConfig } from "../config/config.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";
import { buildEvolutionEventPrompt } from "./heartbeat-events-filter.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import {
  seedMainSessionStore,
  withTempHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";
import {
  enqueueSystemEvent,
  peekSystemEventEntries,
  resetSystemEventsForTest,
} from "./system-events.js";

beforeEach(() => {
  setActivePluginRegistry(
    createTestRegistry([
      { pluginId: "telegram", plugin: heartbeatRunnerTelegramPlugin, source: "test" },
    ]),
  );
  resetSystemEventsForTest();
});

afterEach(() => {
  resetSystemEventsForTest();
  vi.restoreAllMocks();
});

describe("cognitive-evolution system event delivery through isolated heartbeat session", () => {
  const EVOLUTION_SIGNAL_TEXT =
    "[Evolution Signal] Tool sequence: wiki_search → doc_create → task_create (3 calls, 4.2s). Evaluate whether this recurring pattern warrants a new skill.";

  const createConfig = async (
    tmpDir: string,
    storePath: string,
  ): Promise<{ cfg: KaijiBotConfig; sessionKey: string }> => {
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
      channels: { telegram: { allowFrom: ["*"] } },
      session: { store: storePath },
    };
    const sessionKey = await seedMainSessionStore(storePath, cfg, {
      lastChannel: "telegram",
      lastProvider: "telegram",
      lastTo: "-100155462274",
    });
    return { cfg, sessionKey };
  };

  it("runs agent turn with isolated :heartbeat session key for cognitive-evolution reason", async () => {
    await withTempHeartbeatSandbox(
      async ({ tmpDir, storePath, replySpy }) => {
        const { cfg, sessionKey } = await createConfig(tmpDir, storePath);
        const sendTelegram = vi.fn().mockResolvedValue({
          messageId: "m1",
          chatId: "-100155462274",
        });
        replySpy.mockResolvedValue({
          text: "我看到这个任务涉及多次工具调用，我来自主判断是否值得进化为技能。",
        });
        enqueueSystemEvent(EVOLUTION_SIGNAL_TEXT, { sessionKey });

        const result = await runHeartbeatOnce({
          cfg,
          agentId: "main",
          reason: "cognitive-evolution",
          deps: {
            getReplyFromConfig: replySpy,
            telegram: sendTelegram,
            getQueueSize: () => 0,
            nowMs: () => Date.now(),
          },
        });

        expect(result.status).toBe("ran");
        expect(replySpy).toHaveBeenCalledTimes(1);
        const calledSessionKey = replySpy.mock.calls[0]?.[0]?.SessionKey as string | undefined;
        expect(calledSessionKey).toBeTruthy();
        expect(calledSessionKey).toContain(":heartbeat");
        expect(sendTelegram).toHaveBeenCalled();
      },
      { prefix: "kaijibot-evo-1-", unsetEnvVars: ["TELEGRAM_BOT_TOKEN"] },
    );
  });

  it("consumes base session events after re-enqueue to isolated session", async () => {
    await withTempHeartbeatSandbox(
      async ({ tmpDir, storePath, replySpy }) => {
        const { cfg, sessionKey } = await createConfig(tmpDir, storePath);
        const sendTelegram = vi.fn().mockResolvedValue({
          messageId: "m1",
          chatId: "-100155462274",
        });
        replySpy.mockResolvedValue({
          text: "我看到这个任务涉及多次工具调用，我来自主判断是否值得进化为技能。",
        });
        enqueueSystemEvent(EVOLUTION_SIGNAL_TEXT, { sessionKey });

        const result = await runHeartbeatOnce({
          cfg,
          agentId: "main",
          reason: "cognitive-evolution",
          deps: {
            getReplyFromConfig: replySpy,
            telegram: sendTelegram,
            getQueueSize: () => 0,
            nowMs: () => Date.now(),
          },
        });

        expect(result.status).toBe("ran");
        expect(peekSystemEventEntries(sessionKey)).toHaveLength(0);
      },
      { prefix: "kaijibot-evo-2-", unsetEnvVars: ["TELEGRAM_BOT_TOKEN"] },
    );
  });

  it("re-enqueues multiple events from base to isolated session", async () => {
    await withTempHeartbeatSandbox(
      async ({ tmpDir, storePath, replySpy }) => {
        const { cfg, sessionKey } = await createConfig(tmpDir, storePath);
        const sendTelegram = vi.fn().mockResolvedValue({
          messageId: "m1",
          chatId: "-100155462274",
        });
        replySpy.mockResolvedValue({
          text: "我看到这个任务涉及多次工具调用，我来自主判断是否值得进化为技能。",
        });
        const signal1 =
          "[Evolution Signal] Tool sequence: base_query → base_update → sheets_write (3 calls).";
        const signal2 =
          "[Evolution Signal] Tool sequence: web_fetch → doc_create → wiki_move (3 calls, 6.1s).";
        enqueueSystemEvent(signal1, { sessionKey });
        enqueueSystemEvent(signal2, { sessionKey });

        const result = await runHeartbeatOnce({
          cfg,
          agentId: "main",
          reason: "cognitive-evolution",
          deps: {
            getReplyFromConfig: replySpy,
            telegram: sendTelegram,
            getQueueSize: () => 0,
            nowMs: () => Date.now(),
          },
        });

        expect(result.status).toBe("ran");
        expect(peekSystemEventEntries(sessionKey)).toHaveLength(0);
        expect(replySpy).toHaveBeenCalledTimes(1);
      },
      { prefix: "kaijibot-evo-3-", unsetEnvVars: ["TELEGRAM_BOT_TOKEN"] },
    );
  });

  it("uses evolution-specific prompt instead of heartbeat prompt", async () => {
    await withTempHeartbeatSandbox(
      async ({ tmpDir, storePath, replySpy }) => {
        const { cfg, sessionKey } = await createConfig(tmpDir, storePath);
        const sendTelegram = vi.fn().mockResolvedValue({
          messageId: "m1",
          chatId: "-100155462274",
        });
        replySpy.mockResolvedValue({
          text: "这个模式值得做成技能，我来生成草稿。",
        });
        enqueueSystemEvent(EVOLUTION_SIGNAL_TEXT, { sessionKey });

        const result = await runHeartbeatOnce({
          cfg,
          agentId: "main",
          reason: "cognitive-evolution",
          deps: {
            getReplyFromConfig: replySpy,
            telegram: sendTelegram,
            getQueueSize: () => 0,
            nowMs: () => Date.now(),
          },
        });

        expect(result.status).toBe("ran");
        const calledBody = replySpy.mock.calls[0]?.[0]?.Body as string | undefined;
        expect(calledBody).toBeTruthy();
        const expectedPrompt = buildEvolutionEventPrompt({ deliverToUser: true });
        expect(calledBody).toContain(expectedPrompt.split("\n")[0]);
        expect(calledBody).not.toContain("HEARTBEAT_OK");
        expect(calledBody).not.toContain("Read HEARTBEAT.md");
      },
      { prefix: "kaijibot-evo-4-", unsetEnvVars: ["TELEGRAM_BOT_TOKEN"] },
    );
  });

  it("does not skip response even if agent replies with HEARTBEAT_OK", async () => {
    await withTempHeartbeatSandbox(
      async ({ tmpDir, storePath, replySpy }) => {
        const { cfg, sessionKey } = await createConfig(tmpDir, storePath);
        const sendTelegram = vi.fn().mockResolvedValue({
          messageId: "m1",
          chatId: "-100155462274",
        });
        // Agent replies HEARTBEAT_OK — evolution signal prevents skip
        replySpy.mockResolvedValue({
          text: "HEARTBEAT_OK",
        });
        enqueueSystemEvent(EVOLUTION_SIGNAL_TEXT, { sessionKey });

        const result = await runHeartbeatOnce({
          cfg,
          agentId: "main",
          reason: "cognitive-evolution",
          deps: {
            getReplyFromConfig: replySpy,
            telegram: sendTelegram,
            getQueueSize: () => 0,
            nowMs: () => Date.now(),
          },
        });

        expect(result.status).toBe("ran");
        expect(peekSystemEventEntries(sessionKey)).toHaveLength(0);
      },
      { prefix: "kaijibot-evo-5-", unsetEnvVars: ["TELEGRAM_BOT_TOKEN"] },
    );
  });
});
