import { describe, expect, it, vi } from "vitest";
import { installLarkCliSkills } from "./install-skills.ts";

// Mock isLarkCliAvailable to control whether the function proceeds
vi.mock("./resolve.ts", () => ({
  isLarkCliAvailable: vi.fn(() => true),
}));

// Mock execFile to capture the npx call
import { execFile } from "node:child_process";
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

describe("installLarkCliSkills", () => {
  it("returns error when lark-cli is not available", async () => {
    const { isLarkCliAvailable } = await import("./resolve.ts");
    vi.mocked(isLarkCliAvailable).mockReturnValueOnce(false);

    const result = await installLarkCliSkills();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("lark-cli not available");
  });

  it("calls npx with -y flag", async () => {
    mockedExecFile.mockImplementationOnce(
      ((_file: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, "28 skills installed", "");
      }) as typeof execFile,
    );

    const result = await installLarkCliSkills();
    expect(result.ok).toBe(true);

    const callArgs = mockedExecFile.mock.calls[0];
    const args = callArgs[1] as string[];
    expect(args[0]).toBe("-y");
    expect(args).toContain("skills");
    expect(args).toContain("add");
    expect(args).toContain("larksuite/cli");
  });

  it("parses installed count from output", async () => {
    mockedExecFile.mockImplementationOnce(
      ((_file: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, "28 skills installed successfully", "");
      }) as typeof execFile,
    );

    const result = await installLarkCliSkills();
    expect(result.ok).toBe(true);
    expect(result.installed).toBe(28);
  });

  it("returns error on npx failure", async () => {
    mockedExecFile.mockImplementationOnce(
      ((_file: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
        cb(new Error("Command failed with exit code 1"));
      }) as typeof execFile,
    );

    const result = await installLarkCliSkills();
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("uses shell:true on Windows", async () => {
    const originalPlatform = process.platform;
    // We can't easily mock process.platform, but we can verify the options
    // by checking the execFile call
    mockedExecFile.mockImplementationOnce(
      ((_file: string, _args: string[], _opts: Record<string, unknown>, cb: (err: null, stdout: string, stderr: string) => void) => {
        // On win32, opts should have shell: true
        if (originalPlatform === "win32") {
          expect(_opts.shell).toBe(true);
        }
        cb(null, "done", "");
      }) as typeof execFile,
    );

    await installLarkCliSkills();
    expect(mockedExecFile).toHaveBeenCalled();
  });

  it("sets timeout to 120s", async () => {
    mockedExecFile.mockImplementationOnce(
      ((_file: string, _args: string[], opts: Record<string, unknown>, cb: (err: null, stdout: string, stderr: string) => void) => {
        expect(opts.timeout).toBe(120_000);
        cb(null, "done", "");
      }) as typeof execFile,
    );

    await installLarkCliSkills();
  });
});
