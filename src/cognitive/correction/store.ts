import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  CORRECTION_STORE_VERSION,
  DEFAULT_CORRECTION_TTL_DAYS,
  JACCARD_SIMILARITY_THRESHOLD,
  MAX_CORRECTIONS_PER_USER,
} from "./types.js";
import type { CorrectionRecord, CorrectionStoreData } from "./types.js";

const log = createSubsystemLogger("correction");

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[\s,.;:!?()[\]{}'"<>/\\|~`@#$%^&*+=\-_]+/)
      .filter(Boolean),
  );
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection++;
    }
  }
  return intersection / (setA.size + setB.size - intersection);
}

export class CorrectionStore {
  constructor(private readonly configDir: string) {}

  private correctionDir(): string {
    return join(this.configDir, "cognitive", "corrections");
  }

  private recordPath(userId: string): string {
    return join(this.correctionDir(), `${userId}.json`);
  }

  private async atomicWrite(targetPath: string, content: string): Promise<void> {
    const tmpPath = join(tmpdir(), `kaijibot-correction-${randomUUID()}.json`);
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, targetPath);
  }

  private async loadRecords(userId: string): Promise<CorrectionRecord[]> {
    const path = this.recordPath(userId);
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

  private async writeRecords(userId: string, records: CorrectionRecord[]): Promise<void> {
    const dir = this.correctionDir();
    await mkdir(dir, { recursive: true });
    const data: CorrectionStoreData = {
      corrections: records.slice(-MAX_CORRECTIONS_PER_USER),
      version: CORRECTION_STORE_VERSION,
    };
    await this.atomicWrite(this.recordPath(userId), JSON.stringify(data, null, 2));
  }

  async add(userId: string, record: CorrectionRecord): Promise<void> {
    const records = await this.loadRecords(userId);
    records.push(record);
    await this.writeRecords(userId, records);
    log.info("correction added", { id: record.id, domain: record.domain, userId });
  }

  async reinforce(userId: string, id: string): Promise<void> {
    const records = await this.loadRecords(userId);
    const target = records.find((r) => r.id === id);
    if (!target) {
      return;
    }
    target.reinforcedCount++;
    target.lastReinforced = Date.now();
    await this.writeRecords(userId, records);
    log.info("correction reinforced", { id, reinforcedCount: target.reinforcedCount, userId });
  }

  async findSimilar(
    userId: string,
    domain: string,
    mistake: string,
  ): Promise<CorrectionRecord | undefined> {
    const records = await this.loadRecords(userId);
    for (const record of records) {
      if (record.domain !== domain) {
        continue;
      }
      const similarity = jaccardSimilarity(record.mistake, mistake);
      if (similarity > JACCARD_SIMILARITY_THRESHOLD) {
        return record;
      }
    }
    return undefined;
  }

  async addOrReinforce(
    userId: string,
    record: CorrectionRecord,
  ): Promise<"added" | "reinforced"> {
    const existing = await this.findSimilar(userId, record.domain, record.mistake);
    if (existing) {
      await this.reinforce(userId, existing.id);
      return "reinforced";
    }
    await this.add(userId, record);
    return "added";
  }

  async listActive(userId: string, ttlDays?: number): Promise<CorrectionRecord[]> {
    const records = await this.loadRecords(userId);
    const ttl = (ttlDays ?? DEFAULT_CORRECTION_TTL_DAYS) * 86_400_000;
    const cutoff = Date.now() - ttl;
    return records
      .filter((r) => r.lastReinforced >= cutoff)
      .toSorted((a, b) => b.reinforcedCount - a.reinforcedCount);
  }

  async loadAll(userId: string): Promise<CorrectionRecord[]> {
    return this.loadRecords(userId);
  }

  async removeStale(userId: string, ttlDays?: number): Promise<number> {
    const records = await this.loadRecords(userId);
    const ttl = (ttlDays ?? DEFAULT_CORRECTION_TTL_DAYS) * 86_400_000;
    const cutoff = Date.now() - ttl;
    const active = records.filter((r) => r.lastReinforced >= cutoff);
    const removed = records.length - active.length;
    if (removed > 0) {
      await this.writeRecords(userId, active);
    }
    return removed;
  }
}
