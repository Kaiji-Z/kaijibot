import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { enumerateSourceAgents, enumerateSourceSkills, computeWorkspaceStats } from "./agent-enumeration.js";
import { detectMigrationSource, detectScenario } from "./detect.js";
import { migrateConfig } from "./migrate-config.js";
import { migrateSkills } from "./migrate-skills.js";
import { migrateSessions } from "./migrate-sessions.js";
import { migrateWorkspace } from "./migrate-workspace.js";
import type {
  AgentInfo,
  AgentSelection,
  DataType,
  MigrationChange,
  MigrationOptions,
  MigrationReport,
  MigrationResult,
  MigrationSource,
  WorkspaceStats,
} from "./types.js";

export { detectMigrationSource, detectScenario, listSourceAgents } from "./detect.js";
export { enumerateSourceAgents, enumerateSourceSkills, computeWorkspaceStats } from "./agent-enumeration.js";
export { migrateConfig } from "./migrate-config.js";
export { migrateWorkspace } from "./migrate-workspace.js";
export { migrateSkills } from "./migrate-skills.js";
export { migrateSessions } from "./migrate-sessions.js";
export type {
  MigrationSource,
  MigrationOptions,
  MigrationResult,
  MigrationChange,
  MigrationReport,
  MigrationScenario,
  DataType,
  AgentInfo,
  WorkspaceStats,
  AgentSelection,
  MigrationScenarioOptions,
  MemoryMergeStrategy,
} from "./types.js";

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function copyDirRecursive(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, dstPath);
    } else {
      await fs.copyFile(srcPath, dstPath);
    }
  }
}

function buildReport(
  timestamp: string,
  source: MigrationSource,
  scenario: "fresh" | "import",
  results: MigrationResult[],
): MigrationReport {
  return {
    timestamp,
    source,
    scenario,
    results,
    totalChanges: results.reduce((sum, r) => sum + r.changes.length, 0),
    totalWarnings: results.reduce((sum, r) => sum + r.warnings.length, 0),
    totalSkipped: results.reduce((sum, r) => sum + r.skipped.length, 0),
  };
}

async function resolveSourceAndTarget(
  options: MigrationOptions,
): Promise<{ source: MigrationSource; targetDir: string }> {
  const home = os.homedir();
  const targetDir = options.targetDir ?? path.join(home, ".kaijibot");

  if (options.source) {
    const resolvedSource = path.resolve(options.source);
    const brand = inferBrandFromDir(resolvedSource);
    const configFilename = `${brand}.json`;
    const configPath = path.join(resolvedSource, configFilename);

    return {
      source: { dir: resolvedSource, brand, configPath, configFilename },
      targetDir,
    };
  }

  const detected = detectMigrationSource();
  if (!detected) {
    throw new Error(
      "No OpenClaw installation found. Checked ~/.openclaw/, ~/.clawdbot/, ~/.moltbot/. " +
        "Use --source to specify the source directory explicitly.",
    );
  }

  return { source: detected, targetDir };
}

function inferBrandFromDir(dir: string): MigrationSource["brand"] {
  const basename = path.basename(dir);
  if (basename === ".openclaw") { return "openclaw"; }
  if (basename === ".clawdbot") { return "clawdbot"; }
  if (basename === ".moltbot") { return "moltbot"; }
  return "openclaw";
}

export async function runFreshMigration(
  source: MigrationSource,
  targetDir: string,
  options: MigrationOptions,
): Promise<MigrationReport> {
  const timestamp = new Date().toISOString();
  const log = options.log ?? (() => {});
  const results: MigrationResult[] = [];

  if (!options.dryRun) {
    await fs.mkdir(targetDir, { recursive: true });
    const backupMarker = path.join(targetDir, `.migration-backup-${timestamp.replace(/[:.]/g, "-")}`);
    const metadata = { timestamp, source: source.dir, brand: source.brand };
    await fs.writeFile(backupMarker, JSON.stringify(metadata, null, 2), "utf-8");
    log(`Created migration marker: ${backupMarker}`);
  }

  log(`Migrating config (${source.brand})...`);
  const configResult = await migrateConfig(source, targetDir, options);
  results.push(configResult);

  log("Migrating workspace...");
  const workspaceResult = await migrateWorkspace(source, targetDir, options, "copy");
  results.push(workspaceResult);

  log("Migrating skills...");
  const skillsResult = await migrateSkills(source, targetDir, options);
  results.push(skillsResult);

  log("Migrating sessions...");
  const sessionsResult = await migrateSessions(source, targetDir, options);
  results.push(sessionsResult);

  const report = buildReport(timestamp, source, "fresh", results);

  if (!options.dryRun) {
    const reportPath = path.join(
      targetDir,
      `.migration-report-${timestamp.replace(/[:.]/g, "-")}.json`,
    );
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
    log(`Migration report saved: ${reportPath}`);
  }

  return report;
}

