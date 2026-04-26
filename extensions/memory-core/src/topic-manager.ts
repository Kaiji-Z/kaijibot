/**
 * TopicManager — CRUD operations for topic files on disk.
 *
 * Reads and writes Markdown topic files under memory/topics/ with atomic
 * write semantics (write to temp file, then rename).
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  type TopicFile,
  type TopicEntry,
  parseTopicFile,
  serializeTopicFile,
  createEmptyTopicFile,
} from "./topic-types.js";

// ---------------------------------------------------------------------------
// Dependencies (injected for testability)
// ---------------------------------------------------------------------------

export interface TopicManagerDeps {
  workspaceDir: string;
  fs: {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, data: string) => Promise<void>;
    mkdir: (path: string, options: { recursive: boolean }) => Promise<void>;
    readdir: (path: string) => Promise<string[]>;
    stat: (path: string) => Promise<{ mtimeMs: number; size: number }>;
    rename: (oldPath: string, newPath: string) => Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const TOPICS_DIR = "memory/topics";

function normalizeTopicName(name: string): string {
  const trimmed = name.replace(/\.md$/i, "");
  return `${trimmed}.md`;
}

function resolveTopicPath(workspaceDir: string, name: string): string {
  return path.join(workspaceDir, TOPICS_DIR, normalizeTopicName(name));
}

function resolveTopicsDir(workspaceDir: string): string {
  return path.join(workspaceDir, TOPICS_DIR);
}

// ---------------------------------------------------------------------------
// Atomic write helper
// ---------------------------------------------------------------------------

async function atomicWrite(
  fs: TopicManagerDeps["fs"],
  targetPath: string,
  data: string,
): Promise<void> {
  const dir = path.dirname(targetPath);
  const tmpName = `${path.basename(targetPath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  const tmpPath = path.join(dir, tmpName);
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, targetPath);
}

// ---------------------------------------------------------------------------
// TopicManager
// ---------------------------------------------------------------------------

export class TopicManager {
  private readonly deps: TopicManagerDeps;

  constructor(deps: TopicManagerDeps) {
    this.deps = deps;
  }

  private get workspaceDir(): string {
    return this.deps.workspaceDir;
  }

  private get fs(): TopicManagerDeps["fs"] {
    return this.deps.fs;
  }

  async ensureTopicsDir(): Promise<void> {
    await this.fs.mkdir(resolveTopicsDir(this.workspaceDir), { recursive: true });
  }

  async listTopics(): Promise<string[]> {
    const dir = resolveTopicsDir(this.workspaceDir);
    let names: string[];
    try {
      names = await this.fs.readdir(dir);
    } catch {
      return [];
    }
    return names.filter((n) => n.endsWith(".md")).toSorted();
  }

  async getTopic(name: string): Promise<TopicFile | null> {
    const filePath = resolveTopicPath(this.workspaceDir, name);
    let raw: string;
    try {
      raw = await this.fs.readFile(filePath);
    } catch {
      return null;
    }
    return parseTopicFile(raw);
  }

  async createTopic(subject: string, name: string): Promise<TopicFile> {
    await this.ensureTopicsDir();
    const topic = createEmptyTopicFile(subject, name);
    const filePath = resolveTopicPath(this.workspaceDir, name);
    await atomicWrite(this.fs, filePath, serializeTopicFile(topic));
    return topic;
  }

  async appendEntry(name: string, entry: TopicEntry): Promise<void> {
    const topic = await this.getTopic(name);
    if (!topic) {
      throw new Error(`Topic not found: ${name}`);
    }

    const today = new Date().toISOString().slice(0, 10);
    topic.entries.push(entry);
    topic.frontmatter.entries = topic.entries.length;
    topic.frontmatter.updated = today;

    const filePath = resolveTopicPath(this.workspaceDir, name);
    await atomicWrite(this.fs, filePath, serializeTopicFile(topic));
  }

  async updateEntry(name: string, entryIndex: number, newContent: string): Promise<void> {
    const topic = await this.getTopic(name);
    if (!topic) {
      throw new Error(`Topic not found: ${name}`);
    }
    if (entryIndex < 0 || entryIndex >= topic.entries.length) {
      throw new Error(`Entry index out of range: ${entryIndex} (entries: ${topic.entries.length})`);
    }

    topic.entries[entryIndex]!.content = newContent;
    topic.frontmatter.updated = new Date().toISOString().slice(0, 10);

    const filePath = resolveTopicPath(this.workspaceDir, name);
    await atomicWrite(this.fs, filePath, serializeTopicFile(topic));
  }

  async mergeEntries(name: string, indices: number[], mergedContent: string): Promise<void> {
    const topic = await this.getTopic(name);
    if (!topic) {
      throw new Error(`Topic not found: ${name}`);
    }
    if (indices.length === 0) return;

    for (const idx of indices) {
      if (idx < 0 || idx >= topic.entries.length) {
        throw new Error(`Entry index out of range: ${idx} (entries: ${topic.entries.length})`);
      }
    }

    const sortedIndices = [...indices].toSorted((a, b) => a - b);
    const firstEntry = topic.entries[sortedIndices[0]!]!;

    const mergedEntry: TopicEntry = {
      ...firstEntry,
      content: mergedContent,
    };

    // Remove entries in reverse order to keep indices stable
    for (let i = sortedIndices.length - 1; i >= 0; i--) {
      topic.entries.splice(sortedIndices[i]!, 1);
    }

    // Insert merged entry at the first original position
    topic.entries.splice(sortedIndices[0]!, 0, mergedEntry);

    topic.frontmatter.entries = topic.entries.length;
    topic.frontmatter.updated = new Date().toISOString().slice(0, 10);

    const filePath = resolveTopicPath(this.workspaceDir, name);
    await atomicWrite(this.fs, filePath, serializeTopicFile(topic));
  }

  async deleteTopic(name: string): Promise<void> {
    const filePath = resolveTopicPath(this.workspaceDir, name);
    try {
      await atomicWrite(this.fs, filePath, "");
    } catch {
      // already absent
    }
  }
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

export function createTopicManager(deps: TopicManagerDeps): TopicManager {
  return new TopicManager(deps);
}
