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

  return new Promise<InstallSkillsResult>((resolve) => {
    execFile(
      "npx",
      ["skills", "add", "larksuite/cli", "-g", "--all"],
      { timeout: INSTALL_TIMEOUT_MS, env: process.env },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          resolve({ ok: false, error: detail });
          return;
        }

        const match = stdout.match(/(\d+)\s+skill/i);
        resolve({
          ok: true,
          installed: match ? parseInt(match[1], 10) : undefined,
        });
      },
    );
  });
}
