import fs from "node:fs/promises";
import path from "node:path";
import { createTopicManager, type TopicManagerDeps } from "./topic-manager.js";
import {
  MemoryIndexManager,
  type MemoryIndexDeps,
  type MemoryIndexSection,
} from "./memory-index.js";
import { type TopicEntry, DEFAULT_TOPIC_FILES } from "./topic-types.js";
import { type MemoryType } from "./memory-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedMemoryEntry {
  sourceFile: string;
  heading: string;
  content: string;
  startLine: number;
  endLine: number;
  lineCount: number;
}

export interface ClassifiedEntry {
  sourceFile: string;
  type: MemoryType;
  topicSlug: string;
  title: string;
  summary: string;
  importance: "high" | "normal" | "low";
  originalContent: string;
}

export interface RouteResult {
  entriesRouted: number;
  topicsCreated: string[];
  topicsUpdated: string[];
}

export interface MigrateResult {
  filesScanned: number;
  entriesParsed: number;
  entriesClassified: number;
  entriesRouted: number;
  topicsCreated: string[];
  topicsUpdated: string[];
  filesArchived: number;
  errors: string[];
}

export interface FsAdapter {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<void>;
  readdir: (path: string) => Promise<string[]>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  stat: (path: string) => Promise<{ mtimeMs: number; size: number }>;
}

export type ClassifyFn = (
  entries: ParsedMemoryEntry[],
) => Promise<ClassifiedEntry[]>;

