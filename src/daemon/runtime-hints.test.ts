import { describe, expect, it } from "vitest";
import { buildPlatformRuntimeLogHints, buildPlatformServiceStartHints } from "./runtime-hints.js";

describe("buildPlatformRuntimeLogHints", () => {
  it("renders launchd log hints on darwin", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        env: {
          KAIJIBOT_STATE_DIR: "/tmp/kaijibot-state",
          KAIJIBOT_LOG_PREFIX: "gateway",
        },
        systemdServiceName: "kaijibot-gateway",
        windowsTaskName: "KaijiBot Gateway",
      }),
    ).toEqual([
      "Launchd stdout (if installed): /tmp/kaijibot-state/logs/gateway.log",
      "Launchd stderr (if installed): /tmp/kaijibot-state/logs/gateway.err.log",
    ]);
  });

  it("renders systemd and windows hints by platform", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "linux",
        systemdServiceName: "kaijibot-gateway",
        windowsTaskName: "KaijiBot Gateway",
      }),
    ).toEqual(["Logs: journalctl --user -u kaijibot-gateway.service -n 200 --no-pager"]);
    expect(
      buildPlatformRuntimeLogHints({
        platform: "win32",
        systemdServiceName: "kaijibot-gateway",
        windowsTaskName: "KaijiBot Gateway",
      }),
    ).toEqual(['Logs: schtasks /Query /TN "KaijiBot Gateway" /V /FO LIST']);
  });
});

describe("buildPlatformServiceStartHints", () => {
  it("builds platform-specific service start hints", () => {
    expect(
      buildPlatformServiceStartHints({
        platform: "darwin",
        installCommand: "kaijibot gateway install",
        startCommand: "kaijibot gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.kaijibot.gateway.plist",
        systemdServiceName: "kaijibot-gateway",
        windowsTaskName: "KaijiBot Gateway",
      }),
    ).toEqual([
      "kaijibot gateway install",
      "kaijibot gateway",
      "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.kaijibot.gateway.plist",
    ]);
    expect(
      buildPlatformServiceStartHints({
        platform: "linux",
        installCommand: "kaijibot gateway install",
        startCommand: "kaijibot gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.kaijibot.gateway.plist",
        systemdServiceName: "kaijibot-gateway",
        windowsTaskName: "KaijiBot Gateway",
      }),
    ).toEqual([
      "kaijibot gateway install",
      "kaijibot gateway",
      "systemctl --user start kaijibot-gateway.service",
    ]);
  });
});
