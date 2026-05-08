import crypto from "node:crypto";
import fs from "node:fs/promises";
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
  const mergedJson = JSON.stringify(merged, null, 2);

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
    const mergedWithExisting = deepMerge(merged, existingConfig);

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
      await fs.writeFile(targetConfigPath, mergedJson, "utf-8");
      changes.push({
        kind: "create",
        source: path.relative(source.dir, source.configPath),
        target: path.relative(targetDir, targetConfigPath),
        detail: "Created KaijiBot config with defaults",
      });
      log(`Created config: ${targetConfigPath}`);
    }
  }

  return { source, changes, warnings, skipped };
}
