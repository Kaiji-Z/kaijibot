import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { KaijiBotConfig } from "kaijibot/plugin-sdk/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeWeixinAllowFrom, resolveWeixinAccount } from "./accounts.js";

let previousStateDir: string | undefined;
let stateDir = "";

beforeEach(() => {
  previousStateDir = process.env.KAIJIBOT_STATE_DIR;
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-accounts-"));
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

function configWithWechat(wechat: unknown): KaijiBotConfig {
  return { channels: { wechat } } as unknown as KaijiBotConfig;
}

describe("normalizeWeixinAllowFrom", () => {
  it("trims ids and drops blanks or non-strings", () => {
    expect(normalizeWeixinAllowFrom([" a@im.wechat ", "", "  ", 42, null, "b@im.wechat"])).toEqual([
      "a@im.wechat",
      "b@im.wechat",
    ]);
  });

  it("returns an empty list for anything that is not an array", () => {
    expect(normalizeWeixinAllowFrom(undefined)).toEqual([]);
    expect(normalizeWeixinAllowFrom("a@im.wechat")).toEqual([]);
  });
});

describe("resolveWeixinAccount allowFrom", () => {
  it("is empty when nothing is configured", () => {
    expect(resolveWeixinAccount(configWithWechat({ enabled: true }), "acct").allowFrom).toEqual([]);
  });

  it("reads channels.wechat.allowFrom", () => {
    const cfg = configWithWechat({ allowFrom: ["friend@im.wechat"] });
    expect(resolveWeixinAccount(cfg, "acct").allowFrom).toEqual(["friend@im.wechat"]);
  });

  it("lets an account entry replace the channel-level list", () => {
    const cfg = configWithWechat({
      allowFrom: ["channel-level@im.wechat"],
      accounts: { acct: { allowFrom: ["per-account@im.wechat"] } },
    });
    expect(resolveWeixinAccount(cfg, "acct").allowFrom).toEqual(["per-account@im.wechat"]);
  });
});
