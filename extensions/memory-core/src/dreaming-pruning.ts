import fs from "node:fs/promises";
import path from "node:path";
import type { KaijiBotConfig } from "kaijibot/plugin-sdk/memory-core";
import { writeDailyDreamingPhaseBlock } from "./dreaming-markdown.js";
import { isExcludedMemoryContent } from "./memory-types.js";
import { textSimilarity } from "./memory/mmr.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type MemoryPruningConfig = {
  enabled: boolean;
  /** Dedup similarity threshold for merging promoted entries. Default: 0.9 */
  dedupSimilarity: number;
};

export const DEFAULT_PRUNING_CONFIG: MemoryPruningConfig = {
  enabled: true,
  dedupSimilarity: 0.9,
};

export function resolveMemoryPruningConfig(_params: {
  pluginConfig?: Record<string, unknown>;
  cfg?: KaijiBotConfig;
}): MemoryPruningConfig {
  return { ...DEFAULT_PRUNING_CONFIG };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type PromotedEntry = {
  /** The full line including the marker */
  rawLine: string;
  /** The marker comment (e.g., <!-- kaijibot-memory-promotion:... -->) */
  marker: string;
  /** The content line after the marker */
  content: string;
  /** Line index in MEMORY.md */
  lineIndex: number;
};

const PROMOTION_MARKER_RE = /<!--\s*kaijibot-memory-promotion:([^>]+)\s*-->/;
const PROMOTED_LINE_RE = /^- (.+?)\s*\[score=/;

export function parsePromotedEntries(lines: string[]): PromotedEntry[] {
  const entries: PromotedEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const markerMatch = PROMOTION_MARKER_RE.exec(line);
    if (markerMatch) {
      // Next non-empty line is the content
      const contentLine = lines.slice(i + 1).find((l) => l.trim().length > 0) ?? "";
      const contentMatch = PROMOTED_LINE_RE.exec(contentLine);
      entries.push({
        rawLine: line,
        marker: markerMatch[0],
        content:
          contentMatch?.[1]
          ?? contentLine.replace(/^-\s*/, "").replace(/\s*\[score=.*\]/, ""),
        lineIndex: i,
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Pure pruning logic
// ---------------------------------------------------------------------------

/**
 * Prune promoted memories in MEMORY.md:
 * 1. Remove entries whose content matches exclusion rules
 * 2. Merge near-duplicate entries (similarity > threshold)
 * 3. Keep the higher-scored entry from each duplicate pair
 */
export function prunePromotedEntries(
  entries: PromotedEntry[],
  config: Partial<MemoryPruningConfig> = {},
): { kept: PromotedEntry[]; removed: PromotedEntry[]; reasons: string[] } {
  const resolved = { ...DEFAULT_PRUNING_CONFIG, ...config };
  const removed: PromotedEntry[] = [];
  const reasons: string[] = [];

  const afterExclusion = entries.filter((entry) => {
    if (isExcludedMemoryContent(entry.content)) {
      removed.push(entry);
      reasons.push(`Excluded: "${entry.content.slice(0, 60)}..."`);
      return false;
    }
    return true;
  });

  // Step 2: Deduplicate by similarity
  const dedupThreshold = resolved.dedupSimilarity;
  const toRemove = new Set<number>();
  for (let i = 0; i < afterExclusion.length; i++) {
    if (toRemove.has(i)) continue;
    for (let j = i + 1; j < afterExclusion.length; j++) {
      if (toRemove.has(j)) continue;
      const sim = textSimilarity(afterExclusion[i].content, afterExclusion[j].content);
      if (sim >= dedupThreshold) {
        // Remove the lower-scored one (assume first is higher scored based on MEMORY.md order)
        toRemove.add(j);
        removed.push(afterExclusion[j]);
        reasons.push(
          `Duplicate of "${afterExclusion[i].content.slice(0, 40)}..." (sim=${sim.toFixed(2)})`,
        );
      }
    }
  }

  const kept = afterExclusion.filter((_, i) => !toRemove.has(i));
  return { kept, removed, reasons };
}

// ---------------------------------------------------------------------------
// Full phase runner
// ---------------------------------------------------------------------------

export async function runPruningPhase(params: {
  workspaceDir: string;
  pluginConfig?: Record<string, unknown>;
  cfg?: KaijiBotConfig;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  nowMs?: number;
  storage: { mode: "inline" | "separate" | "both"; separateReports: boolean };
  timezone?: string;
}): Promise<{ pruned: number; kept: number }> {
  const config = resolveMemoryPruningConfig(params);
  if (!config.enabled) {
    params.logger.info("memory-core: pruning disabled, skipping.");
    return { pruned: 0, kept: 0 };
  }

  const memoryMdPath = path.join(params.workspaceDir, "MEMORY.md");
  const content = await fs.readFile(memoryMdPath, "utf-8").catch(() => null);
  if (!content) {
    params.logger.info("memory-core: no MEMORY.md found, pruning skipped.");
    return { pruned: 0, kept: 0 };
  }

  const lines = content.split("\n");
  const entries = parsePromotedEntries(lines);

  if (entries.length === 0) {
    params.logger.info("memory-core: no promoted entries to prune.");
    return { pruned: 0, kept: 0 };
  }

  const { kept, removed, reasons } = prunePromotedEntries(entries, config);

  if (removed.length === 0) {
    params.logger.info("memory-core: pruning found no entries to remove.");
    return { pruned: 0, kept: entries.length };
  }

  // Rebuild MEMORY.md without removed entries (marker line + content line)
  const removedLines = new Set(
    removed.flatMap((e) => {
      const result = [e.lineIndex];
      if (e.lineIndex + 1 < lines.length) {
        result.push(e.lineIndex + 1);
      }
      return result;
    }),
  );

  const newLines = lines.filter((_, i) => !removedLines.has(i));
  await fs.writeFile(memoryMdPath, newLines.join("\n"), "utf-8");

  // Write pruning report
  const reportLines =
    removed.length > 0
      ? [
          `Pruned ${removed.length} entries from MEMORY.md:`,
          ...reasons.map((r) => `- ${r}`),
          `Kept ${kept.length} entries.`,
        ]
      : ["No entries pruned."];

  await writeDailyDreamingPhaseBlock({
    workspaceDir: params.workspaceDir,
    phase: "prune",
    bodyLines: reportLines,
    nowMs: params.nowMs,
    timezone: params.timezone,
    storage: params.storage,
  });

  params.logger.info(`memory-core: pruning removed ${removed.length} entries, kept ${kept.length}.`);
  return { pruned: removed.length, kept: kept.length };
}