export interface MigrateOptions {
  workspaceDir: string;
  dryRun?: boolean;
  sourceDir?: string;
  batchSize?: number;
  archive?: boolean;
  classifyFn?: ClassifyFn;
  fs?: FsAdapter;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEMORY_DIR = "memory";
const ARCHIVE_DIR = "memory/archive";
const TOPICS_DIR = "memory/topics";

const DAILY_FILE_RE = /^\d{4}-\d{2}-\d{2}(?:-[^/]+)?\.md$/;
const HEADING_RE = /^(#{1,2}) (.+)$/;
const MIN_ENTRY_LENGTH = 20;

const SKIP_CONTENT_PATTERNS = [
  /kaijibot:dreaming:/,
  /\bconfidence:\s*\d/,
  /\bevidence:\s/,
  /^-\s+\*\*Session/,
];

const TOPIC_INDEX_HEADING_RE = /^\[/;

// ---------------------------------------------------------------------------
// Fs helpers
// ---------------------------------------------------------------------------

export function createNodeFsAdapter(): FsAdapter {
  return {
    readFile: (p: string) => fs.readFile(p, "utf-8"),
    writeFile: (p: string, data: string) => fs.writeFile(p, data, "utf-8"),
    mkdir: (p: string, opts: { recursive: boolean }) =>
      fs.mkdir(p, opts).then(() => {}),
    readdir: (p: string) => fs.readdir(p),
    rename: (oldPath: string, newPath: string) => fs.rename(oldPath, newPath),
    stat: (p: string) =>
      fs.stat(p).then((s) => ({ mtimeMs: s.mtimeMs, size: s.size })),
  };
}

function resolveFs(fsOverride?: FsAdapter): FsAdapter {
  return fsOverride ?? createNodeFsAdapter();
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function shouldSkipEntry(heading: string, content: string): boolean {
  if (content.trim().length < MIN_ENTRY_LENGTH) return true;
  if (TOPIC_INDEX_HEADING_RE.test(heading)) return true;
  const combined = `${heading}\n${content}`;
  for (const pattern of SKIP_CONTENT_PATTERNS) {
    if (pattern.test(combined)) return true;
  }
  return false;
}

export async function parseLegacyMemoryFiles(
  memoryDir: string,
  fsAdapter: FsAdapter,
): Promise<ParsedMemoryEntry[]> {
  let fileNames: string[];
  try {
    fileNames = await fsAdapter.readdir(memoryDir);
  } catch {
    return [];
  }

  const dailyFiles = fileNames
    .filter((name) => DAILY_FILE_RE.test(name))
    .toSorted();

  const allEntries: ParsedMemoryEntry[] = [];

  for (const fileName of dailyFiles) {
    const filePath = path.join(memoryDir, fileName);
    let content: string;
    try {
      content = await fsAdapter.readFile(filePath);
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const entries: ParsedMemoryEntry[] = [];

    let currentHeading = "";
    let currentStartLine = -1;
    let currentLines: string[] = [];

    const flushEntry = () => {
      if (currentStartLine >= 0 && currentHeading) {
        const entryContent = currentLines.join("\n").trim();
        const endLine = currentStartLine + currentLines.length;
        if (!shouldSkipEntry(currentHeading, entryContent)) {
          entries.push({
            sourceFile: fileName,
            heading: currentHeading,
            content: entryContent,
            startLine: currentStartLine,
            endLine,
            lineCount: currentLines.length,
          });
        }
      }
      currentHeading = "";
      currentStartLine = -1;
      currentLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const match = line.match(HEADING_RE);
      if (match && (match[1] === "#" || match[1] === "##")) {
        flushEntry();
        currentHeading = match[2]!;
        currentStartLine = i;
        currentLines = [];
      } else if (currentStartLine >= 0) {
        currentLines.push(line);
      }
    }
    flushEntry();

    allEntries.push(...entries);
  }

  return allEntries;
}

// ---------------------------------------------------------------------------
// Heuristic fallback classification
// ---------------------------------------------------------------------------

export function heuristicClassify(entries: ParsedMemoryEntry[]): ClassifiedEntry[] {
  return entries.map((entry) => {
    const dateMatch = entry.sourceFile.match(/^(\d{4}-\d{2}-\d{2})/);
    const datePart = dateMatch?.[1] ?? new Date().toISOString().slice(0, 10);
    const rawTitle = `${datePart}: ${entry.heading}`;
    const title = rawTitle.length > 60 ? `${rawTitle.slice(0, 57)}...` : rawTitle;
    return {
      sourceFile: entry.sourceFile,
      type: "reference" as MemoryType,
      topicSlug: "session",
      title,
      summary: entry.content.length > 120
        ? `${entry.content.slice(0, 117)}...`
        : entry.content,
      importance: "normal" as const,
      originalContent: entry.content,
    };
  });
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export async function classifyEntries(
  entries: ParsedMemoryEntry[],
  classifyFn?: ClassifyFn,
  batchSize: number = 10,
): Promise<ClassifiedEntry[]> {
  if (entries.length === 0) return [];

  if (classifyFn) {
    const results: ClassifiedEntry[] = [];
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      try {
        const classified = await classifyFn(batch);
        results.push(...classified);
      } catch {
        results.push(...heuristicClassify(batch));
      }
    }
    return results;
  }

  return heuristicClassify(entries);
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function resolveTopicFileName(type: MemoryType, topicSlug: string): string {
  const defaultFile = DEFAULT_TOPIC_FILES[type];
  if (topicSlug === "session" || topicSlug === type) {
    return defaultFile;
  }
  return `${topicSlug}.md`;
}

function buildTopicEntry(classified: ClassifiedEntry): TopicEntry {
  return {
    title: classified.title,
    date: new Date().toISOString().slice(0, 10),
    content: classified.summary,
    importance: classified.importance,
    source: "memory-migrate",
  };
}

export async function routeToTopicFiles(
  classified: ClassifiedEntry[],
  workspaceDir: string,
  fsAdapter: FsAdapter,
): Promise<RouteResult> {
  const result: RouteResult = {
    entriesRouted: 0,
    topicsCreated: [],
    topicsUpdated: [],
  };

  if (classified.length === 0) return result;

  const topicDeps: TopicManagerDeps = { workspaceDir, fs: fsAdapter };
  const indexDeps: MemoryIndexDeps = { workspaceDir, fs: fsAdapter };
  const topicManager = createTopicManager(topicDeps);
  const indexManager = new MemoryIndexManager(indexDeps);

  await topicManager.ensureTopicsDir();

  const topicsDir = path.join(workspaceDir, TOPICS_DIR);
  let existingTopics: Set<string>;
  try {
    existingTopics = new Set(await fsAdapter.readdir(topicsDir));
  } catch {
    existingTopics = new Set();
  }

  const topicsTouched = new Set<string>();
  const topicsBySlug = new Map<string, { type: MemoryType; file: string }>();

  for (const entry of classified) {
    const fileName = resolveTopicFileName(entry.type, entry.topicSlug);
    if (!topicsBySlug.has(fileName)) {
      topicsBySlug.set(fileName, { type: entry.type, file: fileName });
    }
  }

  for (const [fileName, meta] of topicsBySlug) {
    const isNew = !existingTopics.has(fileName);
    try {
      const existing = await topicManager.getTopic(fileName);
      if (!existing) {
        await topicManager.createTopic(meta.type, fileName);
        if (isNew) {
          result.topicsCreated.push(fileName);
        }
      }
    } catch {
      try {
        await topicManager.createTopic(meta.type, fileName);
        result.topicsCreated.push(fileName);
      } catch {
        continue;
      }
    }
  }

  for (const entry of classified) {
    const fileName = resolveTopicFileName(entry.type, entry.topicSlug);
    try {
      const topicEntry = buildTopicEntry(entry);
      await topicManager.appendEntry(fileName, topicEntry);
      result.entriesRouted++;
      topicsTouched.add(fileName);
    } catch {
      continue;
    }
  }

  for (const fileName of topicsTouched) {
    if (!result.topicsCreated.includes(fileName)) {
      result.topicsUpdated.push(fileName);
    }
  }

  for (const [, meta] of topicsBySlug) {
    const section: MemoryIndexSection = {
      type: meta.type,
      title: meta.type === "user"
        ? "User Profile"
        : meta.type === "feedback"
          ? "Feedback"
          : meta.type === "project"
            ? "Project Decisions"
            : "Reference",
      topicFile: `${TOPICS_DIR}/${meta.file}`,
      summary: `Migrated from legacy daily files (${result.entriesRouted} entries)`,
    };
    try {
      await indexManager.updateSection(section);
    } catch {
      continue;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Archiving
// ---------------------------------------------------------------------------

export async function archiveProcessedFiles(
  files: string[],
  memoryDir: string,
  workspaceDir: string,
  fsAdapter: FsAdapter,
): Promise<number> {
  if (files.length === 0) return 0;

  const archiveDir = path.join(workspaceDir, ARCHIVE_DIR);
  await fsAdapter.mkdir(archiveDir, { recursive: true });

  let archived = 0;
  for (const fileName of files) {
    const srcPath = path.join(memoryDir, fileName);
    const dstPath = path.join(archiveDir, fileName);
    try {
      await fsAdapter.rename(srcPath, dstPath);
      archived++;
    } catch {
      continue;
    }
  }
  return archived;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runMemoryMigrate(opts: MigrateOptions): Promise<MigrateResult> {
  const fsAdapter = resolveFs(opts.fs);
  const batchSize = opts.batchSize ?? 10;
  const doArchive = opts.archive !== false;

  const memoryDir = opts.sourceDir
    ? path.resolve(opts.sourceDir)
    : path.join(opts.workspaceDir, MEMORY_DIR);

  const errors: string[] = [];
  let filesScanned = 0;
  let entriesParsed = 0;
  let entriesClassified = 0;
  let entriesRouted = 0;
  const topicsCreated: string[] = [];
  const topicsUpdated: string[] = [];
  let filesArchived = 0;

  let entries: ParsedMemoryEntry[];
  try {
    entries = await parseLegacyMemoryFiles(memoryDir, fsAdapter);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Failed to parse memory files: ${message}`);
    return {
      filesScanned: 0,
      entriesParsed: 0,
      entriesClassified: 0,
      entriesRouted: 0,
      topicsCreated: [],
      topicsUpdated: [],
      filesArchived: 0,
      errors,
    };
  }

  try {
    const dirFiles = await fsAdapter.readdir(memoryDir);
    filesScanned = dirFiles.filter((n) => DAILY_FILE_RE.test(n)).length;
  } catch {
    // directory may not exist
  }

  entriesParsed = entries.length;

  if (entries.length === 0) {
    return {
      filesScanned,
      entriesParsed: 0,
      entriesClassified: 0,
      entriesRouted: 0,
      topicsCreated: [],
      topicsUpdated: [],
      filesArchived: 0,
      errors,
    };
  }

  let classified: ClassifiedEntry[];
  if (opts.dryRun) {
    classified = heuristicClassify(entries);
  } else {
    classified = await classifyEntries(entries, opts.classifyFn, batchSize);
  }
  entriesClassified = classified.length;

  if (!opts.dryRun) {
    const routeResult = await routeToTopicFiles(classified, opts.workspaceDir, fsAdapter);
    entriesRouted = routeResult.entriesRouted;
    topicsCreated.push(...routeResult.topicsCreated);
    topicsUpdated.push(...routeResult.topicsUpdated);
  }

  if (!opts.dryRun && doArchive && classified.length > 0) {
    const sourceFiles = [...new Set(classified.map((e) => e.sourceFile))];
    filesArchived = await archiveProcessedFiles(sourceFiles, memoryDir, opts.workspaceDir, fsAdapter);
  }

  return {
    filesScanned,
    entriesParsed,
    entriesClassified,
    entriesRouted,
    topicsCreated,
    topicsUpdated,
    filesArchived,
    errors,
  };
}
