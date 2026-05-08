import fs from "node:fs/promises";
import path from "node:path";
import type { MigrationChange, MigrationOptions, MigrationResult, MigrationSource } from "./types.js";

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function copyFile(
  src: string,
  dst: string,
  options: MigrationOptions,
  sourceDir: string,
  targetDir: string,
  changes: MigrationChange[],
  skipped: string[],
  warnings: string[],
): Promise<void> {
  const log = options.log ?? (() => {});
  const srcRel = path.relative(sourceDir, src);
  const dstRel = path.relative(targetDir, dst);

  if (await fileExists(dst)) {
    if (!options.overwrite) {
      skipped.push(dstRel);
      return;
    }
  }

  if (options.dryRun) {
    changes.push({ kind: "copy", source: srcRel, target: dstRel, detail: "Would copy file" });
    return;
  }

  try {
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
    changes.push({ kind: "copy", source: srcRel, target: dstRel, detail: "Copied file" });
    log(`Copied: ${srcRel} → ${dstRel}`);
  } catch (err) {
    warnings.push(`Failed to copy ${srcRel}: ${String(err)}`);
  }
}

export async function migrateSessions(
  source: MigrationSource,
  targetDir: string,
  options: MigrationOptions,
): Promise<MigrationResult> {
  const changes: MigrationChange[] = [];
  const warnings: string[] = [];
  const skipped: string[] = [];
  const log = options.log ?? (() => {});

  const sourceSessionDirs = [
    path.join(source.dir, "state", "sessions"),
    path.join(source.dir, "sessions"),
  ];

  let sourceSessionDir: string | null = null;
  for (const candidate of sourceSessionDirs) {
    if (await dirExists(candidate)) {
      sourceSessionDir = candidate;
      break;
    }
  }

  const defaultAgentId = "main";
  const targetSessionDir = path.join(targetDir, "state", "agents", defaultAgentId, "sessions");

  if (sourceSessionDir) {
    if (!options.dryRun) {
      await fs.mkdir(targetSessionDir, { recursive: true });
    }

    for (const storeFile of ["sessions.json", "sessions.json5"]) {
      const srcStore = path.join(sourceSessionDir, storeFile);
      if (!(await fileExists(srcStore))) { continue; }

      const dstStore = path.join(targetSessionDir, "sessions.json");
      const srcRel = path.relative(source.dir, srcStore);
      const dstRel = path.relative(targetDir, dstStore);

      if (await fileExists(dstStore)) {
        if (!options.overwrite) {
          skipped.push(dstRel);
          log(`Session store already exists, skipping: ${dstRel}`);
          continue;
        }

        if (options.dryRun) {
          changes.push({
            kind: "merge",
            source: srcRel,
            target: dstRel,
            detail: "Would merge session stores (most recently updated wins)",
          });
          continue;
        }

        const merged = await mergeSessionStores(srcStore, dstStore);
        if (merged) {
          await fs.writeFile(dstStore, JSON.stringify(merged, null, 2), "utf-8");
          changes.push({
            kind: "merge",
            source: srcRel,
            target: dstRel,
            detail: "Merged session stores (most recently updated wins)",
          });
          log(`Merged session store: ${dstRel}`);
        }
      } else {
        if (options.dryRun) {
          changes.push({ kind: "copy", source: srcRel, target: dstRel, detail: "Would copy session store" });
          continue;
        }

        await fs.mkdir(path.dirname(dstStore), { recursive: true });
        await fs.copyFile(srcStore, dstStore);
        changes.push({ kind: "copy", source: srcRel, target: dstRel, detail: "Copied session store" });
        log(`Copied session store: ${dstRel}`);
      }
    }

    const entries = await fs.readdir(sourceSessionDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) { continue; }
      if (!entry.name.endsWith(".jsonl")) { continue; }

      const src = path.join(sourceSessionDir, entry.name);
      const dst = path.join(targetSessionDir, entry.name);
      const srcRel = path.relative(source.dir, src);
      const dstRel = path.relative(targetDir, dst);

      if (await fileExists(dst)) {
        skipped.push(dstRel);
        continue;
      }

      if (options.dryRun) {
        changes.push({ kind: "move", source: srcRel, target: dstRel, detail: "Would move transcript" });
        continue;
      }

      try {
        await fs.copyFile(src, dst);
        changes.push({ kind: "move", source: srcRel, target: dstRel, detail: "Copied transcript" });
        log(`Copied transcript: ${entry.name}`);
      } catch (err) {
        warnings.push(`Failed to copy transcript ${entry.name}: ${String(err)}`);
      }
    }
  }

  const srcApprovals = path.join(source.dir, "state", "exec-approvals.json");
  if (await fileExists(srcApprovals)) {
    const dstApprovals = path.join(targetDir, "state", "exec-approvals.json");
    await copyFile(srcApprovals, dstApprovals, options, source.dir, targetDir, changes, skipped, warnings);
  }

  const srcHooksDir = path.join(source.dir, "hooks");
  if (await dirExists(srcHooksDir)) {
    const dstHooksDir = path.join(targetDir, "hooks");
    const hookEntries = await fs.readdir(srcHooksDir, { withFileTypes: true });
    for (const entry of hookEntries) {
      if (!entry.isFile()) { continue; }
      const src = path.join(srcHooksDir, entry.name);
      const dst = path.join(dstHooksDir, entry.name);
      await copyFile(src, dst, options, source.dir, targetDir, changes, skipped, warnings);
    }
  }

  const srcCronFile = path.join(source.dir, "cron", "jobs.json");
  if (await fileExists(srcCronFile)) {
    const dstCronFile = path.join(targetDir, "cron", "jobs.json");
    await copyFile(srcCronFile, dstCronFile, options, source.dir, targetDir, changes, skipped, warnings);
    warnings.push("Cron jobs migrated; KaijiBot uses ProactiveScheduler instead of cron. Review jobs.json for compatibility.");
  }

  if (options.migrateSecrets) {
    const srcCredentialsDir = path.join(source.dir, "credentials");
    if (await dirExists(srcCredentialsDir)) {
      const dstCredentialsDir = path.join(targetDir, "credentials");
      const credEntries = await fs.readdir(srcCredentialsDir, { withFileTypes: true });
      for (const entry of credEntries) {
        if (!entry.isFile()) { continue; }
        const src = path.join(srcCredentialsDir, entry.name);
        const dst = path.join(dstCredentialsDir, entry.name);
        await copyFile(src, dst, options, source.dir, targetDir, changes, skipped, warnings);
      }
      warnings.push("Credentials were migrated. Verify permissions and rotate any compromised keys.");
    }

    const srcEnvFile = path.join(source.dir, ".env");
    if (await fileExists(srcEnvFile)) {
      const dstEnvFile = path.join(targetDir, ".env");
      await copyFile(srcEnvFile, dstEnvFile, options, source.dir, targetDir, changes, skipped, warnings);
      warnings.push("Environment file (.env) was migrated. Review for stale or leaked secrets.");
    }
  } else {
    const srcCredentialsDir = path.join(source.dir, "credentials");
    if (await dirExists(srcCredentialsDir)) {
      skipped.push(path.relative(source.dir, srcCredentialsDir));
      log("Credentials directory found but not migrated (use --migrate-secrets to include).");
    }
    const srcEnvFile = path.join(source.dir, ".env");
    if (await fileExists(srcEnvFile)) {
      skipped.push(path.relative(source.dir, srcEnvFile));
      log(".env file found but not migrated (use --migrate-secrets to include).");
    }
  }

  return { source, changes, warnings, skipped };
}

async function mergeSessionStores(
  srcPath: string,
  dstPath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const srcRaw = await fs.readFile(srcPath, "utf-8");
    const dstRaw = await fs.readFile(dstPath, "utf-8");
    const srcStore = JSON.parse(srcRaw) as Record<string, SessionEntryLike>;
    const dstStore = JSON.parse(dstRaw) as Record<string, SessionEntryLike>;

    const merged: Record<string, unknown> = { ...dstStore };

    for (const [key, srcEntry] of Object.entries(srcStore)) {
      const dstEntry = merged[key] as SessionEntryLike | undefined;
      if (!dstEntry) {
        merged[key] = srcEntry;
        continue;
      }

      const srcUpdated = typeof srcEntry.updatedAt === "number" ? srcEntry.updatedAt : 0;
      const dstUpdated = typeof dstEntry.updatedAt === "number" ? dstEntry.updatedAt : 0;
      if (srcUpdated > dstUpdated) {
        merged[key] = srcEntry;
      }
    }

    return merged;
  } catch {
    return null;
  }
}

type SessionEntryLike = {
  sessionId?: string;
  updatedAt?: number;
} & Record<string, unknown>;
