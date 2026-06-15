/**
 * Memory Tidy — unified LLM-driven maintenance tool for organizing,
 * deduplicating, and rebalancing memory topic files.
 *
 * Single entry point: reads all topics + MEMORY.md + registry, then either
 * uses LLM to plan operations or falls back to Jaccard-based heuristics.
 */

import path from "node:path";
import { Type } from "typebox";
import {
  jsonResult,
  readStringParam,
  resolveMemorySearchConfig,
  resolveSessionAgentId,
  type AnyAgentTool,
  type KaijiBotConfig,
} from "kaijibot/plugin-sdk/memory-core-host-runtime-core";
import { MemoryIndexManager } from "./memory-index.js";
import { localDateStr } from "./local-date.js";
import { jaccardSimilarity, tokenize } from "./memory/mmr.js";
import { TopicManager, createTopicManager, type TopicManagerDeps } from "./topic-manager.js";
import { type TopicEntry } from "./topic-types.js";
import { createTopicRegistry, type TopicRegistry } from "./topic-registry.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const MemoryTidySchema = Type.Object({
  dryRun: Type.Optional(Type.Boolean({ description: "Preview changes without writing" })),
  focus: Type.Optional(Type.String({ description: "Focus on a specific topic (name without .md)" })),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TidyOperation =
  | { op: "merge_topics"; from: string; into: string; reason: string }
  | { op: "rename_topic"; from: string; to: string; reason: string }
  | { op: "dedup_entries"; topic: string; keepIndex: number; absorbIndices: number[]; reason: string }
  | { op: "archive_topic"; topic: string; reason: string }
  | { op: "clean_inline"; section: string; removeLineIndices: number[]; reason: string };

export interface TidyResult {
  action: string; // always "full"
  filesAffected: number;
  entriesAffected: number;
  changes: string[];
  dryRun: boolean;
  llmUsed: boolean;
}

