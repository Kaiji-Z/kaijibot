import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { InsightRecord } from "../types.js";

export class InsightStore {
  constructor(private readonly configDir: string) {}

  private insightsDir(agentId: string, userId: string): string {
    return join(this.configDir, "cognitive", "insights", agentId, userId);
  }

  async save(agentId: string, userId: string, record: InsightRecord): Promise<void> {
    const dir = this.insightsDir(agentId, userId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${record.id}.json`);
    await writeFile(path, JSON.stringify(record, null, 2), "utf-8");
  }

  async load(agentId: string, userId: string, id: string): Promise<InsightRecord | undefined> {
    const path = join(this.insightsDir(agentId, userId), `${id}.json`);
    if (!existsSync(path)) return undefined;
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as InsightRecord;
  }

  async listRecent(agentId: string, userId: string, limit?: number): Promise<InsightRecord[]> {
    const dir = this.insightsDir(agentId, userId);
    if (!existsSync(dir)) return [];

    const files = await readdir(dir);
    const records: InsightRecord[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        records.push(JSON.parse(raw) as InsightRecord);
      } catch {
        // Skip malformed files
      }
    }

    // Sort by generatedAt descending
    return records.sort((a, b) => b.generatedAt - a.generatedAt).slice(0, limit ?? 20);
  }

  async updateFeedback(
    agentId: string,
    userId: string,
    id: string,
    feedback: InsightRecord["feedback"],
    userResponse?: string,
  ): Promise<void> {
    const record = await this.load(agentId, userId, id);
    if (!record) return;
    record.feedback = feedback;
    if (userResponse !== undefined) record.userResponse = userResponse;
    await this.save(agentId, userId, record);
  }
}
