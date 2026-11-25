import type { CommandAuthorizationRuntime } from "kaijibot/plugin-sdk/command-auth";
import type { KaijiBotConfig } from "kaijibot/plugin-sdk/core";
import { describe, expect, it, vi } from "vitest";
import {
  createWeixinDmRefusalLog,
  formatWeixinNoTrustedSenderHint,
  resolveWeixinDmAccess,
  type WeixinDmAccessSources,
} from "./dm-authorization.js";

const ACCOUNT = "acct-main";
const OWNER = "owner@im.wechat";

function sources(overrides: Partial<WeixinDmAccessSources> = {}): WeixinDmAccessSources {
  return {
    readStoreAllowFrom: () => [],
    loadOwnerUserId: () => undefined,
    ...overrides,
  };
}

function decide(params: {
  senderId: string;
  configuredAllowFrom?: string[];
  sources?: WeixinDmAccessSources;
  runtime?: CommandAuthorizationRuntime;
}) {
  return resolveWeixinDmAccess({
    cfg: {} as KaijiBotConfig,
    rawBody: "hello",
    senderId: params.senderId,
    configuredAllowFrom: params.configuredAllowFrom ?? [],
    accountId: ACCOUNT,
    runtime: params.runtime ?? {
      shouldComputeCommandAuthorized: () => false,
      resolveCommandAuthorizedFromAuthorizers: () => false,
    },
    sources: params.sources ?? sources(),
  });
}

describe("resolveWeixinDmAccess", () => {
  it("refuses everyone while no trusted sender is on record", async () => {
    for (const senderId of [OWNER, "stranger@im.wechat", ""]) {
      const access = await decide({ senderId });
      expect(access, `sender "${senderId}"`).toEqual({
        outcome: "unauthorized",
        reason: "no-trusted-sender",
      });
    }
  });

  it("keeps refusing everyone when the pairing store cannot be read", async () => {
    const access = await decide({
      senderId: OWNER,
      sources: sources({
        readStoreAllowFrom: () => {
          throw new Error("corrupt store");
        },
      }),
    });
    expect(access).toEqual({ outcome: "unauthorized", reason: "no-trusted-sender" });
  });

  it("allows the owner recorded at login", async () => {
    const access = await decide({
      senderId: OWNER,
      sources: sources({ loadOwnerUserId: () => OWNER }),
    });
    expect(access.outcome).toBe("allowed");
  });

  it("refuses a stranger while an owner is recorded", async () => {
    const access = await decide({
      senderId: "stranger@im.wechat",
      sources: sources({ loadOwnerUserId: () => OWNER }),
    });
    expect(access).toEqual({ outcome: "unauthorized", reason: "sender-not-trusted" });
  });

  it("adds the configured allowFrom senders next to the owner", async () => {
    const ownerSources = sources({ loadOwnerUserId: () => OWNER });
    const friend = await decide({
      senderId: "friend@im.wechat",
      configuredAllowFrom: ["friend@im.wechat"],
      sources: ownerSources,
    });
    const stranger = await decide({
      senderId: "stranger@im.wechat",
      configuredAllowFrom: ["friend@im.wechat"],
      sources: ownerSources,
    });
    expect(friend.outcome).toBe("allowed");
    expect(stranger.outcome).toBe("unauthorized");
  });

  it("trusts a configured sender when no owner is on record", async () => {
    const friend = await decide({
      senderId: "friend@im.wechat",
      configuredAllowFrom: ["friend@im.wechat"],
    });
    const stranger = await decide({
      senderId: "stranger@im.wechat",
      configuredAllowFrom: ["friend@im.wechat"],
    });
    expect(friend.outcome).toBe("allowed");
    expect(stranger).toEqual({ outcome: "unauthorized", reason: "sender-not-trusted" });
  });

  it("honors the framework pairing store", async () => {
    const paired = await decide({
      senderId: "paired@im.wechat",
      sources: sources({ readStoreAllowFrom: () => ["paired@im.wechat"] }),
    });
    const other = await decide({
      senderId: "other@im.wechat",
      sources: sources({ readStoreAllowFrom: () => ["paired@im.wechat"] }),
    });
    expect(paired.outcome).toBe("allowed");
    expect(other.outcome).toBe("unauthorized");
  });

  it("reads the pairing store before falling back to the login owner", async () => {
    let ownerReads = 0;
    const storeFirst = sources({
      readStoreAllowFrom: () => ["paired@im.wechat"],
      loadOwnerUserId: () => {
        ownerReads += 1;
        return OWNER;
      },
    });
    await decide({ senderId: "paired@im.wechat", sources: storeFirst });
    expect(ownerReads).toBe(0);
  });

  it("keeps the configured senders when reading the pairing store throws", async () => {
    const friend = await decide({
      senderId: "friend@im.wechat",
      configuredAllowFrom: ["friend@im.wechat"],
      sources: sources({
        readStoreAllowFrom: () => {
          throw new Error("corrupt store");
        },
      }),
    });
    expect(friend.outcome).toBe("allowed");
  });

  it("carries the command authorization computed by the runtime", async () => {
    const runtime: CommandAuthorizationRuntime = {
      shouldComputeCommandAuthorized: () => true,
      resolveCommandAuthorizedFromAuthorizers: ({ authorizers }) =>
        authorizers.every((authorizer) => !authorizer.configured || authorizer.allowed),
    };
    const owner = await decide({
      senderId: OWNER,
      sources: sources({ loadOwnerUserId: () => OWNER }),
      runtime,
    });
    expect(owner).toEqual({ outcome: "allowed", commandAuthorized: true });
  });
});

describe("formatWeixinNoTrustedSenderHint", () => {
  it("names both ways back in", () => {
    const hint = formatWeixinNoTrustedSenderHint(ACCOUNT);
    expect(hint).toContain(`account=${ACCOUNT}`);
    expect(hint).toContain("kaijibot channels login --channel wechat");
    expect(hint).toContain("channels.wechat.allowFrom");
  });
});

describe("createWeixinDmRefusalLog", () => {
  it("explains a missing owner once per account", () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const refusalLog = createWeixinDmRefusalLog(log);
    refusalLog(ACCOUNT, OWNER, "no-trusted-sender");
    refusalLog(ACCOUNT, "stranger@im.wechat", "no-trusted-sender");
    refusalLog("acct-other", OWNER, "no-trusted-sender");
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain(formatWeixinNoTrustedSenderHint(ACCOUNT));
    expect(log.info).not.toHaveBeenCalled();
  });

  it("reports every refusal of an untrusted sender", () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const refusalLog = createWeixinDmRefusalLog(log);
    refusalLog(ACCOUNT, "stranger@im.wechat", "sender-not-trusted");
    refusalLog(ACCOUNT, "other@im.wechat", "sender-not-trusted");
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledTimes(2);
    expect(String(log.info.mock.calls[0]?.[0])).toContain("from=stranger@im.wechat");
  });
});
