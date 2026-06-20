import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SourceFile } from "./types.js";
import type { WikiConfig } from "./config.js";

const HARDCODED_EXCLUDE_DIRS = new Set([
  ".git",
  "node_modules",
  ".kaijibot",
  "wiki",
  "sessions",
  ".pnpm-store",
  ".venv",
  "venv",
  "dist",
  "build",
  "__pycache__",
  ".cache",
  ".turbo",
  "coverage",
]);

const HARDCODED_EXCLUDE_PATTERNS: readonly RegExp[] = [
  /\.env/i,
  /\.pem$/i,
  /\.key$/i,
  /\.secret$/i,
];

const MEMORY_LOG_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}\.md$/;

export type ScanResult = {
  readonly files: readonly SourceFile[];
  readonly skipped: number;
  readonly errors: readonly string[];
};

export async function scanWorkspace(
  workspaceDir: string,
  config: WikiConfig,
): Promise<ScanResult> {
  const allowedExtensions = new Set(config.scan.extensions);
  const excludeDirs = new Set([...HARDCODED_EXCLUDE_DIRS, ...config.scan.excludeDirs]);
  const excludePatterns: RegExp[] = [
    ...HARDCODED_EXCLUDE_PATTERNS,
    ...config.scan.excludePatterns.map((p) => new RegExp(p)),
  ];
  const maxFileSize = config.scan.maxFileSize;
  const includeMemoryCurated = config.scan.includeMemoryCurated;

  const files: SourceFile[] = [];
  const errors: string[] = [];
  let skipped = 0;

  async function walkDir(dir: string, relativeBase: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) {
          continue;
        }
        if (relativePath === "memory/dialogues") {
          continue;
        }
        if (relativePath === "memory/topics/archive") {
          continue;
        }
        await walkDir(fullPath, relativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!allowedExtensions.has(ext)) {
        skipped++;
        continue;
      }

      if (relativePath === "MEMORY.md" || relativePath === "memory.md") {
        if (!includeMemoryCurated) {
          skipped++;
          continue;
        }
      } else if (relativePath.startsWith("memory/")) {
        const filename = path.basename(relativePath);
        if (MEMORY_LOG_DATE_PATTERN.test(filename)) {
          skipped++;
          continue;
        }
        if (relativePath.startsWith("memory/dialogues/")) {
          skipped++;
          continue;
        }
        if (relativePath.startsWith("memory/topics/") && !includeMemoryCurated) {
          skipped++;
          continue;
        }
      }

      if (excludePatterns.some((p) => p.test(relativePath))) {
        skipped++;
        continue;
      }

      let fileStat;
      try {
        fileStat = await stat(fullPath);
      } catch {
        errors.push(`stat failed: ${relativePath}`);
        continue;
      }
      if (fileStat.size > maxFileSize) {
        skipped++;
        continue;
      }

      files.push({
        absolutePath: fullPath,
        relativePath,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
      });
    }
  }

  await walkDir(workspaceDir, "");

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return { files, skipped, errors };
}

export async function readFileContent(absolutePath: string): Promise<string> {
  const buffer = await readFile(absolutePath);
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      throw new Error(`Binary file detected: ${absolutePath}`);
    }
  }
  return buffer.toString("utf8");
}