export async function runImportMigration(
  source: MigrationSource,
  targetDir: string,
  options: MigrationOptions,
  selections: AgentSelection[],
  selectedSkills: string[],
): Promise<MigrationReport> {
  const timestamp = new Date().toISOString();
  const log = options.log ?? (() => {});
  const results: MigrationResult[] = [];
  const changes: MigrationChange[] = [];

  log(`Merging config (${source.brand})...`);
  const configResult = await migrateConfig(source, targetDir, { ...options, overwrite: false });
  results.push(configResult);

  if (selections.length > 0) {
    log("Migrating selected agents...");
    const agents = await enumerateSourceAgents(source);
    for (const sel of selections) {
      const agent = agents.find((a) => a.id === sel.agentId);
      if (!agent) {
        log(`  Agent "${sel.agentId}" not found in source, skipping.`);
        continue;
      }
      log(`  Agent: ${agent.id} — [${sel.dataTypes.join(", ")}]`);

      const needsWorkspace = sel.dataTypes.includes("workspace") || sel.dataTypes.includes("memory");
      if (needsWorkspace) {
        const workspaceResult = await migrateWorkspace(source, targetDir, options, "merge");
        results.push(workspaceResult);
      }

      if (sel.dataTypes.includes("sessions")) {
        const sessionsResult = await migrateSessions(source, targetDir, options);
        results.push(sessionsResult);
      }
    }
  }

  if (selectedSkills.length > 0) {
    log(`Migrating ${selectedSkills.length} selected skills...`);
    const skillsSourceDir = path.join(source.dir, "skills");
    const skillsTargetDir = path.join(targetDir, "skills");

    if (await dirExists(skillsSourceDir)) {
      for (const skillName of selectedSkills) {
        const srcSkill = path.join(skillsSourceDir, skillName);
        const dstSkill = path.join(skillsTargetDir, skillName);
        if (!(await dirExists(srcSkill))) {
          log(`  Skill "${skillName}" not found in source, skipping.`);
          continue;
        }
        if (!options.dryRun) {
          await copyDirRecursive(srcSkill, dstSkill);
        }
        changes.push({
          kind: "copy",
          source: srcSkill,
          target: dstSkill,
          detail: `Copied skill: ${skillName}`,
        });
        log(`  Copied skill: ${skillName}`);
      }
    }
    results.push({ source, changes, warnings: [], skipped: [] });
  }

  const report = buildReport(timestamp, source, "import", results);

  if (!options.dryRun) {
    const reportPath = path.join(
      targetDir,
      `.migration-report-${timestamp.replace(/[:.]/g, "-")}.json`,
    );
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
    log(`Migration report saved: ${reportPath}`);
  }

  return report;
}

export async function buildInteractiveSelection(
  source: MigrationSource,
): Promise<{
  agents: Array<AgentInfo & { stats: WorkspaceStats }>;
  skills: string[];
  hasSecrets: boolean;
}> {
  const agentInfos = await enumerateSourceAgents(source);
  const agents: Array<AgentInfo & { stats: WorkspaceStats }> = [];

  for (const info of agentInfos) {
    const stats = await computeWorkspaceStats(info.workspaceDir);
    agents.push({ ...info, stats });
  }

  const skills = await enumerateSourceSkills(source);

  let hasSecrets = false;
  const credentialsDir = path.join(source.dir, "credentials");
  if (await dirExists(credentialsDir)) {
    hasSecrets = true;
  }

  return { agents, skills, hasSecrets };
}

export async function runMigration(options: MigrationOptions): Promise<MigrationReport> {
  const { source, targetDir } = await resolveSourceAndTarget(options);
  const scenario = detectScenario(targetDir);

  if (scenario === "fresh") {
    return runFreshMigration(source, targetDir, options);
  }

  const timestamp = new Date().toISOString();
  const log = options.log ?? (() => {});
  const results: MigrationResult[] = [];

  if (!options.dryRun) {
    await fs.mkdir(targetDir, { recursive: true });
    const backupMarker = path.join(targetDir, `.migration-backup-${timestamp.replace(/[:.]/g, "-")}`);
    const metadata = { timestamp, source: source.dir, brand: source.brand };
    await fs.writeFile(backupMarker, JSON.stringify(metadata, null, 2), "utf-8");
    log(`Created migration marker: ${backupMarker}`);
  }

  log(`Migrating config (${source.brand})...`);
  const configResult = await migrateConfig(source, targetDir, { ...options, overwrite: false });
  results.push(configResult);

  log("Migrating workspace...");
  const workspaceResult = await migrateWorkspace(source, targetDir, options, "merge");
  results.push(workspaceResult);

  log("Migrating skills...");
  const skillsResult = await migrateSkills(source, targetDir, options);
  results.push(skillsResult);

  log("Migrating sessions...");
  const sessionsResult = await migrateSessions(source, targetDir, options);
  results.push(sessionsResult);

  const report = buildReport(timestamp, source, "import", results);

  if (!options.dryRun) {
    const reportPath = path.join(
      targetDir,
      `.migration-report-${timestamp.replace(/[:.]/g, "-")}.json`,
    );
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
    log(`Migration report saved: ${reportPath}`);
  }

  return report;
}

export async function previewMigration(
  options: MigrationOptions,
): Promise<MigrationReport> {
  return runMigration({ ...options, dryRun: true });
}
