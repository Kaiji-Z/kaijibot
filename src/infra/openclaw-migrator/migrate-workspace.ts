import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  MigrationChange,
  MigrationOptions,
  MigrationResult,
  MigrationSource,
} from "./types.js";
import type { MemoryMergeStrategy } from "./types.js";

const WORKSPACE_BLACKLIST = new Set([".qmd", ".vectors", "memory.db"]);

const MEMORY_BUDGET_BYTES = 4 * 1024;

function fileHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function copyFileIfDifferent(
  src: string,
  dst: string,
  options: MigrationOptions,
  sourceDir: string,
  targetDir: string,
  changes: MigrationChange[],
  skipped: string[],
): Promise<void> {
  const log = options.log ?? (() => {});
  const srcRel = path.relative(sourceDir, src);
  const dstRel = path.relative(targetDir, dst);

  const srcExists = await fileExists(src);
  if (!srcExists) { return; }

  const dstExists = await fileExists(dst);

  if (dstExists && !options.overwrite) {
    skipped.push(dstRel);
    return;
  }

  const srcContent = await fs.readFile(src, "utf-8");

  if (dstExists) {
    const dstContent = await fs.readFile(dst, "utf-8");
    if (fileHash(dstContent) === fileHash(srcContent)) {
      log(`Identical content, skipping: ${dstRel}`);
      return;
    }
  }

  if (options.dryRun) {
    changes.push({ kind: "copy", source: srcRel, target: dstRel, detail: "Would copy file" });
    return;
  }

  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
  changes.push({ kind: "copy", source: srcRel, target: dstRel, detail: "Copied file" });
  log(`Copied: ${srcRel} → ${dstRel}`);
}

async function copyWorkspaceRecursive(
  srcDir: string,
  dstDir: string,
  options: MigrationOptions,
  sourceDir: string,
  targetDir: string,
  changes: MigrationChange[],
  skipped: string[],
  skipMemoryMd: boolean,
): Promise<void> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    if (WORKSPACE_BLACKLIST.has(entry.name)) { continue; }

    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);

    if (entry.isDirectory()) {
      await copyWorkspaceRecursive(
        src, dst, options, sourceDir, targetDir, changes, skipped, skipMemoryMd,
      );
    } else if (entry.isFile()) {
      if (skipMemoryMd && entry.name === "MEMORY.md") { continue; }
      await copyFileIfDifferent(src, dst, options, sourceDir, targetDir, changes, skipped);
    }
  }
}

async function mergeMemoryFile(
  sourceWorkspace: string,
  targetWorkspace: string,
  source: MigrationSource,
  options: MigrationOptions,
  changes: MigrationChange[],
  warnings: string[],
  skipped: string[],
): Promise<void> {
  const srcMemoryFile = path.join(sourceWorkspace, "MEMORY.md");
  const dstMemoryFile = path.join(targetWorkspace, "MEMORY.md");
  const srcMemoryExists = await fileExists(srcMemoryFile);

  if (!srcMemoryExists) { return; }

  const srcContent = await fs.readFile(srcMemoryFile, "utf-8");
  const srcRel = path.relative(source.dir, srcMemoryFile);
  const dstRel = path.relative(path.dirname(targetWorkspace), dstMemoryFile);
  const dstMemoryExists = await fileExists(dstMemoryFile);

  let contentToWrite: string;
  if (dstMemoryExists) {
    if (!options.overwrite) {
      const dstContent = await fs.readFile(dstMemoryFile, "utf-8");
      const srcHeaders = extractMarkdownHeaders(srcContent);
      const dstHeaders = new Set(extractMarkdownHeaders(dstContent));
      const newSections = srcHeaders.filter((h) => !dstHeaders.has(h));

      if (newSections.length === 0) {
        skipped.push(dstRel);
        return;
      }

      const appendedContent = extractSectionsByHeaders(srcContent, newSections);
      contentToWrite = dstContent + "\n\n" + appendedContent;
    } else {
      const dstContent = await fs.readFile(dstMemoryFile, "utf-8");
      contentToWrite = dstContent + "\n\n" + srcContent;
    }
  } else {
    contentToWrite = srcContent;
  }

  if (Buffer.byteLength(contentToWrite, "utf-8") > MEMORY_BUDGET_BYTES) {
    contentToWrite = truncateToBudget(contentToWrite, MEMORY_BUDGET_BYTES);
    warnings.push("MEMORY.md exceeded 4KB budget; truncated older entries");
  }

  if (options.dryRun) {
    changes.push({
      kind: "merge",
      source: srcRel,
      target: dstRel,
      detail: dstMemoryExists ? "Would merge MEMORY.md sections" : "Would create MEMORY.md",
    });
  } else {
    await fs.mkdir(path.dirname(dstMemoryFile), { recursive: true });
    await fs.writeFile(dstMemoryFile, contentToWrite, "utf-8");
    changes.push({
      kind: "merge",
      source: srcRel,
      target: dstRel,
      detail: dstMemoryExists ? "Merged MEMORY.md sections" : "Created MEMORY.md",
    });
  }
}

