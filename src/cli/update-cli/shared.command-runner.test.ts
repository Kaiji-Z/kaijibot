import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGlobalCommandRunner, formatCommandFailure } from "./shared.js";

const runCommandWithTimeout = vi.hoisted(() => vi.fn());

vi.mock("../../process/exec.js", () => ({
  runCommandWithTimeout,
}));

describe("createGlobalCommandRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runCommandWithTimeout.mockResolvedValue({
      stdout: "",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
      termination: "exit",
    });
  });

  it("forwards argv/options and maps exec result shape", async () => {
    runCommandWithTimeout.mockResolvedValueOnce({
      stdout: "out",
      stderr: "err",
      code: 17,
      signal: null,
      killed: false,
      termination: "exit",
    });
    const runCommand = createGlobalCommandRunner();

    const result = await runCommand(["npm", "root", "-g"], {
      timeoutMs: 1200,
      cwd: "/tmp/kaijibot",
      env: { KAIJIBOT_TEST: "1" },
    });

    expect(runCommandWithTimeout).toHaveBeenCalledWith(["npm", "root", "-g"], {
      timeoutMs: 1200,
      cwd: "/tmp/kaijibot",
      env: { KAIJIBOT_TEST: "1" },
    });
    expect(result).toEqual({
      stdout: "out",
      stderr: "err",
      code: 17,
    });
  });
});

describe("formatCommandFailure", () => {
  it("returns a placeholder when both streams are empty", () => {
    expect(formatCommandFailure("", "")).toBe("command returned a non-zero exit code");
  });

  it("keeps BOTH streams labeled instead of dropping stdout when stderr is non-empty", () => {
    const detail = formatCommandFailure("Error: service install failed", "unknown format ignored");
    expect(detail).toContain("[stderr]");
    expect(detail).toContain("unknown format ignored");
    expect(detail).toContain("[stdout]");
    expect(detail).toContain("Error: service install failed");
  });

  it("truncates each stream to the tail lines", () => {
    const stdoutLines = Array.from({ length: 15 }, (_, i) => `out-${i}`).join("\n");
    const detail = formatCommandFailure(stdoutLines, "");
    expect(detail).toContain("out-14");
    expect(detail).not.toContain("out-0\n");
  });

  it("normalizes whitespace-only streams as empty", () => {
    expect(formatCommandFailure("   ", "\n")).toBe("command returned a non-zero exit code");
  });
});
