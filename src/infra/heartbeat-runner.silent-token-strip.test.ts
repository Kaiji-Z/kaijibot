import { describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { runHeartbeatOnce, type HeartbeatDeps } from "./heartbeat-runner.js";
import { installHeartbeatRunnerTestRuntime } from "./heartbeat-runner.test-harness.js";
import {
  type HeartbeatReplySpy,
  seedMainSessionStore,
  withTempHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";

installHeartbeatRunnerTestRuntime();

const TELEGRAM_GROUP = "-1001234567890";

async function runTelegramRelay(params: {
  tmpDir: string;
  storePath: string;
  replySpy: HeartbeatReplySpy;
  replyText: string;
}) {
  const cfg = {
    agents: {
      defaults: {
        workspace: params.tmpDir,
        heartbeat: { every: "5m", target: "telegram" },
      },
    },
    channels: {
      telegram: {
        token: "test-token",
        allowFrom: ["*"],
        heartbeat: { showOk: false },
      },
    },
    session: { store: params.storePath },
  } as unknown as KaijiBotConfig;

  await seedMainSessionStore(params.storePath, cfg, {
    lastChannel: "telegram",
    lastProvider: "telegram",
    lastTo: TELEGRAM_GROUP,
  });

  params.replySpy.mockResolvedValue({ text: params.replyText });
  const sendTelegram = vi.fn().mockResolvedValue({ messageId: "m1", toJid: "jid" });

  await runHeartbeatOnce({
    cfg,
    deps: {
      telegram: sendTelegram as unknown,
      getQueueSize: () => 0,
      nowMs: () => 0,
      getReplyFromConfig: params.replySpy,
    } as HeartbeatDeps,
  });
  return sendTelegram;
}

describe("heartbeat relay glued NO_REPLY handling", () => {
  it("delivers visible text without the glued NO_REPLY token", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendTelegram = await runTelegramRelay({
        tmpDir,
        storePath,
        replySpy,
        replyText: "NO_REPLY晚上好——今天第二条了，接着说。",
      });

      expect(sendTelegram).toHaveBeenCalledTimes(1);
      expect(sendTelegram.mock.calls[0]?.[1]).toBe("晚上好——今天第二条了，接着说。");
    });
  });

  it("keeps a punctuation-separated NO_REPLY visible", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendTelegram = await runTelegramRelay({
        tmpDir,
        storePath,
        replySpy,
        replyText: "NO_REPLY: 这条是补充说明",
      });

      expect(sendTelegram).toHaveBeenCalledTimes(1);
      expect(sendTelegram.mock.calls[0]?.[1]).toBe("NO_REPLY: 这条是补充说明");
    });
  });

  it("stays silent for an exact NO_REPLY", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendTelegram = await runTelegramRelay({
        tmpDir,
        storePath,
        replySpy,
        replyText: "NO_REPLY",
      });

      expect(sendTelegram).not.toHaveBeenCalled();
    });
  });
});
