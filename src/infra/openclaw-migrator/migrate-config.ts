import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MigrationChange, MigrationOptions, MigrationResult, MigrationSource } from "./types.js";

const KAIJIBOT_CONFIG_FILENAME = "kaijibot.json";

const KAIJIBOT_CONFIG_DEFAULTS: Record<string, unknown> = {
  cognitive: {
    enabled: true,
    proactive: {
      enabled: true,
      minIntervalHours: 4,
      activeHours: "08:00-23:00",
    },
    insight: {
      engine: "unified",
    },
    evolution: {
      enabled: true,
    },
  },
};

/** Brand home-dir prefixes that should be rewritten to ~/.kaijibot/ */
const BRAND_HOME_PREFIXES = [
  "~/.openclaw/",
  "~/.clawdbot/",
  "~/.moltbot/",
];

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (key in result) {
      const existing = result[key];
      if (
        typeof existing === "object" &&
        existing !== null &&
        !Array.isArray(existing) &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        result[key] = deepMerge(
          existing as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

function fileHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Recursively rewrite path values in a config object:
 * 1. ~/.openclaw/, ~/.clawdbot/, ~/.moltbot/ → ~/.kaijibot/
 * 2. Absolute paths starting with sourceDir → same relative path under targetDir
 */
export function rewriteConfigPaths(
  config: Record<string, unknown>,
  sourceDir: string,
  targetDir: string,
): Record<string, unknown> {
  const homeDir = os.homedir();
  const normalizedSource = path.normalize(sourceDir);
  const normalizedTarget = path.normalize(targetDir);

  const rewritten: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string") {
      rewritten[key] = rewriteStringValue(value, normalizedSource, normalizedTarget, homeDir);
    } else if (Array.isArray(value)) {
      rewritten[key] = value.map((item) =>
        typeof item === "object" && item !== null && !Array.isArray(item)
          ? rewriteConfigPaths(item as Record<string, unknown>, sourceDir, targetDir)
          : typeof item === "string"
            ? rewriteStringValue(item, normalizedSource, normalizedTarget, homeDir)
            : item,
      );
    } else if (typeof value === "object" && value !== null) {
      rewritten[key] = rewriteConfigPaths(value as Record<string, unknown>, sourceDir, targetDir);
    } else {
      rewritten[key] = value;
    }
  }
  return rewritten;
}

function rewriteStringValue(
  value: string,
  sourceDir: string,
  targetDir: string,
  homeDir: string,
): string {
  // 1. Rewrite brand home-dir prefixes
  for (const prefix of BRAND_HOME_PREFIXES) {
    if (value.includes(prefix)) {
      value = value.replaceAll(prefix, "~/.kaijibot/");
    }
  }

  // 2. Rewrite absolute paths pointing into sourceDir
  // Expand ~/ in value for comparison
  if (value.startsWith("~/")) {
    const expanded = path.normalize(path.join(homeDir, value.slice(2)));
    if (expanded.startsWith(sourceDir + path.sep) || expanded === sourceDir) {
      const relative = path.relative(sourceDir, expanded);
      const rewritten = path.join(targetDir, relative);
      // Preserve ~/ style if the original used it and target is under home
      if (rewritten.startsWith(homeDir)) {
        return "~/" + path.relative(homeDir, rewritten);
      }
      return rewritten;
    }
  }

  // Handle already-expanded absolute paths
  const normalizedValue = path.normalize(value);
  if (path.isAbsolute(normalizedValue)) {
    if (normalizedValue.startsWith(sourceDir + path.sep) || normalizedValue === sourceDir) {
      const relative = path.relative(sourceDir, normalizedValue);
      return path.normalize(path.join(targetDir, relative));
    }
  }

  return value;
}

/** Check for multi-agent configs without bindings and emit a warning. */
function checkMultiAgentBindings(
  config: Record<string, unknown>,
  warnings: string[],
): void {
  const agents = config.agents as Record<string, unknown> | undefined;
  if (!agents) { return; }

  const agentList = agents.list as Array<Record<string, unknown>> | undefined;
  if (!agentList || !Array.isArray(agentList) || agentList.length <= 1) { return; }

  const bindings = config.bindings as unknown[];
  if (bindings && Array.isArray(bindings) && bindings.length > 0) { return; }

  warnings.push(
    "Multi-agent config migrated but no bindings found. " +
      "Non-default agents will not receive messages until bindings are configured. " +
      "Run `kaijibot config edit` to add route bindings for each agent.",
  );
}

/** Validate that workspace directories referenced in agents.list exist. */
async function validateAgentWorkspaceDirs(
  config: Record<string, unknown>,
  targetDir: string,
  warnings: string[],
): Promise<void> {
  const agents = config.agents as Record<string, unknown> | undefined;
  if (!agents) { return; }

  const agentList = agents.list as Array<Record<string, unknown>> | undefined;
  if (!agentList || !Array.isArray(agentList)) { return; }

  for (const agent of agentList) {
    const agentId = typeof agent.id === "string" ? agent.id : "";
    if (!agentId) { continue; }

    const workspaceRel = typeof agent.workspace === "string"
      ? agent.workspace
      : `workspace-${agentId}`;
    const workspaceAbs = path.resolve(targetDir, workspaceRel);

    try {
      const stat = await fs.stat(workspaceAbs);
      if (!stat.isDirectory()) {
        warnings.push(
          `Agent '${agentId}' workspace path exists but is not a directory: ${workspaceRel}`,
        );
      }
    } catch {
      warnings.push(
        `Agent '${agentId}' workspace directory not found after migration: ${workspaceRel}. ` +
          "It may be created on first use.",
      );
    }
  }
}

export async function migrateConfig(
  source: MigrationSource,
  targetDir: string,
  options: MigrationOptions,
): Promise<MigrationResult> {
  const changes: MigrationChange[] = [];
  const warnings: string[] = [];
  const skipped: string[] = [];
  const log = options.log ?? (() => {});

  const targetConfigPath = path.join(targetDir, KAIJIBOT_CONFIG_FILENAME);

  let sourceConfig: Record<string, unknown>;
  try {
    const raw = await fs.readFile(source.configPath, "utf-8");
    sourceConfig = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    warnings.push(`Cannot read source config ${source.configPath}: ${String(err)}`);
    return { source, changes, warnings, skipped };
  }

  const merged = deepMerge(sourceConfig, KAIJIBOT_CONFIG_DEFAULTS);

  // Rewrite paths in merged config (brand home dirs + absolute source paths)
  const rewritten = rewriteConfigPaths(merged, source.dir, targetDir);

  // Check for multi-agent config without bindings
  checkMultiAgentBindings(rewritten, warnings);

  const rewrittenJson = JSON.stringify(rewritten, null, 2);

  try {
    await fs.access(targetConfigPath);
    const existingRaw = await fs.readFile(targetConfigPath, "utf-8");

    if (!options.overwrite) {
      const sourceJson = JSON.stringify(sourceConfig, null, 2);
      if (fileHash(existingRaw) === fileHash(sourceJson)) {
        log(`Config already up-to-date: ${targetConfigPath}`);
        skipped.push(targetConfigPath);
        return { source, changes, warnings, skipped };
      }
      warnings.push(
        `Target config already exists: ${targetConfigPath}. Use --overwrite to merge.`,
      );
      skipped.push(targetConfigPath);
      return { source, changes, warnings, skipped };
    }

    const existingConfig = JSON.parse(existingRaw) as Record<string, unknown>;
    const mergedWithExisting = deepMerge(rewritten, existingConfig);

    if (options.dryRun) {
      changes.push({
        kind: "merge",
        source: path.relative(source.dir, source.configPath),
        target: path.relative(targetDir, targetConfigPath),
        detail: "Would merge source config with existing KaijiBot config (existing takes precedence)",
      });
    } else {
      await fs.writeFile(targetConfigPath, JSON.stringify(mergedWithExisting, null, 2), "utf-8");
      changes.push({
        kind: "merge",
        source: path.relative(source.dir, source.configPath),
        target: path.relative(targetDir, targetConfigPath),
        detail: "Merged source config with existing KaijiBot config (existing takes precedence)",
      });
      log(`Merged config: ${targetConfigPath}`);
    }
  } catch {
    if (options.dryRun) {
      changes.push({
        kind: "create",
        source: path.relative(source.dir, source.configPath),
        target: path.relative(targetDir, targetConfigPath),
        detail: "Would create KaijiBot config with defaults",
      });
    } else {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(targetConfigPath, rewrittenJson, "utf-8");
      changes.push({
        kind: "create",
        source: path.relative(source.dir, source.configPath),
        target: path.relative(targetDir, targetConfigPath),
        detail: "Created KaijiBot config with defaults",
      });
      log(`Created config: ${targetConfigPath}`);
    }
  }

  // Post-write validation (only for non-dry-run writes that produced a change)
  if (!options.dryRun && changes.length > 0) {
    await validateAgentWorkspaceDirs(rewritten, targetDir, warnings);
  }

  return { source, changes, warnings, skipped };
}
