import { execFile } from "node:child_process";
import { isLarkCliAvailable } from "./resolve.ts";

export interface InstallSkillsResult {
  ok: boolean;
  /** Number of skills installed, if parseable from output. */
  installed?: number;
  /** Error message when ok is false. */
  error?: string;
}

const INSTALL_TIMEOUT_MS = 120_000;

/**
 * Resolve the npx executable name for the current platform.
 *
 * On Windows, `execFile("npx", ...)` fails with ENOENT because cmd.exe
 * needs the `.cmd` extension to resolve batch/shell scripts.  The npm
 * bin directory is already on PATH for most setups, but `execFile` does
 * not go through cmd.exe unless `shell: true` is set.
 */
function resolveNpxCommand(): { file: string; useShell: boolean } {
  if (process.platform === "win32") {
    return { file: "npx", useShell: true };
  }
  return { file: "npx", useShell: false };
}

/**
 * Install lark-cli skills (lark-*) to ~/.agents/skills/.
 *
 * Runs `npx skills add larksuite/cli -g --all` which installs ~28 lark-*
 * skills that wrap lark-cli commands as prompt guides (SKILL.md files).
 *
 * Requires:
 *   1. lark-cli binary available (resolved from optionalDependency or PATH)
 *   2. Network access (skills are fetched from registry)
 *
 * Non-blocking: returns error info instead of throwing.
 */
export async function installLarkCliSkills(): Promise<InstallSkillsResult> {
  if (!isLarkCliAvailable()) {
    return { ok: false, error: "lark-cli not available" };
  }

  const { file, useShell } = resolveNpxCommand();

  return new Promise<InstallSkillsResult>((resolve) => {
    const options: import("node:child_process").ExecFileOptions = {
      timeout: INSTALL_TIMEOUT_MS,
      env: process.env,
      ...(useShell ? { shell: true } : {}),
    };
    execFile(
      file,
      ["-y", "skills", "add", "larksuite/cli", "-g", "--all"],
      options,
      (error, stdout, stderr) => {
        if (error) {
          const detail = (typeof stderr === "string" ? stderr : "")?.trim() || error.message;
          resolve({ ok: false, error: detail });
          return;
        }

        const out = typeof stdout === "string" ? stdout : "";
        const match = out.match(/(\d+)\s+skill/i);
        resolve({
          ok: true,
          installed: match ? parseInt(match[1], 10) : undefined,
        });
      },
    );
  });
}
