import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandAuthorizationRuntime } from "kaijibot/plugin-sdk/command-auth";
import type { PluginRuntime } from "kaijibot/plugin-sdk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WeixinMessage } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { logger } from "../util/logger.js";
import { processOneMessage } from "./process-message.js";

const ACCOUNT = "acct-main";
const OWNER = "owner@im.wechat";
const FRIEND = "friend@im.wechat";

let previousStateDir: string | undefined;
let stateDir = "";
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  previousStateDir = process.env.KAIJIBOT_STATE_DIR;
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-dm-"));
  process.env.KAIJIBOT_STATE_DIR = stateDir;
  // Keep test runs out of the real wechat log file and make the refusal notice observable.
  warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  vi.spyOn(logger, "info").mockImplementation(() => {});
  vi.spyOn(logger, "debug").mockImplementation(() => {});
  vi.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousStateDir === undefined) {
    delete process.env.KAIJIBOT_STATE_DIR;
  } else {
    process.env.KAIJIBOT_STATE_DIR = previousStateDir;
  }
  fs.rmSync(stateDir, { recursive: true, force: true });
});

/** What the gateway would have stored when OWNER scanned the QR code at login. */
function recordOwner(accountId = ACCOUNT) {
  const dir = path.join(stateDir, "wechat", "accounts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${accountId}.json`),
    JSON.stringify({ token: "t", userId: OWNER }),
  );
}

function textMessage(from: string): WeixinMessage {
  return {
    from_user_id: from,
    message_id: "m1",
    item_list: [{ type: MessageItemType.TEXT, text_item: { text: "hello" } }],
  } as unknown as WeixinMessage;
}

/**
 * Runs processOneMessage up to the routing call that follows the DM gate. A sender that passes
 * the gate reaches resolveAgentRoute, which stops the run with STOP.
 */
async function runThroughGate(params: { from: string; allowFrom?: string[]; accountId?: string }) {
  const resolveAgentRoute = vi.fn(() => {
    throw new Error("STOP");
  });
  const commands: CommandAuthorizationRuntime = {
    shouldComputeCommandAuthorized: () => false,
    resolveCommandAuthorizedFromAuthorizers: () => false,
  };
  const channelRuntime = {
    commands,
    routing: { resolveAgentRoute },
  } as unknown as PluginRuntime["channel"];
  const run = processOneMessage(textMessage(params.from), {
    accountId: params.accountId ?? ACCOUNT,
    allowFrom: params.allowFrom,
    config: {},
    channelRuntime,
    baseUrl: "https://example.invalid",
    cdnBaseUrl: "https://example.invalid",
    log: () => {},
    errLog: () => {},
  });
  return { resolveAgentRoute, run };
}

describe("processOneMessage DM gate", () => {
  it("lets the owner recorded at login through to routing", async () => {
    recordOwner();
    const { resolveAgentRoute, run } = await runThroughGate({ from: OWNER });
    await expect(run).rejects.toThrow("STOP");
    expect(resolveAgentRoute).toHaveBeenCalledTimes(1);
  });

  it("drops a sender who is neither the owner nor configured", async () => {
    recordOwner();
    const { resolveAgentRoute, run } = await runThroughGate({ from: FRIEND });
    await expect(run).resolves.toBeUndefined();
    expect(resolveAgentRoute).not.toHaveBeenCalled();
  });

  it("passes deps.allowFrom to the gate as extra trusted senders", async () => {
    recordOwner();
    const { resolveAgentRoute, run } = await runThroughGate({ from: FRIEND, allowFrom: [FRIEND] });
    await expect(run).rejects.toThrow("STOP");
    expect(resolveAgentRoute).toHaveBeenCalledTimes(1);
  });

  it("drops every sender while no trusted sender is on record", async () => {
    for (const from of [OWNER, FRIEND, ""]) {
      const { resolveAgentRoute, run } = await runThroughGate({ from, accountId: "acct-nobody" });
      await expect(run).resolves.toBeUndefined();
      expect(resolveAgentRoute, `sender "${from}" must not reach routing`).not.toHaveBeenCalled();
    }
  });

  it("still admits a configured sender while no owner is on record", async () => {
    const { resolveAgentRoute, run } = await runThroughGate({
      from: FRIEND,
      allowFrom: [FRIEND],
      accountId: "acct-configured",
    });
    await expect(run).rejects.toThrow("STOP");
    expect(resolveAgentRoute).toHaveBeenCalledTimes(1);
  });

  // The missing-owner notice is said once per account for the lifetime of the process, so each
  // of these uses its own account id.
  it("explains a refusal caused by a missing owner once per account", async () => {
    for (let i = 0; i < 3; i += 1) {
      const { run } = await runThroughGate({ from: OWNER, accountId: "acct-notice-once" });
      await expect(run).resolves.toBeUndefined();
    }
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("kaijibot channels login --channel wechat");
    expect(message).toContain("channels.wechat.allowFrom");
  });

  it("stops explaining once an owner is on record", async () => {
    const accountId = "acct-notice-then-owner";
    const first = await runThroughGate({ from: OWNER, accountId });
    await expect(first.run).resolves.toBeUndefined();
    recordOwner(accountId);
    const { resolveAgentRoute, run } = await runThroughGate({
      from: "stranger@im.wechat",
      accountId,
    });
    await expect(run).resolves.toBeUndefined();
    expect(resolveAgentRoute).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
