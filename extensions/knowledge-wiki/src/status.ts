import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type WikiStatus = {
  vaultPath: string;
  vaultExists: boolean;
  pageCounts: Record<string, number>;
  totalPages: number;
  lastActivity: string | null;
};

export async function resolveWikiStatus(vaultRoot: string): Promise<WikiStatus> {
  const dirs = ["summaries", "entities", "concepts"];
  const pageCounts: Record<string, number> = {};
  let totalPages = 0;
  let vaultExists = false;

  for (const dir of dirs) {
    const dirPath = path.join(vaultRoot, dir);
    try {
      const entries = await readdir(dirPath);
      const count = entries.filter((e) => e.endsWith(".md")).length;
      pageCounts[dir] = count;
      totalPages += count;
      vaultExists = true;
    } catch {
      pageCounts[dir] = 0;
    }
  }

  let lastActivity: string | null = null;
  try {
    const logContent = await readFile(path.join(vaultRoot, "log.md"), "utf8");
    const lines = logContent.split("\n").filter((l) => l.startsWith("## ["));
    if (lines.length > 0) {
      const match = lines[lines.length - 1]!.match(/^## \[([^\]]+)\]/);
      if (match && match[1]) {
        lastActivity = match[1];
      }
    }
  } catch {
    // no log yet
  }

  return {
    vaultPath: vaultRoot,
    vaultExists,
    pageCounts,
    totalPages,
    lastActivity,
  };
}

export function renderWikiStatus(status: WikiStatus): string {
  if (!status.vaultExists) {
    return `Wiki vault not initialized at: ${status.vaultPath}`;
  }
  const lines = [
    "Wiki Vault Status",
    `  Path: ${status.vaultPath}`,
    `  Pages: ${status.totalPages}`,
    `  Summaries: ${status.pageCounts.summaries ?? 0}`,
    `  Entities: ${status.pageCounts.entities ?? 0}`,
    `  Concepts: ${status.pageCounts.concepts ?? 0}`,
    `  Last activity: ${status.lastActivity ?? "none"}`,
  ];
  return lines.join("\n");
}