async function migrateWorkspaceDir(
  sourceWorkspace: string,
  targetWorkspace: string,
  source: MigrationSource,
  options: MigrationOptions,
  memoryMergeStrategy: MemoryMergeStrategy,
): Promise<{ changes: MigrationChange[]; warnings: string[]; skipped: string[] }> {
  const changes: MigrationChange[] = [];
  const warnings: string[] = [];
  const skipped: string[] = [];

  const wsExists = await dirExists(sourceWorkspace);
  if (!wsExists) {
    return { changes, warnings, skipped };
  }

  if (!options.dryRun) {
    await fs.mkdir(targetWorkspace, { recursive: true });
  }

  const skipMemoryMd = memoryMergeStrategy === "merge";
  await copyWorkspaceRecursive(
    sourceWorkspace,
    targetWorkspace,
    options,
    source.dir,
    path.dirname(targetWorkspace),
    changes,
    skipped,
    skipMemoryMd,
  );

  if (memoryMergeStrategy === "merge") {
    await mergeMemoryFile(
      sourceWorkspace, targetWorkspace, source, options, changes, warnings, skipped,
    );
  }

  return { changes, warnings, skipped };
}

function extractMarkdownHeaders(content: string): string[] {
  const headers: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headers.push(match[2].trim());
    }
  }
  return headers;
}

function extractSectionsByHeaders(content: string, headers: string[]): string {
  const lines = content.split("\n");
  const headerSet = new Set(headers);
  const result: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      capturing = headerSet.has(match[2].trim());
    }
    if (capturing) {
      result.push(line);
    }
  }

  return result.join("\n").trim();
}

function truncateToBudget(content: string, budgetBytes: number): string {
  const sections = content.split(/\n(?=#{1,6}\s)/);
  const kept: string[] = [];
  let totalBytes = 0;

  for (let i = sections.length - 1; i >= 0; i--) {
    const sectionBytes = Buffer.byteLength(sections[i], "utf-8");
    if (totalBytes + sectionBytes > budgetBytes) { break; }
    totalBytes += sectionBytes;
    kept.unshift(sections[i]);
  }

  if (kept.length === 0 && sections.length > 0) {
    kept.push(sections[sections.length - 1]);
  }

  return kept.join("\n").trim();
}

export async function migrateWorkspace(
  source: MigrationSource,
  targetDir: string,
  options: MigrationOptions,
  memoryMergeStrategy: MemoryMergeStrategy = "merge",
): Promise<MigrationResult> {
  const allChanges: MigrationChange[] = [];
  const allWarnings: string[] = [];
  const allSkipped: string[] = [];
  const log = options.log ?? (() => {});

  const sourceWorkspace = path.join(source.dir, "workspace");
  const targetWorkspace = path.join(targetDir, "workspace");

  const defaultResult = await migrateWorkspaceDir(
    sourceWorkspace,
    targetWorkspace,
    source,
    options,
    memoryMergeStrategy,
  );
  allChanges.push(...defaultResult.changes);
  allWarnings.push(...defaultResult.warnings);
  allSkipped.push(...defaultResult.skipped);

  let sourceConfig: Record<string, unknown> | null = null;
  try {
    const raw = await fs.readFile(source.configPath, "utf-8");
    sourceConfig = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // No config to read agent list from.
  }

  if (sourceConfig) {
    const agents = sourceConfig.agents as Record<string, unknown> | undefined;
    const agentList = agents?.list as Array<Record<string, unknown>> | undefined;
    if (agentList && Array.isArray(agentList)) {
      for (const agent of agentList) {
        const agentId = typeof agent.id === "string" ? agent.id : "";
        if (!agentId) { continue; }

        const agentWorkspace = typeof agent.workspace === "string"
          ? path.resolve(source.dir, agent.workspace)
          : path.join(source.dir, `workspace-${agentId}`);
        const targetAgentWorkspace = path.join(targetDir, `workspace-${agentId}`);

        const agentResult = await migrateWorkspaceDir(
          agentWorkspace,
          targetAgentWorkspace,
          source,
          options,
          memoryMergeStrategy,
        );
        allChanges.push(...agentResult.changes);
        allWarnings.push(...agentResult.warnings);
        allSkipped.push(...agentResult.skipped);
      }
    }
  }

  const qmdDir = path.join(sourceWorkspace, ".qmd");
  const vectorDir = path.join(sourceWorkspace, ".vectors");
  const dbFile = path.join(sourceWorkspace, "memory.db");
  for (const nonMigratable of [qmdDir, vectorDir, dbFile]) {
    const exists = await fileExists(nonMigratable);
    if (!exists) {
      const dexists = await dirExists(nonMigratable);
      if (dexists) {
        const rel = path.relative(source.dir, nonMigratable);
        log(`Skipping non-migratable data: ${rel} (must be rebuilt)`);
        allSkipped.push(rel);
      }
    } else {
      const rel = path.relative(source.dir, nonMigratable);
      log(`Skipping non-migratable data: ${rel} (must be rebuilt)`);
      allSkipped.push(rel);
    }
  }

  return { source, changes: allChanges, warnings: allWarnings, skipped: allSkipped };
}
