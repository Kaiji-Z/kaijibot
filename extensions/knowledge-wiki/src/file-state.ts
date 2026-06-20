import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import type { FileStateEntry, FileStateMap } from "./types.js";

const STATE_FILE = "file-state.json";

function stateFilePath(vaultRoot: string): string {
  return path.join(vaultRoot, ".kaijibot-wiki", STATE_FILE);
}

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function loadFileState(vaultRoot: string): Promise<FileStateMap> {
  const statePath = stateFilePath(vaultRoot);
  let raw: string;
  try {
    raw = await readFile(statePath, "utf8");
  } catch {
    return new Map();
  }

  try {
    const parsed = JSON.parse(raw) as Array<FileStateEntry>;
    const map = new Map<string, FileStateEntry>();
    for (const entry of parsed) {
      if (entry && typeof entry.path === "string" && typeof entry.hash === "string") {
        map.set(entry.path, entry);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function saveFileState(
  vaultRoot: string,
  stateMap: Map<string, FileStateEntry>,
): Promise<void> {
  const statePath = stateFilePath(vaultRoot);
  await mkdir(path.dirname(statePath), { recursive: true });
  const entries = [...stateMap.values()];
  const tmpPath = `${statePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(entries, null, 2), "utf8");
  await rename(tmpPath, statePath);
}

export function isFileChanged(
  stateMap: FileStateMap,
  relativePath: string,
  currentHash: string,
): boolean {
  const existing = stateMap.get(relativePath);
  if (!existing) {
    return true;
  }
  return existing.hash !== currentHash;
}

export function updateEntry(
  stateMap: Map<string, FileStateEntry>,
  relativePath: string,
  hash: string,
  pageIds: readonly string[],
): void {
  stateMap.set(relativePath, {
    path: relativePath,
    hash,
    lastIngestedAt: new Date().toISOString(),
    pageIds,
  });
}

export function removeStaleEntries(
  stateMap: Map<string, FileStateEntry>,
  validPaths: ReadonlySet<string>,
): number {
  let removed = 0;
  for (const key of stateMap.keys()) {
    if (!validPaths.has(key)) {
      stateMap.delete(key);
      removed++;
    }
  }
  return removed;
}
