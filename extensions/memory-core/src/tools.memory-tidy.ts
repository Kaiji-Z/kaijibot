/**
 * Memory Tidy — maintenance tool for organizing, deduplicating, and
 * rebalancing memory topic files.  Runs automatically after Dreaming
 * Deep Sleep or can be invoked manually via the `memory_tidy` agent tool.
 */

import { Type } from "@sinclair/typebox";
import path from "node:path";
import {
  jsonResult,
  readStringParam,
  resolveMemorySearchConfig,
  resolveSessionAgentId,
  type AnyAgentTool,
  type KaijiBotConfig,
} from "kaijibot/plugin-sdk/memory-core-host-runtime-core";
import { jaccardSimilarity, tokenize } from "./memory/mmr.js";
import { MemoryIndexManager } from "./memory-index.js";
import { type TopicEntry } from "./topic-types.js";
import { TopicManager, createTopicManager, type TopicManagerDeps } from "./topic-manager.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const MemoryTidySchema = Type.Object({
  action: Type.Union([
    Type.Literal("dedup"),
    Type.Literal("merge"),
    Type.Literal("rebalance"),
    Type.Literal("archive"),
    Type.Literal("full"),
  ]),
  target: Type.Optional(
    Type.String({ description: "Specific topic file to tidy (without .md)" }),
  ),
  dryRun: Type.Optional(
    Type.Boolean({ description: "Preview changes without writing" }),
  ),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TidyAction = "dedup" | "merge" | "rebalance" | "archive" | "full";

export interface MemoryTidyDeps {
  topicManager: TopicManager;
  indexManager: MemoryIndexManager;
  fs: {
    readFile: (filePath: string) => Promise<string>;
    mkdir: (filePath: string, options: { recursive: boolean }) => Promise<void>;
    rename: (oldPath: string, newPath: string) => Promise<void>;
  };
  workspaceDir: string;
}

export interface TidyResult {
  action: string;
  filesAffected: number;
  entriesAffected: number;
  changes: string[];
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEDUP_THRESHOLD = 0.85;
const MERGE_THRESHOLD = 0.7;
const ARCHIVE_THRESHOLD_DAYS = 90;
const REBALANCE_BUDGET_BYTES = 25_000;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function computeJaccard(a: string, b: string): number {
  return jaccardSimilarity(tokenize(a), tokenize(b));
}

function isTidyEnabled(pluginConfig: Record<string, unknown> | undefined): boolean {
  if (!pluginConfig || typeof pluginConfig !== "object") {return true;}
  const tidy = pluginConfig["tidy"];
  if (!tidy || typeof tidy !== "object") {return true;}
  return (tidy as Record<string, unknown>)["autoAfterDreaming"] !== false;
}

// ---------------------------------------------------------------------------
// Action: dedup
// ---------------------------------------------------------------------------

async function actionDedup(
  deps: MemoryTidyDeps,
  target: string | undefined,
  dryRun: boolean,
): Promise<TidyResult> {
  const changes: string[] = [];
  let filesAffected = 0;
  let entriesAffected = 0;

  const normalizedName = target?.replace(/\.md$/i, "");
  const topicFileNames = normalizedName
    ? [`${normalizedName}.md`]
    : await deps.topicManager.listTopics();

  for (const fileName of topicFileNames) {
    const name = fileName.replace(/\.md$/, "");
    const topic = await deps.topicManager.getTopic(name);
    if (!topic || topic.entries.length < 2) {continue;}

    const { entries } = topic;

    // Union-find on indices to group similar entries
    const parent = entries.map((_, i) => i);

    function find(x: number): number {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]!]!;
        x = parent[x]!;
      }
      return x;
    }

    function union(a: number, b: number): void {
      parent[find(a)] = find(b);
    }

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (computeJaccard(entries[i]!.content, entries[j]!.content) >= DEDUP_THRESHOLD) {
          union(i, j);
        }
      }
    }

    // Group by root
    const groupMap = new Map<number, number[]>();
    for (let i = 0; i < entries.length; i++) {
      const root = find(i);
      let group = groupMap.get(root);
      if (!group) {
        group = [];
        groupMap.set(root, group);
      }
      group.push(i);
    }

    // Process merge groups — one group per file per call to avoid index shifting
    for (const indices of groupMap.values()) {
      if (indices.length <= 1) {continue;}

      // Sort by date descending (newest first = keeper)
      const sorted = [...indices].toSorted((a, b) =>
        entries[b]!.date.localeCompare(entries[a]!.date),
      );

      const keptIdx = sorted[0]!;
      const absorbedIndices = sorted.slice(1);
      const keptEntry = entries[keptIdx]!;

      const mergedContent = buildDedupMergedContent(entries, keptIdx, absorbedIndices);

      filesAffected++;
      entriesAffected += absorbedIndices.length;

      const absorbedTitles = absorbedIndices.map((i) => entries[i]!.title);
      changes.push(
        `${name}: merged "${absorbedTitles.join('", "')}" into "${keptEntry.title}"`,
      );

      if (!dryRun) {
        await deps.topicManager.mergeEntries(name, sorted, mergedContent);
      }

      // Only process first group per file to keep indices stable
      break;
    }
  }

  return { action: "dedup", filesAffected, entriesAffected, changes, dryRun };
}

