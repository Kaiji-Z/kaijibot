import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { setPluginEnabledInConfig } from "./plugins-config.js";

describe("setPluginEnabledInConfig", () => {
  it("sets enabled flag for an existing plugin entry", () => {
    const config = {
      plugins: {
        entries: {
          alpha: { enabled: false, custom: "x" },
        },
      },
    } as KaijiBotConfig;

    const next = setPluginEnabledInConfig(config, "alpha", true);

    expect(next.plugins?.entries?.alpha).toEqual({
      enabled: true,
      custom: "x",
    });
  });

  it("creates a plugin entry when it does not exist", () => {
    const config = {} as KaijiBotConfig;

    const next = setPluginEnabledInConfig(config, "beta", false);

    expect(next.plugins?.entries?.beta).toEqual({
      enabled: false,
    });
  });

  it("keeps built-in channel and plugin entry flags in sync", () => {
    const config = {
      channels: {
        feishu: {
          enabled: true,
          dmPolicy: "open",
        },
      },
      plugins: {
        entries: {
          feishu: {
            enabled: true,
          },
        },
      },
    } as KaijiBotConfig;

    const disabled = setPluginEnabledInConfig(config, "feishu", false);
    expect(disabled.channels?.feishu).toEqual({
      enabled: false,
      dmPolicy: "open",
    });
    expect(disabled.plugins?.entries?.feishu).toEqual({
      enabled: false,
    });

    const reenabled = setPluginEnabledInConfig(disabled, "feishu", true);
    expect(reenabled.channels?.feishu).toEqual({
      enabled: true,
      dmPolicy: "open",
    });
    expect(reenabled.plugins?.entries?.feishu).toEqual({
      enabled: true,
    });
  });
});
