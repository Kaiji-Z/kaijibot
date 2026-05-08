import fs from "node:fs/promises";
import path from "node:path";
import type { MigrationChange, MigrationOptions, MigrationResult, MigrationSource } from "./types.js";

const BRAND_REFERENCES = /\b(openclaw|OpenClaw|clawdbot|ClawdBot|moltbot|MoltBot)\b/g;
const MIGRATION_BANNER = "<!-- Migrated from OpenClaw. Review for brand references. -->\n";

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function migrateSkills(
  source: MigrationSource,
  targetDir: string,
  options: MigrationOptions,
): Promise<MigrationResult> {
  const changes: MigrationChange[] = [];
  const warnings: string[] = [];
  const skipped: string[] = [];
  const log = options.log ?? (() => {});

  const sourceSkillsDir = path.join(source.dir, "skills");
  const targetSkillsDir = path.join(targetDir, "skills");

  if (!(await dirExists(sourceSkillsDir))) {
    log("No skills directory found in source.");
    return { source, changes, warnings, skipped };
  }

  const entries = await fs.readdir(sourceSkillsDir, { withFileTypes: true });
  const skillDirs = entries.filter((e) => e.isDirectory());

  if (skillDirs.length === 0) {
    log("No skills found in source directory.");
    return { source, changes, warnings, skipped };
  }

  for (const skillDir of skillDirs) {
    const skillName = skillDir.name;
    const srcSkillPath = path.join(sourceSkillsDir, skillName);
    const srcSkillFile = path.join(srcSkillPath, "SKILL.md");

    if (!(await fileExists(srcSkillFile))) {
      log(`Skipping non-skill directory: ${skillName}`);
      continue;
    }

    const dstSkillPath = path.join(targetSkillsDir, skillName);
    const srcRel = path.relative(source.dir, srcSkillPath);
    const dstRel = path.relative(targetDir, dstSkillPath);
    const dstExists = await dirExists(dstSkillPath);

    if (dstExists && !options.overwrite) {
      skipped.push(dstRel);
      log(`Skill already exists, skipping: ${skillName}`);
      continue;
    }

    if (dstExists && options.overwrite) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupName = `${skillName}.backup.${timestamp}`;
      const backupPath = path.join(targetSkillsDir, backupName);

      if (!options.dryRun) {
        await fs.rename(dstSkillPath, backupPath);
        log(`Backed up existing skill: ${skillName} → ${backupName}`);
      }
      changes.push({
        kind: "move",
        source: dstRel,
        target: path.relative(targetDir, backupPath),
        detail: `Backed up existing skill to ${backupName}`,
      });
    }

    if (options.dryRun) {
      changes.push({
        kind: "copy",
        source: srcRel,
        target: dstRel,
        detail: "Would copy skill directory",
      });
      continue;
    }

    await fs.mkdir(targetSkillsDir, { recursive: true });
    await copyDirRecursive(srcSkillPath, dstSkillPath);

    const dstSkillFile = path.join(dstSkillPath, "SKILL.md");
    const skillContent = await fs.readFile(dstSkillFile, "utf-8");
    if (BRAND_REFERENCES.test(skillContent)) {
      await fs.writeFile(dstSkillFile, MIGRATION_BANNER + skillContent, "utf-8");
      log(`Added migration banner to skill: ${skillName}`);
    }

    changes.push({
      kind: "copy",
      source: srcRel,
      target: dstRel,
      detail: "Copied skill directory",
    });
    log(`Copied skill: ${skillName}`);
  }

  return { source, changes, warnings, skipped };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
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
