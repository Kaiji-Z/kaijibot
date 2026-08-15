import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createAsyncLock, writeTextAtomic } from "../../infra/json-files.js";
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

type AsyncLock = <T>(fn: () => Promise<T>) => Promise<T>;

const MAX_USER_FACING_FIELD_CHARS = 2000;

// Patterns that indicate an LLM-generated correction field has been
// prompt-injected to carry imperative instructions rather than a genuine
// correction. Matched case-insensitively anywhere in the field; matched
// segments are replaced with a [redacted] marker so the surrounding context
// (which may still be a legitimate mistake description) is preserved.
const INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /ignore\s+(?:all\s+|the\s+|previous\s+)*(?:previous|prior|above)\s+(?:instructions?|prompts?|rules?)/gi,
  /\bsystem\s*:\s*/gi,
  /\bassistant\s*:\s*/gi,
  /\byou\s+are\s+now\b/gi,
  /\bnew\s+(?:instructions?|role|persona)\s*:/gi,
  /\bdisregard\b[^.!?]{0,80}(?:previous|above|prior)/gi,
  /\bact\s+as\s+if\b/gi,
  /\bpretend\s+(?:you\s+are|to\s+be)\b/gi,
  /\brefresh\s+your\s+instructions?\b/gi,
  /<\s*system\s*>/gi,
  /<\s*\|?(?:im_start|im_end|begin\s*of\s*text|end\s*of\s*text)\s*\|?>/gi,
  // Chinese equivalents — corrections are extracted from Chinese-conversation
  // transcripts, so English-only patterns redact none of the real attack text.
  /(?:忽略|无视|抛掉|跳过)(?:掉|所有)?(?:之前|以前|上面|上述|以上|先前)的?(?:所有)?(指令|指示|设定|提示词?|规则|要求|约束)/g,
  /系统\s*[:：]\s*/g,
  /助手的?角色\s*[:：]\s*/g,
  /你(?:现在|如今)是/g,
  /(?:新|新的)(?:指令|指示|角色|人设)\s*[:：]/g,
  /(?:请|来)?扮演(?:成|一个|你)/g,
  /假装(?:你是|自己是|成)/g,
  /(?:刷新|更新|重置)(?:一下)?(?:你的)?(?:指令|设定|人设|规则)/g,
  /<\s*系统\s*>/g,
];

const REDACTED = "[redacted-injection]";

function sanitizeUserFacingField(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }
  let out = value;
  for (const re of INJECTION_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, REDACTED);
  }
  if (out.length > MAX_USER_FACING_FIELD_CHARS) {
    out = out.slice(0, MAX_USER_FACING_FIELD_CHARS) + "…";
  }
  return out;
}

function sanitizeRecord(record: CorrectionRecord): CorrectionRecord {
  return {
    ...record,
    domain: sanitizeUserFacingField(record.domain),
    trigger: sanitizeUserFacingField(record.trigger),
    mistake: sanitizeUserFacingField(record.mistake),
    correction: sanitizeUserFacingField(record.correction),
  };
}

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
  private readonly locks = new Map<string, AsyncLock>();

  constructor(private readonly configDir: string) {}

  attachPatternRegistry(registry: PatternRegistry | null): void {
    this.patternRegistry = registry;
  }

  private async withLock<T>(agentId: string, userId: string, fn: () => Promise<T>): Promise<T> {
    const key = `${agentId}/${userId}`;
    let lock = this.locks.get(key);
    if (!lock) {
      lock = createAsyncLock();
      this.locks.set(key, lock);
    }
    return lock(fn);
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
    const sanitized = sanitizeRecord(record);
    await this.withLock(agentId, userId, async () => {
      await this.addUnlocked(agentId, userId, sanitized);
    });
  }

  private async addUnlocked(
    agentId: string,
    userId: string,
    sanitized: CorrectionRecord,
  ): Promise<void> {
    const records = await this.loadRecords(agentId, userId);
    const withDefaults: CorrectionRecord = {
      ...sanitized,
      usageCount: sanitized.usageCount ?? 0,
    };
    records.push(withDefaults);
    await this.writeRecords(agentId, userId, records);
    log.info("correction added", {
      id: withDefaults.id,
      domain: sanitized.domain,
      agentId,
      userId,
    });
  }

  async reinforce(agentId: string, userId: string, id: string): Promise<void> {
    let promoted = false;
    let reinforcedCount = 0;
    await this.withLock(agentId, userId, async () => {
      const result = await this.reinforceUnlocked(agentId, userId, id);
      promoted = result.promoted;
      reinforcedCount = result.reinforcedCount;
    });
    log.info("correction reinforced", {
      id,
      reinforcedCount,
      agentId,
      userId,
      promoted,
    });
  }

  private async reinforceUnlocked(
    agentId: string,
    userId: string,
    id: string,
  ): Promise<{ reinforcedCount: number; promoted: boolean }> {
    const records = await this.loadRecords(agentId, userId);
    const target = records.find((r) => r.id === id);
    if (!target) {
      return { reinforcedCount: 0, promoted: false };
    }
    target.reinforcedCount++;
    target.lastReinforced = Date.now();
    await this.writeRecords(agentId, userId, records);
    if (target.reinforcedCount === PROMOTE_AT_REINFORCEMENT_COUNT && this.patternRegistry) {
      try {
        await this.maybePromoteToPattern(target);
        return { reinforcedCount: target.reinforcedCount, promoted: true };
      } catch (err) {
        log.debug("pattern promotion failed (non-fatal)", {
          id,
          error: String(err),
        });
      }
    }
    return { reinforcedCount: target.reinforcedCount, promoted: false };
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
    return this.withLock(agentId, userId, async () => {
      const sanitized = sanitizeRecord(record);
      const existing = await this.findSimilar(agentId, userId, sanitized.domain, sanitized.mistake);
      if (existing) {
        await this.reinforceUnlocked(agentId, userId, existing.id);
        return "reinforced";
      }
      await this.addUnlocked(agentId, userId, sanitized);
      return "added";
    });
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
    return this.withLock(agentId, userId, async () => {
      const records = await this.loadRecords(agentId, userId);
      const ttl = (ttlDays ?? DEFAULT_CORRECTION_TTL_DAYS) * 86_400_000;
      const now = Date.now();
      const cutoff = now - ttl;
      const refCutoff = now - (ttl * 2) / 3;
      const active = records.filter((r) => {
        if (r.lastReinforced < cutoff) {
          return false;
        }
        if (
          r.usageCount !== undefined &&
          r.usageCount > 0 &&
          r.lastReferencedAt !== undefined &&
          r.lastReferencedAt < refCutoff
        ) {
          return false;
        }
        return true;
      });
      const removed = records.length - active.length;
      if (removed > 0) {
        await this.writeRecords(agentId, userId, active);
      }
      return removed;
    });
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

  async removeByIds(agentId: string, userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    return this.withLock(agentId, userId, async () => {
      const records = await this.loadRecords(agentId, userId);
      const idSet = new Set(ids);
      const remaining = records.filter((r) => !idSet.has(r.id));
      const removed = records.length - remaining.length;
      if (removed > 0) {
        await this.writeRecords(agentId, userId, remaining);
      }
      return removed;
    });
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
