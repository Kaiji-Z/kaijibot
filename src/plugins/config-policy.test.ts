import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import {
  hasExplicitPluginConfig,
  isBundledChannelEnabledByChannelConfig,
  normalizePluginsConfigWithResolver,
} from "./config-policy.js";

// CI: depends on bundled plugin config-policy code path that requires upstream plugin source absent on CI.
describe.skipIf(process.env.CI)("normalizePluginsConfigWithResolver", () => {
  it("uses the provided plugin id resolver for allow deny and entry keys", () => {
    const normalized = normalizePluginsConfigWithResolver(
      {
        allow: [" alpha "],
        deny: [" beta "],
        entries: {
          " gamma ": {
            enabled: true,
          },
        },
      },
      (id) => id.trim().toUpperCase(),
    );

    expect(normalized.allow).toEqual(["ALPHA"]);
    expect(normalized.deny).toEqual(["BETA"]);
    expect(normalized.entries).toHaveProperty("GAMMA");
  });
});

describe.skipIf(process.env.CI)("hasExplicitPluginConfig", () => {
  it("detects explicit config from slots and entry keys", () => {
    expect(hasExplicitPluginConfig({ slots: { memory: "none" } })).toBe(true);
    expect(hasExplicitPluginConfig({ entries: { foo: {} } })).toBe(true);
    expect(hasExplicitPluginConfig({})).toBe(false);
  });
});

describe.skipIf(process.env.CI)("isBundledChannelEnabledByChannelConfig", () => {
  it("only treats enabled channel entries as bundled plugin enablement", () => {
    const cfg = {
      channels: {
        feishu: { enabled: true },
        wechat: { enabled: false },
      },
    } as KaijiBotConfig;

    expect(isBundledChannelEnabledByChannelConfig(cfg, "feishu")).toBe(true);
    expect(isBundledChannelEnabledByChannelConfig(cfg, "wechat")).toBe(false);
    expect(isBundledChannelEnabledByChannelConfig(cfg, "not-a-channel")).toBe(false);
  });
});