export interface MemoryTidyDeps {
  topicManager: TopicManager;
  indexManager: MemoryIndexManager;
  registry: TopicRegistry;
  fs: {
    readFile: (filePath: string) => Promise<string>;
    mkdir: (filePath: string, options: { recursive: boolean }) => Promise<void>;
    rename: (oldPath: string, newPath: string) => Promise<void>;
  };
  workspaceDir: string;
  generateText?: (prompt: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEDUP_THRESHOLD = 0.85;
const ARCHIVE_THRESHOLD_DAYS = 90;
const REBALANCE_BUDGET_BYTES = 8_192;

// ---------------------------------------------------------------------------
// Utilities (preserved from old implementation)
// ---------------------------------------------------------------------------

function computeJaccard(a: string, b: string): number {
  return jaccardSimilarity(tokenize(a), tokenize(b));
}

const INLINE_DATE_RE = /^- \d{4}-\d{2}-\d{2}: /;
function stripInlineDatePrefix(line: string): string {
  return line.trim().replace(INLINE_DATE_RE, "").replace(/^- /, "");
}

const INLINE_DEDUP_THRESHOLD = 0.8;

function deduplicateLines(lines: string[]): { kept: string[]; removed: number } {
  const kept: string[] = [];
  let removed = 0;
  for (const line of lines) {
    const stripped = stripInlineDatePrefix(line);
    if (stripped.trim() === "") {
      kept.push(line);
      continue;
    }
    const isDup = kept.some((k) => {
      const kStripped = stripInlineDatePrefix(k);
      return kStripped.trim() !== "" && computeJaccard(stripped, kStripped) >= INLINE_DEDUP_THRESHOLD;
    });
    if (isDup) {
      removed++;
    } else {
      kept.push(line);
    }
  }
  return { kept, removed };
}

async function filterLinesAgainstTopics(
  lines: string[],
  topicManager: TopicManager,
): Promise<{ kept: string[]; removed: number }> {
  const topicNames = await topicManager.listTopics();
  const allEntryContents: string[] = [];
  for (const fileName of topicNames) {
    const name = fileName.replace(/\.md$/, "");
    const topic = await topicManager.getTopic(name);
    if (topic) {
      for (const entry of topic.entries) {
        allEntryContents.push(entry.content);
      }
    }
  }

  const kept: string[] = [];
  let removed = 0;
  for (const line of lines) {
    const stripped = stripInlineDatePrefix(line);
    if (stripped.trim() === "") {
      kept.push(line);
      continue;
    }
    const matchesTopic = allEntryContents.some(
      (entryContent) => computeJaccard(stripped, entryContent) >= INLINE_DEDUP_THRESHOLD,
    );
    if (matchesTopic) {
      removed++;
    } else {
      kept.push(line);
    }
  }
  return { kept, removed };
}

function isTidyEnabled(pluginConfig: Record<string, unknown> | undefined): boolean {
  if (!pluginConfig || typeof pluginConfig !== "object") {
    return true;
  }
  const tidy = pluginConfig["tidy"];
  if (!tidy || typeof tidy !== "object") {
    return true;
  }
  return (tidy as Record<string, unknown>)["autoAfterConsolidation"] !== false;
}

// ---------------------------------------------------------------------------
// LLM prompt building
// ---------------------------------------------------------------------------

interface TopicSummary {
  name: string;
  subject: string;
  entryCount: number;
  lastUpdated: string;
  entries: Array<{ index: number; title: string; date: string; content: string }>;
}

async function gatherTopicSummaries(
  topicManager: TopicManager,
  focus?: string,
): Promise<TopicSummary[]> {
  const topicFileNames = await topicManager.listTopics();
  const summaries: TopicSummary[] = [];

  for (const fileName of topicFileNames) {
    const name = fileName.replace(/\.md$/, "");

    // If focus is set, skip topics that don't match
    if (focus && name !== focus) {
      continue;
    }

    const topic = await topicManager.getTopic(name);
    if (!topic) { continue; }

    const entries = topic.entries.slice(0, 5).map((e, i) => ({
      index: i,
      title: e.title,
      date: e.date,
      content: e.content.slice(0, 300),
    }));

    summaries.push({
      name,
      subject: topic.frontmatter.subject,
      entryCount: topic.entries.length,
      lastUpdated: topic.frontmatter.updated,
      entries,
    });
  }

  return summaries;
}

function buildLLMPrompt(
  topics: TopicSummary[],
  inlineSections: Array<{ section: string; lines: string[] }>,
  registryDescriptions: Array<{ name: string; description: string }>,
): string {
  const parts: string[] = [];

  parts.push(
    "You are a memory organization assistant. Analyze the memory data below and suggest operations to organize, deduplicate, and clean up.",
  );
  parts.push("");

  // Topics section
  parts.push("## Topics");
  for (const topic of topics) {
    parts.push(`### "${topic.name}" (subject: "${topic.subject}", ${topic.entryCount} entries, last updated: ${topic.lastUpdated})`);
    for (const entry of topic.entries) {
      parts.push(`- [${entry.index}] ${entry.title} (${entry.date}): ${entry.content}...`);
    }
    parts.push("");
  }

  // Inline sections
  if (inlineSections.length > 0) {
    parts.push("## Inline Sections (MEMORY.md)");
    for (const section of inlineSections) {
      parts.push(`### ${section.section}`);
      for (let i = 0; i < section.lines.length; i++) {
        parts.push(`- [${i}] ${section.lines[i]}`);
      }
    }
    parts.push("");
  }

  // Registry descriptions
  if (registryDescriptions.length > 0) {
    parts.push("## Topic Registry");
    for (const desc of registryDescriptions) {
      parts.push(`- ${desc.name}: ${desc.description}`);
    }
    parts.push("");
  }

  // Operations
  parts.push("Based on this data, suggest operations. Available operations:");
  parts.push('1. merge_topics — merge overlapping topics. { "op": "merge_topics", "from": "topic-a", "into": "topic-b", "reason": "..." }');
  parts.push('   - "into" must be one of the existing topic names (preferably with more entries)');
  parts.push('   - All entries from "from" move to "into", "from" is deleted');
  parts.push("");
  parts.push('2. rename_topic — rename to match content. { "op": "rename_topic", "from": "old-name", "to": "new-name", "reason": "..." }');
  parts.push('   - "to" must be kebab-case (lowercase, hyphens, no spaces), max 30 chars');
  parts.push('   - Must not conflict with existing topic names');
  parts.push("");
  parts.push('3. dedup_entries — merge duplicate entries. { "op": "dedup_entries", "topic": "name", "keepIndex": 0, "absorbIndices": [1, 3], "reason": "..." }');
  parts.push('   - keepIndex and absorbIndices are 0-based entry indices within the topic');
  parts.push('   - The kept entry absorbs the others (their content is appended)');
  parts.push("");
  parts.push('4. archive_topic — archive inactive topics. { "op": "archive_topic", "topic": "name", "reason": "..." }');
  parts.push("");
  parts.push('5. clean_inline — remove redundant inline lines. { "op": "clean_inline", "section": "⚡ Core Memory", "removeLineIndices": [2, 5], "reason": "..." }');
  parts.push("");
  parts.push("Rules:");
  parts.push("- Be conservative. Only suggest operations you're confident about.");
  parts.push('- For merge_topics, "into" should be the topic with more entries.');
  parts.push("- For dedup_entries, only group entries with clearly overlapping content.");
  parts.push("- For clean_inline, only remove lines that duplicate other lines or are already in topic files.");
  parts.push("");
  parts.push("Reply with ONLY a JSON array. Empty array if no changes needed. No markdown fences, no commentary.");

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// LLM response parsing
// ---------------------------------------------------------------------------

function parseLLMResponse(raw: string): TidyOperation[] {
  let text = raw.trim();

  // Strip markdown fences if present
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    text = fenceMatch[1]!.trim();
  }

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as TidyOperation[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationContext {
  topicNames: Set<string>;
  inlineSections: Map<string, string[]>;
}

function validateOperations(
  ops: TidyOperation[],
  ctx: ValidationContext,
): TidyOperation[] {
  const valid: TidyOperation[] = [];

  for (const op of ops) {
    if (!op || typeof op !== "object" || typeof op.op !== "string") {
      continue;
    }

    switch (op.op) {
      case "merge_topics": {
        if (typeof op.from !== "string" || typeof op.into !== "string") { break; }
        if (!ctx.topicNames.has(op.from) || !ctx.topicNames.has(op.into)) { break; }
        if (op.from === op.into) { break; }
        valid.push(op);
        break;
      }
      case "rename_topic": {
        if (typeof op.from !== "string" || typeof op.to !== "string") { break; }
        if (!ctx.topicNames.has(op.from)) { break; }
        if (!/^[a-z][a-z0-9-]*$/.test(op.to) || op.to.length > 30) { break; }
        if (ctx.topicNames.has(op.to)) { break; }
        valid.push(op);
        break;
      }
      case "dedup_entries": {
        if (typeof op.topic !== "string" || typeof op.keepIndex !== "number" || !Array.isArray(op.absorbIndices)) { break; }
        // We don't have entry counts in validation context, so validate at execution time
        if (!ctx.topicNames.has(op.topic)) { break; }
        if (op.keepIndex < 0) { break; }
        valid.push(op);
        break;
      }
      case "archive_topic": {
        if (typeof op.topic !== "string") { break; }
        if (!ctx.topicNames.has(op.topic)) { break; }
        valid.push(op);
        break;
      }
      case "clean_inline": {
        if (typeof op.section !== "string" || !Array.isArray(op.removeLineIndices)) { break; }
        const sectionLines = ctx.inlineSections.get(op.section);
        if (!sectionLines) { break; }
        if (!op.removeLineIndices.every((i: number) => i >= 0 && i < sectionLines.length)) { break; }
        valid.push(op);
        break;
      }
      default:
        break;
    }
  }

  return valid;
}

// ---------------------------------------------------------------------------
// Operation execution helpers
// ---------------------------------------------------------------------------

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

async function executeDedupEntries(
  deps: MemoryTidyDeps,
  op: TidyOperation & { op: "dedup_entries" },
  dryRun: boolean,
): Promise<{ filesAffected: number; entriesAffected: number; changes: string[] }> {
  const topic = await deps.topicManager.getTopic(op.topic);
  if (!topic) {
    return { filesAffected: 0, entriesAffected: 0, changes: [] };
  }

  const { entries } = topic;
  if (op.keepIndex < 0 || op.keepIndex >= entries.length) {
    return { filesAffected: 0, entriesAffected: 0, changes: [] };
  }
  if (!op.absorbIndices.every((i) => i >= 0 && i < entries.length)) {
    return { filesAffected: 0, entriesAffected: 0, changes: [] };
  }
  if (op.absorbIndices.includes(op.keepIndex)) {
    return { filesAffected: 0, entriesAffected: 0, changes: [] };
  }

  const allIndices = [op.keepIndex, ...op.absorbIndices];
  const mergedContent = buildDedupMergedContent(entries, op.keepIndex, op.absorbIndices);

  if (!dryRun) {
    await deps.topicManager.mergeEntries(op.topic, allIndices, mergedContent);
  }

  const absorbedTitles = op.absorbIndices.map((i) => entries[i]!.title);
  return {
    filesAffected: 1,
    entriesAffected: op.absorbIndices.length,
    changes: [`${op.topic}: merged "${absorbedTitles.join('", "')}" into "${entries[op.keepIndex]!.title}"`],
  };
}

async function executeMergeTopics(
  deps: MemoryTidyDeps,
  op: TidyOperation & { op: "merge_topics" },
  dryRun: boolean,
): Promise<{ filesAffected: number; entriesAffected: number; changes: string[] }> {
  const fromTopic = await deps.topicManager.getTopic(op.from);
  if (!fromTopic) {
    return { filesAffected: 0, entriesAffected: 0, changes: [] };
  }

  const filesAffected = 2;
  const entriesAffected = fromTopic.entries.length;

  if (!dryRun) {
    for (const entry of fromTopic.entries) {
      await deps.topicManager.appendEntry(op.into, entry);
    }
    await deps.topicManager.deleteTopic(op.from);

    // Remove from MEMORY.md index
    const index = await deps.indexManager.readIndex();
    const before = index.sections.length;
    index.sections = index.sections.filter((s) => s.topicFile !== `memory/topics/${op.from}.md`);
    if (index.sections.length < before) {
      await deps.indexManager.writeIndex(index);
    }
  }

  return {
    filesAffected,
    entriesAffected,
    changes: [`merged ${op.from} into ${op.into} (${entriesAffected} entries moved)`],
  };
}

async function executeRenameTopic(
  deps: MemoryTidyDeps,
  op: TidyOperation & { op: "rename_topic" },
  dryRun: boolean,
): Promise<{ filesAffected: number; entriesAffected: number; changes: string[] }> {
  const topic = await deps.topicManager.getTopic(op.from);
  if (!topic) {
    return { filesAffected: 0, entriesAffected: 0, changes: [] };
  }

  if (!dryRun) {
    // Read source file, write to new name, delete old
    const srcPath = path.join(deps.workspaceDir, "memory", "topics", `${op.from}.md`);
    const dstPath = path.join(deps.workspaceDir, "memory", "topics", `${op.to}.md`);

    const content = await deps.fs.readFile(srcPath);
    const { serializeTopicFile, parseTopicFile: parseFile } = await import("./topic-types.js");
    const parsed = parseFile(content);
    parsed.frontmatter.subject = op.to;
    const serialized = serializeTopicFile(parsed);

    const tmpName = `${op.to}.md.${process.pid}.${Date.now()}.tmp`;
    const tmpPath = path.join(deps.workspaceDir, "memory", "topics", tmpName);
    const { randomUUID } = await import("node:crypto");
    const atomicTmp = path.join(
      deps.workspaceDir,
      "memory",
      "topics",
      `${op.to}.md.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
    );

    // Write new file
    const fsAny = deps.fs as Record<string, unknown>;
    const writeFile = fsAny["writeFile"] as ((p: string, d: string) => Promise<void>) | undefined;
    if (writeFile) {
      await deps.fs.mkdir(path.join(deps.workspaceDir, "memory", "topics"), { recursive: true });
      await writeFile(atomicTmp, serialized);
      try {
        await deps.fs.rename(atomicTmp, dstPath);
      } catch {
        // Fallback: direct write
        await writeFile(dstPath, serialized);
      }
    }

    // Delete old file
    await deps.topicManager.deleteTopic(op.from);

    // Update MEMORY.md index
    const index = await deps.indexManager.readIndex();
    let changed = false;
    for (const section of index.sections) {
      if (section.topicFile === `memory/topics/${op.from}.md`) {
        section.topicFile = `memory/topics/${op.to}.md`;
        section.title = op.to;
        section.subject = op.to;
        changed = true;
      }
    }
    if (changed) {
      await deps.indexManager.writeIndex(index);
    }
  }

  return {
    filesAffected: 1,
    entriesAffected: 0,
    changes: [`renamed ${op.from} → ${op.to}`],
  };
}

async function executeArchiveTopic(
  deps: MemoryTidyDeps,
  op: TidyOperation & { op: "archive_topic" },
  dryRun: boolean,
): Promise<{ filesAffected: number; entriesAffected: number; changes: string[] }> {
  const topic = await deps.topicManager.getTopic(op.topic);
  if (!topic) {
    return { filesAffected: 0, entriesAffected: 0, changes: [] };
  }

  if (!dryRun) {
    const archiveDir = path.join(deps.workspaceDir, "memory", "topics", "archive");
    await deps.fs.mkdir(archiveDir, { recursive: true });

    const srcPath = path.join(deps.workspaceDir, "memory", "topics", `${op.topic}.md`);
    const dstPath = path.join(archiveDir, `${op.topic}.md`);
    await deps.fs.rename(srcPath, dstPath);

    // Remove from MEMORY.md index
    const index = await deps.indexManager.readIndex();
    const before = index.sections.length;
    index.sections = index.sections.filter((s) => s.topicFile !== `memory/topics/${op.topic}.md`);
    if (index.sections.length < before) {
      await deps.indexManager.writeIndex(index);
    }
  }

  return {
    filesAffected: 1,
    entriesAffected: topic.entries.length,
    changes: [`archived ${op.topic}.md (reason: ${op.reason})`],
  };
}

async function executeCleanInline(
  deps: MemoryTidyDeps,
  op: TidyOperation & { op: "clean_inline" },
  dryRun: boolean,
): Promise<{ filesAffected: number; entriesAffected: number; changes: string[] }> {
  const index = await deps.indexManager.readIndex();
  const inlineSections = index.inlineSections ?? [];
  const section = inlineSections.find((s) => s.section === op.section);
  if (!section) {
    return { filesAffected: 0, entriesAffected: 0, changes: [] };
  }

  // Validate indices against actual lines
  if (!op.removeLineIndices.every((i) => i >= 0 && i < section.lines.length)) {
    return { filesAffected: 0, entriesAffected: 0, changes: [] };
  }

  const removedCount = op.removeLineIndices.length;

  if (!dryRun) {
    // Remove lines in reverse order to keep indices stable
    const sortedIndices = [...op.removeLineIndices].toSorted((a, b) => b - a);
    for (const idx of sortedIndices) {
      section.lines.splice(idx, 1);
    }
    index.inlineSections = inlineSections;
    await deps.indexManager.writeIndex(index);
  }

  return {
    filesAffected: 1,
    entriesAffected: removedCount,
    changes: [`clean_inline: removed ${removedCount} lines from "${op.section}"`],
  };
}

// ---------------------------------------------------------------------------
// LLM-driven tidy
// ---------------------------------------------------------------------------

async function runLLMTidy(
  deps: MemoryTidyDeps,
  dryRun: boolean,
  focus?: string,
): Promise<TidyResult> {
  const changes: string[] = [];
  let filesAffected = 0;
  let entriesAffected = 0;

  // Gather context
  const topicSummaries = await gatherTopicSummaries(deps.topicManager, focus);
  const index = await deps.indexManager.readIndex();
  const inlineSections = (index.inlineSections ?? []).map((s) => ({
    section: s.section,
    lines: s.lines,
  }));

  let registryDescriptions: Array<{ name: string; description: string }> = [];
  try {
    registryDescriptions = await deps.registry.getDescriptionList();
  } catch {
    // Registry may not exist yet
  }

  // Build prompt
  const prompt = buildLLMPrompt(topicSummaries, inlineSections, registryDescriptions);

  // Call LLM
  let ops: TidyOperation[];
  try {
    const response = await deps.generateText!(prompt);
    ops = parseLLMResponse(response);
  } catch {
    // LLM error → fall back to Jaccard
    return { ...(await runJaccardFallback(deps, dryRun, focus)), llmUsed: false };
  }

  // Build validation context
  const topicNames = new Set(topicSummaries.map((t) => t.name));
  const inlineSectionMap = new Map<string, string[]>();
  for (const section of inlineSections) {
    inlineSectionMap.set(section.section, section.lines);
  }

  const validOps = validateOperations(ops, {
    topicNames,
    inlineSections: inlineSectionMap,
  });

  // Sort operations by execution order
  const order: Record<string, number> = {
    dedup_entries: 0,
    merge_topics: 1,
    rename_topic: 2,
    archive_topic: 3,
    clean_inline: 4,
  };
  const sortedOps = validOps.toSorted((a, b) => (order[a.op] ?? 99) - (order[b.op] ?? 99));

  // Execute operations
  for (const op of sortedOps) {
    let result: { filesAffected: number; entriesAffected: number; changes: string[] };

    switch (op.op) {
      case "dedup_entries":
        result = await executeDedupEntries(deps, op, dryRun);
        break;
      case "merge_topics":
        result = await executeMergeTopics(deps, op, dryRun);
        break;
      case "rename_topic":
        result = await executeRenameTopic(deps, op, dryRun);
        break;
      case "archive_topic":
        result = await executeArchiveTopic(deps, op, dryRun);
        break;
      case "clean_inline":
        result = await executeCleanInline(deps, op, dryRun);
        break;
      default:
        continue;
    }

    filesAffected += result.filesAffected;
    entriesAffected += result.entriesAffected;
    changes.push(...result.changes);
  }

  // Always rebalance
  if (!dryRun) {
    await deps.indexManager.rebalanceIndex(REBALANCE_BUDGET_BYTES);
  }

  return {
    action: "full",
    filesAffected,
    entriesAffected,
    changes,
    dryRun,
    llmUsed: true,
  };
}

// ---------------------------------------------------------------------------
// Jaccard fallback (no LLM)
// ---------------------------------------------------------------------------

async function runJaccardFallback(
  deps: MemoryTidyDeps,
  dryRun: boolean,
  _focus?: string,
): Promise<TidyResult> {
  const changes: string[] = [];
  let filesAffected = 0;
  let entriesAffected = 0;

  // 1. Entry dedup within topics (Union-Find)
  const topicFileNames = await deps.topicManager.listTopics();
  for (const fileName of topicFileNames) {
    const name = fileName.replace(/\.md$/, "");
    const topic = await deps.topicManager.getTopic(name);
    if (!topic || topic.entries.length < 2) {
      continue;
    }

    const { entries } = topic;
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

    for (const indices of groupMap.values()) {
      if (indices.length <= 1) {
        continue;
      }

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
      changes.push(`${name}: merged "${absorbedTitles.join('", "')}" into "${keptEntry.title}"`);

      if (!dryRun) {
        await deps.topicManager.mergeEntries(name, sorted, mergedContent);
      }

      // Only process first group per file to keep indices stable
      break;
    }
  }

  // 2. Inline section dedup
  const index = await deps.indexManager.readIndex();
  const inlineSections = index.inlineSections ?? [];
  let inlineChanged = false;

  // Within-section dedup
  for (const section of inlineSections) {
    const { kept, removed } = deduplicateLines(section.lines);
    if (removed > 0) {
      entriesAffected += removed;
      changes.push(`deduped ${removed} duplicate lines in "${section.section}"`);
      if (!dryRun) {
        section.lines = kept;
      }
      inlineChanged = true;
    }
  }

  // Cross-dedup inline ↔ topic entries
  for (const section of inlineSections) {
    const { kept, removed } = await filterLinesAgainstTopics(section.lines, deps.topicManager);
    if (removed > 0) {
      entriesAffected += removed;
      changes.push(`removed ${removed} inline lines already in topic files from "${section.section}"`);
      if (!dryRun) {
        section.lines = kept;
      }
      inlineChanged = true;
    }
  }

  if (!dryRun && inlineChanged) {
    index.inlineSections = inlineSections;
    await deps.indexManager.writeIndex(index);
    if (inlineChanged) {
      filesAffected += 1;
    }
  }

  // 3. Archive topics not updated in 90 days
  const now = Date.now();
  const thresholdMs = ARCHIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const thresholdDate = localDateStr(new Date(now - thresholdMs));

  for (const fileName of topicFileNames) {
    const name = fileName.replace(/\.md$/, "");
    const topic = await deps.topicManager.getTopic(name);
    if (!topic) {
      continue;
    }

    const lastUpdated = topic.frontmatter.updated;
    if (lastUpdated >= thresholdDate) {
      continue;
    }

    filesAffected++;
    entriesAffected += topic.entries.length;
    changes.push(`archived ${fileName} (last updated: ${lastUpdated})`);

    if (!dryRun) {
      const archiveDir = path.join(deps.workspaceDir, "memory", "topics", "archive");
      await deps.fs.mkdir(archiveDir, { recursive: true });

      const srcPath = path.join(deps.workspaceDir, "memory", "topics", fileName);
      const dstPath = path.join(archiveDir, fileName);
      await deps.fs.rename(srcPath, dstPath);

      const idx = await deps.indexManager.readIndex();
      const before = idx.sections.length;
      idx.sections = idx.sections.filter((s) => s.topicFile !== `memory/topics/${fileName}`);
      if (idx.sections.length < before) {
        await deps.indexManager.writeIndex(idx);
      }
    }
  }

  // 4. Rebalance MEMORY.md to 8KB
  if (!dryRun) {
    await deps.indexManager.rebalanceIndex(REBALANCE_BUDGET_BYTES);
  }

  return {
    action: "full",
    filesAffected,
    entriesAffected,
    changes,
    dryRun,
    llmUsed: false,
  };
}

// ---------------------------------------------------------------------------
// syncMissingPointers: ensure registry topics have MEMORY.md pointers
// ---------------------------------------------------------------------------

async function syncMissingPointers(deps: MemoryTidyDeps): Promise<{ added: number }> {
  const registryTopics = await deps.registry.listTopics();
  if (registryTopics.length === 0) {
    return { added: 0 };
  }

  const index = await deps.indexManager.readIndex();
  const existingTopicFiles = new Set(index.sections.map((s) => s.topicFile));

  let added = 0;
  for (const meta of registryTopics) {
    const topicFile = `memory/topics/${meta.name}.md`;
    if (!existingTopicFiles.has(topicFile)) {
      await deps.indexManager.updateSection({
        subject: meta.name,
        title: meta.name,
        topicFile,
        summary: meta.description,
      });
      added++;
    }
  }

  return { added };
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export async function runMemoryTidy(
  deps: MemoryTidyDeps,
  params: { dryRun?: boolean; focus?: string },
): Promise<TidyResult> {
  const dryRun = params.dryRun ?? false;
  const focus = params.focus;

  let result: TidyResult;

  if (deps.generateText) {
    try {
      result = await runLLMTidy(deps, dryRun, focus);
    } catch {
      result = await runJaccardFallback(deps, dryRun, focus);
      result.llmUsed = false;
    }
  } else {
    result = await runJaccardFallback(deps, dryRun, focus);
  }

  // Always sync registry at end
  try {
    await deps.registry.syncFromDisk();
  } catch {
    // Best-effort
  }

  // Sync missing MEMORY.md pointers for registry topics
  try {
    const syncResult = await syncMissingPointers(deps);
    if (syncResult.added > 0) {
      result.changes.push(`synced ${syncResult.added} missing topic pointer(s) to MEMORY.md`);
    }
  } catch {
    // Best-effort
  }

  return result;
}

// ---------------------------------------------------------------------------
// Convenience: create production deps from workspaceDir + node fs
// ---------------------------------------------------------------------------

export function createTidyDepsFromNodeFs(
  workspaceDir: string,
  nodeFs: Pick<
    typeof import("node:fs/promises"),
    "readFile" | "writeFile" | "mkdir" | "readdir" | "stat" | "rename" | "unlink"
  >,
): MemoryTidyDeps {
  const fsAdapter: TopicManagerDeps["fs"] = {
    readFile: (p) => nodeFs.readFile(p, "utf-8"),
    writeFile: (p, d) => nodeFs.writeFile(p, d, "utf-8"),
    mkdir: (p, o) => nodeFs.mkdir(p, o).then(() => {}),
    readdir: (p) => nodeFs.readdir(p) as Promise<string[]>,
    stat: (p) => nodeFs.stat(p).then((s) => ({ mtimeMs: s.mtimeMs, size: s.size })),
    rename: (a, b) => nodeFs.rename(a, b),
    unlink: (p) => nodeFs.unlink(p),
  };

  return {
    topicManager: createTopicManager({ workspaceDir, fs: fsAdapter }),
    indexManager: new MemoryIndexManager({ workspaceDir, fs: fsAdapter }),
    registry: createTopicRegistry({ workspaceDir, fs: fsAdapter }),
    fs: fsAdapter,
    workspaceDir,
  };
}

// ---------------------------------------------------------------------------
// Re-export helper for consolidation integration
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
  if (!cfg) {
    return null;
  }

  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!agentId || !resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }

  let generateTextFn: ((prompt: string) => Promise<string>) | undefined;
  let generateTextInit = false;

  return {
    label: "Memory Tidy",
    name: "memory_tidy",
    description:
      "Memory maintenance tool: organize, deduplicate, and rebalance memory files. " +
      "Analyzes all topics and MEMORY.md to suggest merge, rename, dedup, archive, " +
      "and inline cleanup operations. Use dryRun to preview changes. " +
      "Run automatically after consolidation, or call manually when memory feels cluttered.",
    parameters: MemoryTidySchema,
    execute: async (_toolCallId, rawArgs) => {
      const rawParams = rawArgs as Record<string, unknown>;
      const dryRun = typeof rawParams.dryRun === "boolean" ? rawParams.dryRun : false;
      const focus = readStringParam(rawParams, "focus");

      if (!generateTextInit) {
        generateTextInit = true;
        try {
          const sdkModule = await import("kaijibot/plugin-sdk/generate-text");
          const createStandaloneGenerateText = sdkModule.createStandaloneGenerateText;
          generateTextFn = await createStandaloneGenerateText(cfg);
        } catch {
          // LLM unavailable — Jaccard fallback
        }
      }

      try {
        const { getMemorySearchManager } = await import("./memory/index.js");
        const { manager, error } = await getMemorySearchManager({
          cfg,
          agentId,
          purpose: "status",
        });

        if (!manager) {
          return jsonResult({
            action: "full",
            filesAffected: 0,
            entriesAffected: 0,
            changes: [`memory unavailable: ${error ?? "unknown"}`],
            dryRun,
            llmUsed: false,
          });
        }

        try {
          const status = manager.status();
          const workspaceDir = status.workspaceDir;

          if (!workspaceDir) {
            return jsonResult({
              action: "full",
              filesAffected: 0,
              entriesAffected: 0,
              changes: ["no workspace directory available"],
              dryRun,
              llmUsed: false,
            });
          }

          const nodeFs = await import("node:fs/promises");
          const deps = createTidyDepsFromNodeFs(workspaceDir, nodeFs);
          deps.generateText = generateTextFn;

          const result = await runMemoryTidy(deps, {
            dryRun,
            focus: focus ?? undefined,
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
          action: "full",
          filesAffected: 0,
          entriesAffected: 0,
          changes: [`error: ${String(err)}`],
          dryRun,
          llmUsed: false,
        });
      }
    },
  };
}
