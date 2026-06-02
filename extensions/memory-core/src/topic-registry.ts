/**
 * TopicRegistry — manages topic metadata in a single registry.json file.
 *
 * Tracks per-topic stats (entry count, last updated, description) for
 * efficient querying without reading individual topic files.
 * Uses atomic write (write to temp file, then rename).
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TopicMeta {
  name: string; // kebab-case slug, e.g. "philosophy"
  description: string; // LLM-generated 1-sentence summary of topic scope
  entryCount: number;
  lastUpdated: string; // YYYY-MM-DD
  createdAt: string; // YYYY-MM-DD
}

export interface TopicRegistryData {
  version: 1;
  topics: Record<string, TopicMeta>; // keyed by name
}

export interface TopicRegistryDeps {
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
const REGISTRY_FILE = "registry.json";

function resolveTopicsDir(workspaceDir: string): string {
  return path.join(workspaceDir, TOPICS_DIR);
}

function resolveRegistryPath(workspaceDir: string): string {
  return path.join(resolveTopicsDir(workspaceDir), REGISTRY_FILE);
}

// ---------------------------------------------------------------------------
// Atomic write helper
// ---------------------------------------------------------------------------

async function atomicWrite(
  fs: TopicRegistryDeps["fs"],
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
// Empty registry
// ---------------------------------------------------------------------------

function emptyRegistry(): TopicRegistryData {
  return { version: 1, topics: {} };
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (minimal, for syncFromDisk)
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: string): {
  subject: string;
  created: string;
  updated: string;
  entries: number;
} | null {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) { return null; }

  const yaml = fmMatch[1]!;
  let subject = "";
  let created = "";
  let updated = "";
  let entries = 0;

  for (const line of yaml.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) { continue; }
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key === "subject") { subject = value; }
    else if (key === "created") { created = value; }
    else if (key === "updated") { updated = value; }
    else if (key === "entries") { entries = Number(value) || 0; }
  }

  if (!subject) { return null; }
  return { subject, created, updated, entries };
}

// ---------------------------------------------------------------------------
// TopicRegistry class
// ---------------------------------------------------------------------------

export class TopicRegistry {
  private readonly deps: TopicRegistryDeps;

  constructor(deps: TopicRegistryDeps) {
    this.deps = deps;
  }

  private get workspaceDir(): string {
    return this.deps.workspaceDir;
  }

  private get fs(): TopicRegistryDeps["fs"] {
    return this.deps.fs;
  }

  /** Load registry from disk. Returns empty registry if file doesn't exist. */
  private async load(): Promise<TopicRegistryData> {
    const registryPath = resolveRegistryPath(this.workspaceDir);
    try {
      const raw = await this.fs.readFile(registryPath);
      return JSON.parse(raw) as TopicRegistryData;
    } catch {
      return emptyRegistry();
    }
  }

  /** Write registry to disk via atomic write. Creates topics dir if needed. */
  private async save(data: TopicRegistryData): Promise<void> {
    const topicsDir = resolveTopicsDir(this.workspaceDir);
    await this.fs.mkdir(topicsDir, { recursive: true });
    const registryPath = resolveRegistryPath(this.workspaceDir);
    await atomicWrite(this.fs, registryPath, JSON.stringify(data, null, 2));
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** List all topics sorted by name. Returns empty array if no registry. */
  async listTopics(): Promise<TopicMeta[]> {
    const data = await this.load();
    return Object.values(data.topics).toSorted((a, b) => a.name.localeCompare(b.name));
  }

  /** Get a single topic by name. Returns null if not found. */
  async getTopic(name: string): Promise<TopicMeta | null> {
    const data = await this.load();
    return data.topics[name] ?? null;
  }

  /** Create or update a topic entry. Writes immediately. */
  async upsertTopic(meta: TopicMeta): Promise<void> {
    const data = await this.load();
    data.topics[meta.name] = meta;
    await this.save(data);
  }

  /** Remove a topic entry. Writes immediately. */
  async removeTopic(name: string): Promise<void> {
    const data = await this.load();
    delete data.topics[name];
    await this.save(data);
  }

  /** Update stats after append/merge. Writes immediately. */
  async refreshStats(name: string, entryCount: number, lastUpdated: string): Promise<void> {
    const data = await this.load();
    const existing = data.topics[name];
    if (existing) {
      existing.entryCount = entryCount;
      existing.lastUpdated = lastUpdated;
      await this.save(data);
    }
  }

  /**
   * One-time migration/repair: scan topics directory, parse frontmatter from
   * each .md file, populate registry for missing entries.
   * Does NOT overwrite existing entries.
   * Returns count of new entries added.
   */
  async syncFromDisk(): Promise<number> {
    const data = await this.load();
    let added = 0;
    const topicsDir = resolveTopicsDir(this.workspaceDir);

    let files: string[];
    try {
      files = await this.fs.readdir(topicsDir);
    } catch {
      return 0;
    }

    const mdFiles = files.filter((f) => f.endsWith(".md"));

    for (const file of mdFiles) {
      const name = file.replace(/\.md$/, "");
      // Skip if already in registry
      if (data.topics[name]) { continue; }

      const filePath = path.join(topicsDir, file);
      let raw: string;
      try {
        raw = await this.fs.readFile(filePath);
      } catch {
        continue;
      }

      const parsed = parseFrontmatter(raw);
      if (!parsed) { continue; }

      data.topics[name] = {
        name,
        description: "",
        entryCount: parsed.entries,
        lastUpdated: parsed.updated || parsed.created || "",
        createdAt: parsed.created || "",
      };
      added++;
    }

    if (added > 0) {
      await this.save(data);
    }
    return added;
  }

  /** Convenience for LLM prompts: name + description for all topics. */
  async getDescriptionList(): Promise<Array<{ name: string; description: string }>> {
    const data = await this.load();
    return Object.values(data.topics)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ name: t.name, description: t.description }));
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTopicRegistry(deps: TopicRegistryDeps): TopicRegistry {
  return new TopicRegistry(deps);
}
