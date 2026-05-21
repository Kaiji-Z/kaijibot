import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
const CORRECTIONS_DIR = "cognitive/corrections";

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

  private correctionDir(agentId: string): string {
    return join(this.configDir, CORRECTIONS_DIR, agentId);
  }

  private recordPath(agentId: string, userId: string): string {
    return join(this.correctionDir(agentId), `${userId}.json`);
  }

  private async atomicWrite(targetPath: string, content: string): Promise<void> {
    const tmpPath = join(tmpdir(), `kaijibot-correction-${randomUUID()}.json`);
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, targetPath);
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

  private async writeRecords(agentId: string, userId: string, records: CorrectionRecord[]): Promise<void> {
    const dir = this.correctionDir(agentId);
    await mkdir(dir, { recursive: true });
    const data: CorrectionStoreData = {
      corrections: records.slice(-MAX_CORRECTIONS_PER_USER),
      version: CORRECTION_STORE_VERSION,
    };
    await this.atomicWrite(this.recordPath(agentId, userId), JSON.stringify(data, null, 2));
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
    log.info("correction reinforced", { id, reinforcedCount: target.reinforcedCount, agentId, userId });
  }

  async findSimilar(
    agentId: string,
    userId: string,
    domain: string,
    mistake: string,
  ): Promise<CorrectionRecord | undefined> {
    const records = await this.loadRecords(agentId, userId);
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
        .filter(name => name.endsWith(".json"))
        .map(name => name.slice(0, -5))
        .sort();
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
        if (s.isDirectory()) result.push(name);
      }
      return result.sort();
    } catch {
      return [];
    }
  }
}
