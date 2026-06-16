import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "../../infra/json-files.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/correction/pattern-registry");

/**
 * A regex pattern promoted from a reinforced correction record.
 * When a correction is reinforced enough times, its distinctive keywords
 * are compiled into a regex so similar mistakes are caught by the fast
 * pre-screen path without invoking the LLM extractor.
 */
export type PromotedPattern = {
  pattern: string;
  flags: string;
  source: string;
  createdAt: number;
};

const PATTERNS_FILE = join("cognitive", "corrections", "patterns.json");

/**
 * Registry of promoted regex patterns persisted to disk.
 *
 * Patterns are loaded asynchronously via {@link load} (or implicitly on first
 * {@link add}) and cached in memory. The {@link list} and {@link patterns}
 * accessors are synchronous and reflect the in-memory cache.
 */
export class PatternRegistry {
  private entries: PromotedPattern[] = [];
  private loaded = false;

  constructor(private readonly configDir: string) {}

  private filePath(): string {
    return join(this.configDir, PATTERNS_FILE);
  }

  /**
   * Load patterns from disk. Safe to call multiple times — only the first
   * call actually reads the file. Subsequent calls are no-ops.
   */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const path = this.filePath();
    if (!existsSync(path)) {
      return;
    }
    try {
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        this.entries = data.filter(isValidPattern);
      }
    } catch (err) {
      log.debug("failed to load promoted patterns", { error: String(err) });
    }
  }

  /**
   * Return a snapshot of all promoted patterns (in-memory).
   */
  list(): PromotedPattern[] {
    return [...this.entries];
  }

  /**
   * Compile all promoted patterns into RegExp instances.
   * Invalid patterns are silently skipped.
   */
  patterns(): RegExp[] {
    return this.entries
      .map((entry) => {
        try {
          return new RegExp(entry.pattern, entry.flags);
        } catch {
          return null;
        }
      })
      .filter((r): r is RegExp => r !== null);
  }

  /**
   * Add a new promoted pattern and persist to disk.
   * Ensures the registry is loaded before appending.
   */
  async add(entry: {
    pattern: string;
    flags: string;
    source: string;
  }): Promise<void> {
    await this.load();
    const record: PromotedPattern = {
      pattern: entry.pattern,
      flags: entry.flags,
      source: entry.source,
      createdAt: Date.now(),
    };
    this.entries.push(record);
    await writeJsonAtomic(this.filePath(), this.entries);
    log.debug("promoted pattern added", {
      pattern: entry.pattern,
      source: entry.source,
    });
  }
}

function isValidPattern(value: unknown): value is PromotedPattern {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.pattern === "string" &&
    typeof obj.flags === "string" &&
    typeof obj.source === "string" &&
    typeof obj.createdAt === "number"
  );
}
