import { afterEach, describe, expect, it, vi } from "vitest";
import { logGatewayStartup } from "./server-startup-log.js";

describe("gateway startup log", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("warns when dangerous config flags are enabled", () => {
    const info = vi.fn();
    const warn = vi.fn();

    logGatewayStartup({
      cfg: {
        agents: { defaults: { model: { primary: "zai/glm-5" } } },
        gateway: {
          controlUi: {
            dangerouslyDisableDeviceAuth: true,
          },
        },
      },
      bindHost: "127.0.0.1",
      pluginCount: 0,
      port: 18789,
      log: { info, warn },
      isNixMode: false,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dangerous config flags enabled"));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("gateway.controlUi.dangerouslyDisableDeviceAuth=true"),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("kaijibot security audit"));
  });

  it("does not warn when dangerous config flags are disabled", () => {
    const info = vi.fn();
    const warn = vi.fn();

    logGatewayStartup({
      cfg: {
        agents: { defaults: { model: { primary: "zai/glm-5" } } },
      },
      bindHost: "127.0.0.1",
      pluginCount: 0,
      port: 18789,
      log: { info, warn },
      isNixMode: false,
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("logs a compact ready line with plugin count and duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T10:00:16.000Z"));

    const info = vi.fn();
    const warn = vi.fn();

    logGatewayStartup({
      cfg: {},
      bindHost: "127.0.0.1",
      bindHosts: ["127.0.0.1", "::1"],
      pluginCount: 8,
      port: 18789,
      startupStartedAt: Date.parse("2026-04-03T10:00:00.000Z"),
      log: { info, warn },
      isNixMode: false,
    });

    const readyMessages = info.mock.calls
      .map((call) => call[0])
      .filter((message) => message.startsWith("ready ("));
    expect(readyMessages).toEqual(["ready (8 plugins, 16.0s)"]);
  });

  it("logs the resolved agent model when configured", () => {
    const info = vi.fn();
    const warn = vi.fn();

    logGatewayStartup({
      cfg: {
        agents: { defaults: { model: { primary: "zai/glm-5" } } },
      },
      bindHost: "127.0.0.1",
      pluginCount: 0,
      port: 18789,
      log: { info, warn },
      isNixMode: false,
    });

    expect(info).toHaveBeenCalledWith("agent model: zai/glm-5", expect.anything());
    expect(warn).not.toHaveBeenCalled();
  });

  it("degrades to a warning instead of throwing when no agent model is configured", () => {
    const info = vi.fn();
    const warn = vi.fn();

    logGatewayStartup({
      cfg: {},
      bindHost: "127.0.0.1",
      pluginCount: 0,
      port: 18789,
      log: { info, warn },
      isNixMode: false,
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("agent model: not configured"));
    expect(info.mock.calls.map((call) => call[0]).some((m) => m.startsWith("ready ("))).toBe(true);
  });
});
