import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isLarkCliAvailable } from "./resolve.ts";

/** All native feishu tool keys that can be toggled in channels.feishu.tools.* */
const ALL_TOOL_KEYS = [
  "doc",
  "chat",
  "wiki",
  "drive",
  "perm",
  "scopes",
  "vc",
  "task",
  "bitable",
] as const;

/** Feishu skill IDs to disable when lark-cli takes over native tools */
const FEISHU_SKILL_IDS = ["feishu-doc", "feishu-wiki", "feishu-drive", "feishu-perm"] as const;

/**
 * Check if lark-* skills are installed in ~/.agents/skills/.
 * Auto-disable should only activate when CLI skills are ready to replace
 * native tools — otherwise existing users lose feishu capability on upgrade.
 */
export function areLarkSkillsInstalled(): boolean {
  const skillsDir = join(homedir(), ".agents", "skills");
  if (!existsSync(skillsDir)) {
    return false;
  }
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    return entries.some(
      (e) =>
        e.isDirectory() &&
        e.name.startsWith("lark-") &&
        existsSync(join(skillsDir, e.name, "SKILL.md")),
    );
  } catch {
    return false;
  }
}

/**
 * Check if native feishu tools should be auto-disabled.
 * Returns true when:
 * 1. lark-cli binary is available AND healthy
 * 2. lark-* skills are installed (CLI has replacements ready)
 * 3. User has NOT explicitly configured any tools.* keys
 */
export function shouldDisableNativeTools(
  userToolsConfig: Record<string, unknown> | undefined,
): boolean {
  if (!isLarkCliAvailable()) {
    return false;
  }
  if (!areLarkSkillsInstalled()) {
    return false;
  }
  // If user has set any tool key explicitly, don't auto-disable
  if (userToolsConfig && Object.keys(userToolsConfig).length > 0) {
    return false;
  }
  return true;
}

/**
 * Build the tools config that disables all native feishu tools.
 */
export function buildDisabledToolsConfig(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of ALL_TOOL_KEYS) {
    result[key] = false;
  }
  return result;
}

/**
 * Build skill disable entries for feishu skills.
 */
export function buildDisabledSkillEntries(): Record<string, { enabled: boolean }> {
  const result: Record<string, { enabled: boolean }> = {};
  for (const id of FEISHU_SKILL_IDS) {
    result[id] = { enabled: false };
  }
  return result;
}
