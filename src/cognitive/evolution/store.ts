import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EvolutionRecord, EvolutionConfig } from "./types.js";
import { DEFAULT_EVOLUTION_CONFIG } from "./types.js";
import { writeTextAtomic } from "../../infra/json-files.js";

const COGNITIVE_DIR = "cognitive";
const EVOLUTION_DIR = "evolution";
const CONFIG_FILE = "config.json";

export function createEvolutionDir(configDir: string, agentId?: string): string {
  if (agentId) {
    return join(configDir, COGNITIVE_DIR, EVOLUTION_DIR, agentId);
  }
  return join(configDir, COGNITIVE_DIR, EVOLUTION_DIR);
}

export class EvolutionStore {
  constructor(private readonly configDir: string) {}

  private recordPath(agentId: string, userId: string): string {
    return join(createEvolutionDir(this.configDir, agentId), `${userId}.json`);
  }

  private configPath(agentId: string): string {
    return join(createEvolutionDir(this.configDir, agentId), CONFIG_FILE);
  }

  async save(agentId: string, record: EvolutionRecord): Promise<void> {
    const dir = createEvolutionDir(this.configDir, agentId);
    await mkdir(dir, { recursive: true });

    const targetPath = this.recordPath(agentId, record.userId);
    const records = await this.loadRecords(agentId, record.userId);

    const existingIdx = records.findIndex((r) => r.id === record.id);
    if (existingIdx >= 0) {
      records[existingIdx] = record;
    } else {
      records.push(record);
    }

    await writeTextAtomic(targetPath, JSON.stringify(records, null, 2));
  }

  async list(agentId: string, userId: string): Promise<EvolutionRecord[]> {
    return this.loadRecords(agentId, userId);
  }

  async getRecentSuggestions(
    agentId: string,
    userId: string,
    hours: number,
  ): Promise<EvolutionRecord[]> {
    const records = await this.loadRecords(agentId, userId);
    const cutoff = Date.now() - hours * 3_600_000;
    return records.filter((r) => r.timestamp > cutoff && r.decision?.shouldSuggest === true);
  }

  async loadConfig(agentId: string): Promise<EvolutionConfig> {
    const path = this.configPath(agentId);
    if (!existsSync(path)) {return { ...DEFAULT_EVOLUTION_CONFIG };}
    const raw = await readFile(path, "utf-8");
    return { ...DEFAULT_EVOLUTION_CONFIG, ...JSON.parse(raw) };
  }

  async saveConfig(agentId: string, config: EvolutionConfig): Promise<void> {
    const dir = createEvolutionDir(this.configDir, agentId);
    await mkdir(dir, { recursive: true });
    await writeTextAtomic(this.configPath(agentId), JSON.stringify(config, null, 2));
  }

  private async loadRecords(agentId: string, userId: string): Promise<EvolutionRecord[]> {
    const path = this.recordPath(agentId, userId);
    if (!existsSync(path)) {return [];}
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as EvolutionRecord[];
    } catch {
      return [];
    }
  }

  async listUserIds(agentId: string): Promise<string[]> {
    const dir = createEvolutionDir(this.configDir, agentId);
    try {
      const entries = await readdir(dir);
      return entries
        .filter((name) => name.endsWith(".json") && name !== CONFIG_FILE)
        .map((name) => name.slice(0, -5))
        .toSorted();
    } catch {
      return [];
    }
  }

  async listAgentIds(): Promise<string[]> {
    const dir = createEvolutionDir(this.configDir);
    try {
      const entries = await readdir(dir);
      const result: string[] = [];
      for (const name of entries) {
        const full = join(dir, name);
        const s = await stat(full);
        if (s.isDirectory()) {result.push(name);}
      }
      return result.toSorted();
    } catch {
      return [];
    }
  }
}