function buildDedupMergedContent(
  entries: TopicEntry[],
  keptIdx: number,
  absorbedIndices: number[],
): string {
  const parts: string[] = [entries[keptIdx]!.content];
  for (const i of absorbedIndices) {
    const e = entries[i]!;
    parts.push(`--- From: ${e.title} (${e.date}) ---\n${e.content}`);
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Action: merge (combine similar topic files)
// ---------------------------------------------------------------------------

async function actionMerge(
  deps: MemoryTidyDeps,
  dryRun: boolean,
): Promise<TidyResult> {
  const changes: string[] = [];
  let filesAffected = 0;
  let entriesAffected = 0;

  const topicFileNames = await deps.topicManager.listTopics();
  const toMerge: Array<{ from: string; into: string }> = [];

  for (let i = 0; i < topicFileNames.length; i++) {
    for (let j = i + 1; j < topicFileNames.length; j++) {
      const nameA = topicFileNames[i]!.replace(/\.md$/, "");
      const nameB = topicFileNames[j]!.replace(/\.md$/, "");
      const topicA = await deps.topicManager.getTopic(nameA);
      const topicB = await deps.topicManager.getTopic(nameB);
      if (!topicA || !topicB) {continue;}
      if (topicA.entries.length === 0 || topicB.entries.length === 0) {continue;}

      const contentA = topicA.entries.map((e) => e.content).join(" ");
      const contentB = topicB.entries.map((e) => e.content).join(" ");

      if (computeJaccard(contentA, contentB) >= MERGE_THRESHOLD) {
        const [from, into] =
          topicA.entries.length >= topicB.entries.length
            ? [topicFileNames[j]!, topicFileNames[i]!]
            : [topicFileNames[i]!, topicFileNames[j]!];
        toMerge.push({ from, into });
      }
    }
  }

  for (const { from, into } of toMerge) {
    const fromName = from.replace(/\.md$/, "");
    const intoName = into.replace(/\.md$/, "");
    const fromTopic = await deps.topicManager.getTopic(fromName);
    if (!fromTopic) {continue;}

    filesAffected += 2;
    entriesAffected += fromTopic.entries.length;
    changes.push(`merged ${from} into ${into} (${fromTopic.entries.length} entries moved)`);

    if (!dryRun) {
      for (const entry of fromTopic.entries) {
        await deps.topicManager.appendEntry(intoName, entry);
      }
      await deps.topicManager.deleteTopic(fromName);

      // Remove archived topic from MEMORY.md index
      const index = await deps.indexManager.readIndex();
      const before = index.sections.length;
      index.sections = index.sections.filter(
        (s) => s.topicFile !== `memory/topics/${from}`,
      );
      if (index.sections.length < before) {
        await deps.indexManager.writeIndex(index);
      }
    }
  }

  return { action: "merge", filesAffected, entriesAffected, changes, dryRun };
}

// ---------------------------------------------------------------------------
// Action: rebalance
// ---------------------------------------------------------------------------

async function actionRebalance(
  deps: MemoryTidyDeps,
  dryRun: boolean,
): Promise<TidyResult> {
  const changes: string[] = [];
  let filesAffected = 0;
  let entriesAffected = 0;

  const memoryMdPath = path.join(deps.workspaceDir, "MEMORY.md");
  let content: string;
  try {
    content = await deps.fs.readFile(memoryMdPath);
  } catch {
    return {
      action: "rebalance",
      filesAffected: 0,
      entriesAffected: 0,
      changes: ["MEMORY.md not found, nothing to rebalance"],
      dryRun,
    };
  }

  const currentSize = new TextEncoder().encode(content).length;

  if (currentSize <= REBALANCE_BUDGET_BYTES) {
    return {
      action: "rebalance",
      filesAffected: 0,
      entriesAffected: 0,
      changes: [`index within budget (${currentSize} bytes), no truncation needed`],
      dryRun,
    };
  }

  const indexBefore = await deps.indexManager.readIndex();

  if (dryRun) {
    changes.push(
      `would rebalance MEMORY.md index (current: ${currentSize} bytes, budget: ${REBALANCE_BUDGET_BYTES})`,
    );
    return { action: "rebalance", filesAffected: 1, entriesAffected: 0, changes, dryRun };
  }

  await deps.indexManager.rebalanceIndex(REBALANCE_BUDGET_BYTES);

  const indexAfter = await deps.indexManager.readIndex();
  entriesAffected = indexBefore.sections.length - indexAfter.sections.length;
  filesAffected = entriesAffected > 0 ? 1 : 0;

  if (entriesAffected > 0) {
    changes.push(
      `truncated ${entriesAffected} index entries (${currentSize} → ≤${REBALANCE_BUDGET_BYTES} bytes)`,
    );
  }

  return { action: "rebalance", filesAffected, entriesAffected, changes, dryRun };
}

// ---------------------------------------------------------------------------
// Action: archive (move old topics to archive/)
// ---------------------------------------------------------------------------

async function actionArchive(
  deps: MemoryTidyDeps,
  dryRun: boolean,
): Promise<TidyResult> {
  const changes: string[] = [];
  let filesAffected = 0;
  let entriesAffected = 0;

  const now = Date.now();
  const thresholdMs = ARCHIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const thresholdDate = new Date(now - thresholdMs).toISOString().slice(0, 10);

  const topicFileNames = await deps.topicManager.listTopics();

  for (const fileName of topicFileNames) {
    const name = fileName.replace(/\.md$/, "");
    const topic = await deps.topicManager.getTopic(name);
    if (!topic) {continue;}

    const lastUpdated = topic.frontmatter.updated;
    if (lastUpdated >= thresholdDate) {continue;}

    filesAffected++;
    entriesAffected += topic.entries.length;
    changes.push(`archived ${fileName} (last updated: ${lastUpdated})`);

    if (!dryRun) {
      // Create archive directory
      const archiveDir = path.join(deps.workspaceDir, "memory", "topics", "archive");
      await deps.fs.mkdir(archiveDir, { recursive: true });

      // Move file
      const srcPath = path.join(deps.workspaceDir, "memory", "topics", fileName);
      const dstPath = path.join(archiveDir, fileName);
      await deps.fs.rename(srcPath, dstPath);

      // Remove from MEMORY.md index
      const index = await deps.indexManager.readIndex();
      const before = index.sections.length;
      index.sections = index.sections.filter(
        (s) => s.topicFile !== `memory/topics/${fileName}`,
      );
      if (index.sections.length < before) {
        await deps.indexManager.writeIndex(index);
      }
    }
  }

  return { action: "archive", filesAffected, entriesAffected, changes, dryRun };
}

// ---------------------------------------------------------------------------
// Action: full (run all)
// ---------------------------------------------------------------------------

async function actionFull(
  deps: MemoryTidyDeps,
  target: string | undefined,
  dryRun: boolean,
): Promise<TidyResult> {
  const dedup = await actionDedup(deps, target, dryRun);
  const merge = await actionMerge(deps, dryRun);
  const rebalance = await actionRebalance(deps, dryRun);
  const archive = await actionArchive(deps, dryRun);

  return {
    action: "full",
    filesAffected:
      dedup.filesAffected + merge.filesAffected + rebalance.filesAffected + archive.filesAffected,
    entriesAffected:
      dedup.entriesAffected +
      merge.entriesAffected +
      rebalance.entriesAffected +
      archive.entriesAffected,
    changes: [...dedup.changes, ...merge.changes, ...rebalance.changes, ...archive.changes],
    dryRun,
  };
}

// ---------------------------------------------------------------------------
// Core function (shared by tool + dreaming)
// ---------------------------------------------------------------------------

export async function runMemoryTidyActions(
  deps: MemoryTidyDeps,
  params: { action: TidyAction; target?: string; dryRun?: boolean },
): Promise<TidyResult> {
  const dryRun = params.dryRun ?? false;
  switch (params.action) {
    case "dedup":
      return actionDedup(deps, params.target, dryRun);
    case "merge":
      return actionMerge(deps, dryRun);
    case "rebalance":
      return actionRebalance(deps, dryRun);
    case "archive":
      return actionArchive(deps, dryRun);
    case "full":
      return actionFull(deps, params.target, dryRun);
  }
}

// ---------------------------------------------------------------------------
// Convenience: create production deps from workspaceDir + node fs
// ---------------------------------------------------------------------------

export function createTidyDepsFromNodeFs(
  workspaceDir: string,
  nodeFs: Pick<typeof import("node:fs/promises"), "readFile" | "writeFile" | "mkdir" | "readdir" | "stat" | "rename">,
): MemoryTidyDeps {
  const fsAdapter: TopicManagerDeps["fs"] = {
    readFile: (p) => nodeFs.readFile(p, "utf-8"),
    writeFile: (p, d) => nodeFs.writeFile(p, d, "utf-8"),
    mkdir: (p, o) => nodeFs.mkdir(p, o).then(() => {}),
    readdir: (p) => nodeFs.readdir(p) as Promise<string[]>,
    stat: (p) => nodeFs.stat(p).then((s) => ({ mtimeMs: s.mtimeMs, size: s.size })),
    rename: (a, b) => nodeFs.rename(a, b),
  };

  return {
    topicManager: createTopicManager({ workspaceDir, fs: fsAdapter }),
    indexManager: new MemoryIndexManager({ workspaceDir, fs: fsAdapter }),
    fs: fsAdapter,
    workspaceDir,
  };
}

// ---------------------------------------------------------------------------
// Re-export helper for dreaming integration
// ---------------------------------------------------------------------------

export { isTidyEnabled };

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createMemoryTidyTool(options: {
  config?: KaijiBotConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {return null;}

  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!agentId || !resolveMemorySearchConfig(cfg, agentId)) {return null;}

  return {
    label: "Memory Tidy",
    name: "memory_tidy",
    description:
      "Memory maintenance tool: organize, deduplicate, and rebalance memory files. " +
      "Actions: dedup (remove duplicate entries), merge (combine similar topic files), " +
      "rebalance (trim MEMORY.md index to budget), archive (move old topics to archive). " +
      "Use 'full' to run all actions. Run automatically after Dreaming, or call manually " +
      "when memory feels cluttered.",
    parameters: MemoryTidySchema,
    execute: async (_toolCallId, rawParams) => {
      const action = readStringParam(rawParams, "action") as TidyAction | undefined;
      const target = readStringParam(rawParams, "target");
      const dryRun = typeof rawParams.dryRun === "boolean" ? rawParams.dryRun : false;

      if (!action) {
        return jsonResult({
          action: "none",
          filesAffected: 0,
          entriesAffected: 0,
          changes: ["missing required parameter: action"],
          dryRun,
        });
      }

      try {
        // Lazy-load memory manager to get workspaceDir
        const { getMemorySearchManager } = await import("./memory/index.js");
        const { manager, error } = await getMemorySearchManager({
          cfg,
          agentId,
          purpose: "status",
        });

        if (!manager) {
          return jsonResult({
            action,
            filesAffected: 0,
            entriesAffected: 0,
            changes: [`memory unavailable: ${error ?? "unknown"}`],
            dryRun,
          });
        }

        try {
          const status = manager.status();
          const workspaceDir = status.workspaceDir;

          if (!workspaceDir) {
            return jsonResult({
              action,
              filesAffected: 0,
              entriesAffected: 0,
              changes: ["no workspace directory available"],
              dryRun,
            });
          }

          const nodeFs = await import("node:fs/promises");
          const deps = createTidyDepsFromNodeFs(workspaceDir, nodeFs);

          const result = await runMemoryTidyActions(deps, {
            action,
            target: target ?? undefined,
            dryRun,
          });
          return jsonResult(result);
        } finally {
          if (typeof manager.close === "function") {
            try {
              await manager.close();
            } catch {
              // best-effort close
            }
          }
        }
      } catch (err) {
        return jsonResult({
          action,
          filesAffected: 0,
          entriesAffected: 0,
          changes: [`error: ${String(err)}`],
          dryRun,
        });
      }
    },
  };
}
