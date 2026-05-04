import type { EvolutionRecord, EvolutionConfig } from "./types.js";
import { DEFAULT_EVOLUTION_CONFIG } from "./types.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const COGNITIVE_DIR = "cognitive";
const EVOLUTION_DIR = "evolution";
const CONFIG_FILE = "config.json";

export function createEvolutionDir(configDir: string): string {
  return join(configDir, COGNITIVE_DIR, EVOLUTION_DIR);
}

export class EvolutionStore {
  constructor(private readonly configDir: string) {}

  private recordPath(userId: string): string {
    return join(createEvolutionDir(this.configDir), `${userId}.json`);
  }

  private configPath(): string {
    return join(createEvolutionDir(this.configDir), CONFIG_FILE);
  }

  async save(record: EvolutionRecord): Promise<void> {
    const dir = createEvolutionDir(this.configDir);
    await mkdir(dir, { recursive: true });

    const targetPath = this.recordPath(record.userId);
    const records = await this.loadRecords(record.userId);

    const existingIdx = records.findIndex((r) => r.id === record.id);
    if (existingIdx >= 0) {
      records[existingIdx] = record;
    } else {
      records.push(record);
    }

    await this.atomicWrite(targetPath, JSON.stringify(records, null, 2));
  }

  async list(userId: string): Promise<EvolutionRecord[]> {
    return this.loadRecords(userId);
  }

  async getRecentSuggestions(userId: string, hours: number): Promise<EvolutionRecord[]> {
    const records = await this.loadRecords(userId);
    const cutoff = Date.now() - hours * 3_600_000;
    return records.filter(
      (r) => r.timestamp > cutoff && r.decision?.shouldSuggest === true,
    );
  }

  async loadConfig(): Promise<EvolutionConfig> {
    const path = this.configPath();
    if (!existsSync(path)) return { ...DEFAULT_EVOLUTION_CONFIG };
    const raw = await readFile(path, "utf-8");
    return { ...DEFAULT_EVOLUTION_CONFIG, ...JSON.parse(raw) };
  }

  async saveConfig(config: EvolutionConfig): Promise<void> {
    const dir = createEvolutionDir(this.configDir);
    await mkdir(dir, { recursive: true });
    await this.atomicWrite(this.configPath(), JSON.stringify(config, null, 2));
  }

  private async loadRecords(userId: string): Promise<EvolutionRecord[]> {
    const path = this.recordPath(userId);
    if (!existsSync(path)) return [];
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as EvolutionRecord[];
    } catch {
      return [];
    }
  }

  private async atomicWrite(targetPath: string, content: string): Promise<void> {
    const tmpPath = join(tmpdir(), `kaijibot-evolution-${randomUUID()}.json`);
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, targetPath);
  }
}
