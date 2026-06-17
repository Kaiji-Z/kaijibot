import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeTextAtomic } from "../../infra/json-files.js";
import { textSimilarity } from "../../infra/text-similarity.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { PatternRegistry } from "./pattern-registry.js";
import {
  CORRECTION_STORE_VERSION,
  DEFAULT_CORRECTION_TTL_DAYS,
  JACCARD_SIMILARITY_THRESHOLD,
  MAX_CORRECTIONS_PER_USER,
} from "./types.js";
import type { CorrectionRecord, CorrectionStoreData } from "./types.js";

const log = createSubsystemLogger("correction");
const CORRECTIONS_DIR = "cognitive/corrections";

const PROMOTE_AT_REINFORCEMENT_COUNT = 5;

const TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "not",
  "but",
  "with",
  "this",
  "that",
  "from",
  "have",
  "was",
  "were",
  "are",
  "has",
  "had",
  "you",
  "your",
  "使用",
  "应该",
  "需要",
  "没有",
]);

export class CorrectionStore {
  private patternRegistry: PatternRegistry | null = null;

  constructor(private readonly configDir: string) {}

  attachPatternRegistry(registry: PatternRegistry | null): void {
    this.patternRegistry = registry;
  }

  private correctionDir(agentId: string): string {
    return join(this.configDir, CORRECTIONS_DIR, agentId);
  }

  private recordPath(agentId: string, userId: string): string {
    return join(this.correctionDir(agentId), `${userId}.json`);
  }

  private async loadRecords(agentId: string, userId: string): Promise<CorrectionRecord[]> {
    const path = this.recordPath(agentId, userId);
    if (!existsSync(path)) {
      return [];
    }
    try {
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw) as CorrectionStoreData;
      if (Array.isArray(data.corrections)) {
        return data.corrections;
      }
      return [];
    } catch {
      return [];
    }
  }

  private async writeRecords(
    agentId: string,
    userId: string,
    records: CorrectionRecord[],
  ): Promise<void> {
    const dir = this.correctionDir(agentId);
    await mkdir(dir, { recursive: true });
    const data: CorrectionStoreData = {
      corrections: records.slice(-MAX_CORRECTIONS_PER_USER),
      version: CORRECTION_STORE_VERSION,
    };
    await writeTextAtomic(this.recordPath(agentId, userId), JSON.stringify(data, null, 2));
  }

  async add(agentId: string, userId: string, record: CorrectionRecord): Promise<void> {
    const records = await this.loadRecords(agentId, userId);
    records.push(record);
    await this.writeRecords(agentId, userId, records);
    log.info("correction added", { id: record.id, domain: record.domain, agentId, userId });
  }

  async reinforce(agentId: string, userId: string, id: string): Promise<void> {
    const records = await this.loadRecords(agentId, userId);
    const target = records.find((r) => r.id === id);
    if (!target) {
      return;
    }
    target.reinforcedCount++;
    target.lastReinforced = Date.now();
    await this.writeRecords(agentId, userId, records);
    log.info("correction reinforced", {
      id,
      reinforcedCount: target.reinforcedCount,
      agentId,
      userId,
    });

    if (target.reinforcedCount === PROMOTE_AT_REINFORCEMENT_COUNT && this.patternRegistry) {
      try {
        await this.maybePromoteToPattern(target);
      } catch (err) {
        log.debug("pattern promotion failed (non-fatal)", {
          id,
          error: String(err),
        });
      }
    }
  }

  private async maybePromoteToPattern(target: CorrectionRecord): Promise<void> {
    const tokens = extractDistinctiveTokens(`${target.trigger} ${target.mistake}`);
    if (tokens.length === 0) {
      return;
    }
    const pattern = `(${tokens.join("|")})`;
    await this.patternRegistry!.add({
      pattern,
      flags: "i",
      source: "auto-promoted",
    });
    log.info("correction promoted to pattern", {
      id: target.id,
      domain: target.domain,
      pattern,
    });
  }

  async findSimilar(
    agentId: string,
    userId: string,
    domain: string,
    mistake: string,
  ): Promise<CorrectionRecord | undefined> {
    const normalizedDomain = domain.toLowerCase().trim();
    const records = await this.loadRecords(agentId, userId);
    for (const record of records) {
      if (record.domain.toLowerCase().trim() !== normalizedDomain) {
        continue;
      }
      const similarity = textSimilarity(record.mistake, mistake);
      if (similarity > JACCARD_SIMILARITY_THRESHOLD) {
        return record;
      }
    }
    return undefined;
  }

  async addOrReinforce(
    agentId: string,
    userId: string,
    record: CorrectionRecord,
  ): Promise<"added" | "reinforced"> {
    const existing = await this.findSimilar(agentId, userId, record.domain, record.mistake);
    if (existing) {
      await this.reinforce(agentId, userId, existing.id);
      return "reinforced";
    }
    await this.add(agentId, userId, record);
    return "added";
  }

  async listActive(agentId: string, userId: string, ttlDays?: number): Promise<CorrectionRecord[]> {
    const records = await this.loadRecords(agentId, userId);
    const ttl = (ttlDays ?? DEFAULT_CORRECTION_TTL_DAYS) * 86_400_000;
    const cutoff = Date.now() - ttl;
    return records
      .filter((r) => r.lastReinforced >= cutoff)
      .toSorted((a, b) => b.reinforcedCount - a.reinforcedCount);
  }

  async loadAll(agentId: string, userId: string): Promise<CorrectionRecord[]> {
    return this.loadRecords(agentId, userId);
  }

  async removeStale(agentId: string, userId: string, ttlDays?: number): Promise<number> {
    const records = await this.loadRecords(agentId, userId);
    const ttl = (ttlDays ?? DEFAULT_CORRECTION_TTL_DAYS) * 86_400_000;
    const cutoff = Date.now() - ttl;
    const active = records.filter((r) => r.lastReinforced >= cutoff);
    const removed = records.length - active.length;
    if (removed > 0) {
      await this.writeRecords(agentId, userId, active);
    }
    return removed;
  }

  async listUserIds(agentId: string): Promise<string[]> {
    const dir = join(this.configDir, CORRECTIONS_DIR, agentId);
    try {
      const entries = await readdir(dir);
      return entries
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -5))
        .toSorted();
    } catch {
      return [];
    }
  }

  async listAgentIds(): Promise<string[]> {
    const dir = join(this.configDir, CORRECTIONS_DIR);
    try {
      const entries = await readdir(dir);
      const result: string[] = [];
      for (const name of entries) {
        const full = join(dir, name);
        const s = await stat(full);
        if (s.isDirectory()) {
          result.push(name);
        }
      }
      return result.toSorted();
    } catch {
      return [];
    }
  }
}

const TOKEN_SPLIT_RE = /[\s,，。、；;：:！!？?（）()[\]{}'"""''《》<>/\\|`~@#$%^&*\-_=+]+/;
const MAX_PROMOTED_TOKENS = 3;

function extractDistinctiveTokens(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(TOKEN_SPLIT_RE)) {
    const token = raw.trim();
    if (token.length < 3) {
      continue;
    }
    const lower = token.toLowerCase();
    if (TOKEN_STOPWORDS.has(lower)) {
      continue;
    }
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    result.push(token);
    if (result.length >= MAX_PROMOTED_TOKENS) {
      break;
    }
  }
  return result;
}
