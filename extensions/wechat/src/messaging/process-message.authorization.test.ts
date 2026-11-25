import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandAuthorizationRuntime } from "kaijibot/plugin-sdk/command-auth";
import type { PluginRuntime } from "kaijibot/plugin-sdk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WeixinMessage } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { processOneMessage } from "./process-message.js";

const ACCOUNT = "acct-main";
const OWNER = "owner@im.wechat";
const FRIEND = "friend@im.wechat";

let previousStateDir: string | undefined;
let stateDir = "";

beforeEach(() => {
  previousStateDir = process.env.KAIJIBOT_STATE_DIR;
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-dm-"));
  process.env.KAIJIBOT_STATE_DIR = stateDir;
});

afterEach(() => {
  if (previousStateDir === undefined) {
    delete process.env.KAIJIBOT_STATE_DIR;
  } else {
    process.env.KAIJIBOT_STATE_DIR = previousStateDir;
  }
  fs.rmSync(stateDir, { recursive: true, force: true });
});

/** What the gateway would have stored when OWNER scanned the QR code at login. */
function recordOwner() {
  const dir = path.join(stateDir, "wechat", "accounts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${ACCOUNT}.json`),
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
async function runThroughGate(params: { from: string; allowFrom?: string[] }) {
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
    accountId: ACCOUNT,
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
});
