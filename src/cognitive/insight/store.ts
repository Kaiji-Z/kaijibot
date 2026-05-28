import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeTextAtomic } from "../../infra/json-files.js";
import type { InsightRecord } from "../types.js";

const DEFAULT_INSIGHT_TTL_DAYS = 60;
const MAX_INSIGHTS_PER_USER = 200;
const INSIGHT_STORE_VERSION = 1;

type InsightStoreData = {
  insights: InsightRecord[];
  version: number;
};

export class InsightStore {
  constructor(private readonly configDir: string) {}

  private insightsDir(agentId: string): string {
    return join(this.configDir, "cognitive", "insights", agentId);
  }

  private recordPath(agentId: string, userId: string): string {
    return join(this.insightsDir(agentId), `${userId}.json`);
  }

  private async loadRecords(agentId: string, userId: string): Promise<InsightRecord[]> {
    const path = this.recordPath(agentId, userId);
    if (!existsSync(path)) return [];
    try {
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw) as InsightStoreData;
      return Array.isArray(data.insights) ? data.insights : [];
    } catch {
      return [];
    }
  }

  private async writeRecords(
    agentId: string,
    userId: string,
    records: InsightRecord[],
  ): Promise<void> {
    const dir = this.insightsDir(agentId);
    await mkdir(dir, { recursive: true });
    const data: InsightStoreData = {
      insights: records.slice(-MAX_INSIGHTS_PER_USER),
      version: INSIGHT_STORE_VERSION,
    };
    await writeTextAtomic(this.recordPath(agentId, userId), JSON.stringify(data, null, 2));
  }

  async save(agentId: string, userId: string, record: InsightRecord): Promise<void> {
    const records = await this.loadRecords(agentId, userId);
    records.push(record);
    await this.writeRecords(agentId, userId, records);
  }

  async load(agentId: string, userId: string, id: string): Promise<InsightRecord | undefined> {
    const records = await this.loadRecords(agentId, userId);
    return records.find((r) => r.id === id);
  }

  async listRecent(agentId: string, userId: string, limit?: number): Promise<InsightRecord[]> {
    const records = await this.loadRecords(agentId, userId);
    return records.sort((a, b) => b.generatedAt - a.generatedAt).slice(0, limit ?? 20);
  }

  async listActive(
    agentId: string,
    userId: string,
    ttlDays?: number,
    limit?: number,
  ): Promise<InsightRecord[]> {
    const ttl = (ttlDays ?? DEFAULT_INSIGHT_TTL_DAYS) * 86_400_000;
    const cutoff = Date.now() - ttl;
    const records = await this.loadRecords(agentId, userId);
    return records
      .filter((r) => r.generatedAt >= cutoff)
      .sort((a, b) => b.generatedAt - a.generatedAt)
      .slice(0, limit ?? 20);
  }

  async updateFeedback(
    agentId: string,
    userId: string,
    id: string,
    feedback: InsightRecord["feedback"],
    userResponse?: string,
  ): Promise<void> {
    const records = await this.loadRecords(agentId, userId);
    const record = records.find((r) => r.id === id);
    if (!record) return;
    record.feedback = feedback;
    if (userResponse !== undefined) record.userResponse = userResponse;
    await this.writeRecords(agentId, userId, records);
  }

  async removeStale(agentId: string, userId: string, ttlDays?: number): Promise<number> {
    const records = await this.loadRecords(agentId, userId);
    const ttl = (ttlDays ?? DEFAULT_INSIGHT_TTL_DAYS) * 86_400_000;
    const cutoff = Date.now() - ttl;
    const active = records.filter((r) => r.generatedAt >= cutoff);
    const removed = records.length - active.length;
    if (removed > 0) {
      await this.writeRecords(agentId, userId, active);
    }
    return removed;
  }

  async listUserIds(agentId: string): Promise<string[]> {
    const dir = this.insightsDir(agentId);
    try {
      const entries = await readdir(dir);
      return entries
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -5))
        .sort();
    } catch {
      return [];
    }
  }

  async listAgentIds(): Promise<string[]> {
    const dir = join(this.configDir, "cognitive", "insights");
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
