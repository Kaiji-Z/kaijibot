import type { InsightRecord } from "../types.js";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export class InsightStore {
  constructor(private readonly configDir: string) {}

  private insightsDir(userId: string): string {
    return join(this.configDir, "cognitive", "insights", userId);
  }

  async save(userId: string, record: InsightRecord): Promise<void> {
    const dir = this.insightsDir(userId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${record.id}.json`);
    await writeFile(path, JSON.stringify(record, null, 2), "utf-8");
  }

  async load(userId: string, id: string): Promise<InsightRecord | undefined> {
    const path = join(this.insightsDir(userId), `${id}.json`);
    if (!existsSync(path)) return undefined;
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as InsightRecord;
  }

  async listRecent(userId: string, limit?: number): Promise<InsightRecord[]> {
    const dir = this.insightsDir(userId);
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
    userId: string,
    id: string,
    feedback: InsightRecord["feedback"],
    userResponse?: string,
  ): Promise<void> {
    const record = await this.load(userId, id);
    if (!record) return;
    record.feedback = feedback;
    if (userResponse !== undefined) record.userResponse = userResponse;
    await this.save(userId, record);
  }
}
