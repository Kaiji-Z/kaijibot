import fs from "node:fs/promises";
import path from "node:path";

export type KnowledgeWikiLogEntry = {
  type: "init" | "ingest" | "query" | "lint" | "digest";
  timestamp: string;
  sourcePath?: string;
  details?: readonly string[];
};

export async function appendKnowledgeWikiLog(
  vaultRoot: string,
  entry: KnowledgeWikiLogEntry,
): Promise<void> {
  const logPath = path.join(vaultRoot, ".kaijibot-wiki", "log.jsonl");
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function appendWikiLogMarkdown(
  vaultRoot: string,
  entry: KnowledgeWikiLogEntry,
): Promise<void> {
  const logPath = path.join(vaultRoot, "log.md");
  const date = entry.timestamp.slice(0, 10);
  const time = entry.timestamp.slice(11, 19);
  const source = entry.sourcePath ? ` | ${entry.sourcePath}` : "";
  const details = entry.details && entry.details.length > 0 ? ` | ${entry.details.join(", ")}` : "";
  const line = `## [${date} ${time}] ${entry.type}${source}${details}\n\n`;
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, line, "utf8");
}

export async function appendWikiLog(
  vaultRoot: string,
  entry: KnowledgeWikiLogEntry,
): Promise<void> {
  await Promise.all([
    appendKnowledgeWikiLog(vaultRoot, entry),
    appendWikiLogMarkdown(vaultRoot, entry),
  ]);
}
