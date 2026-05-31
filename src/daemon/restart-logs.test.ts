import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  renderCmdRestartLogSetup,
  renderPosixRestartLogSetup,
  resolveGatewayLogPaths,
  resolveGatewayRestartLogPath,
  resolveGatewaySupervisorLogPaths,
  shellEscapeRestartLogValue,
} from "./restart-logs.js";

const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

const baseEnv = () => ({
  HOME: "/home/testuser",
  KAIJIBOT_STATE_DIR: "/tmp/kaijibot-test-state",
});

describe("resolveGatewayLogPaths", () => {
  it("returns { logDir, stdoutPath, stderrPath } under state dir", () => {
    const env = baseEnv();
    const result = resolveGatewayLogPaths(env);

    expect(result.logDir).toBe(path.join(env.KAIJIBOT_STATE_DIR!, "logs"));
    expect(result.stdoutPath).toBe(path.join(result.logDir, "gateway.log"));
    expect(result.stderrPath).toBe(path.join(result.logDir, "gateway.err.log"));
  });

  it("respects KAIJIBOT_LOG_PREFIX", () => {
    const env = { ...baseEnv(), KAIJIBOT_LOG_PREFIX: "custom-prefix" };
    const result = resolveGatewayLogPaths(env);

    expect(result.stdoutPath).toBe(path.join(result.logDir, "custom-prefix.log"));
    expect(result.stderrPath).toBe(path.join(result.logDir, "custom-prefix.err.log"));
  });
});

describe("resolveGatewayRestartLogPath", () => {
  it("returns path ending with gateway-restart.log", () => {
    const env = baseEnv();
    const result = resolveGatewayRestartLogPath(env);

    expect(result.endsWith("gateway-restart.log")).toBe(true);
    expect(result).toBe(path.join(env.KAIJIBOT_STATE_DIR!, "logs", "gateway-restart.log"));
  });
});

describe("resolveGatewaySupervisorLogPaths", () => {
  it("on non-darwin returns state dir paths", () => {
    const env = baseEnv();
    const result = resolveGatewaySupervisorLogPaths(env, { platform: "linux" });

    const expected = resolveGatewayLogPaths(env);
    expect(result).toEqual(expected);
  });

  it("on darwin returns LaunchAgent paths", () => {
    const env = baseEnv();
    const result = resolveGatewaySupervisorLogPaths(env, { platform: "darwin" });

    expect(result.logDir).toContain("Library/Logs/kaijibot");
    expect(result.stdoutPath).toMatch(/gateway\.log$/);
  });
});

describe("renderPosixRestartLogSetup", () => {
  it("produces valid shell snippet with mkdir and exec redirect", () => {
    const env = baseEnv();
    const result = renderPosixRestartLogSetup(env);

    expect(result).toContain("mkdir -p");
    expect(result).toContain("exec >>");
    expect(result).toContain("2>&1");
    expect(result).toContain("gateway-restart.log");
  });
});

describe("renderCmdRestartLogSetup", () => {
  it("produces { lines, quotedLogPath } with valid CMD commands", () => {
    const env = baseEnv();
    const result = renderCmdRestartLogSetup(env);

    expect(result.lines.length).toBeGreaterThanOrEqual(2);
    expect(result.lines[0]).toContain("mkdir");
    expect(result.lines[1]).toContain("kaijibot restart log initialized");
    expect(result.quotedLogPath).toContain("gateway-restart.log");
  });
});

describe("shellEscapeRestartLogValue", () => {
  it("handles single quotes (replaces ' with '\\'')", () => {
    expect(shellEscapeRestartLogValue("it's")).toBe("it'\\''s");
    expect(shellEscapeRestartLogValue("no-quotes")).toBe("no-quotes");
    expect(shellEscapeRestartLogValue("'wrapped'")).toBe("'\\''wrapped'\\''");
  });
});
