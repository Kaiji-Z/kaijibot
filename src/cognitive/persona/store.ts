import type { PersonaTree } from "../types.js";
import { mkdir, readFile, readdir, rename, stat, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { safeParsePersona } from "./persona-schema.js";

const COGNITIVE_DIR = "cognitive";
const PERSONA_DIR = "persona";

const MIGRATION_SKIP_USER_IDS = new Set([
  "main",
  "kaijibot-tui",
  "slug-generator",
]);

function shouldMigrateFlatFile(userId: string, persona: PersonaTree | null): boolean {
  if (MIGRATION_SKIP_USER_IDS.has(userId)) return false;
  if (!persona) return false;
  if (userId.startsWith("ou_")) return true;
  return Object.keys(persona.domains).length > 0 || persona.rapport.totalExchanges > 0;
}

export class PersonaStore {
  constructor(private readonly configDir: string) {}

  /**
   * Migrate legacy flat persona files from `persona/{userId}.json`
   * to the new directory layout `persona/main/{userId}.json`.
   * Safe to call multiple times — no-ops if already migrated.
   */
  async migrateFromFlatLayout(): Promise<{ migrated: string[]; skipped: string[] }> {
    const personaDir = join(this.configDir, COGNITIVE_DIR, PERSONA_DIR);
    if (!existsSync(personaDir)) return { migrated: [], skipped: [] };

    const entries = await readdir(personaDir);
    const jsonFiles = entries.filter((name) => name.endsWith(".json"));
    if (jsonFiles.length === 0) return { migrated: [], skipped: [] };

    const migrated: string[] = [];
    const skipped: string[] = [];

    for (const fileName of jsonFiles) {
      const userId = fileName.slice(0, -5);
      const srcPath = join(personaDir, fileName);
      const dstPath = this.personaPath("main", userId);

      if (existsSync(dstPath)) {
        skipped.push(userId);
        continue;
      }

      let persona: PersonaTree | null = null;
      try {
        const raw = await readFile(srcPath, "utf-8");
        persona = safeParsePersona(JSON.parse(raw));
      } catch {
        skipped.push(userId);
        continue;
      }

      if (shouldMigrateFlatFile(userId, persona)) {
        const targetDir = join(this.configDir, COGNITIVE_DIR, PERSONA_DIR, "main");
        await mkdir(targetDir, { recursive: true });
        await rename(srcPath, dstPath);
        migrated.push(userId);
      } else {
        skipped.push(userId);
      }
    }

    if (migrated.length > 0) {
      console.info(`[PersonaStore] Migrated ${migrated.length} persona(s) to main/ subdirectory: ${migrated.join(", ")}`);
    }

    return { migrated, skipped };
  }

  private personaPath(agentId: string, userId: string): string {
    return join(this.configDir, COGNITIVE_DIR, PERSONA_DIR, agentId, `${userId}.json`);
  }

  async load(agentId: string, userId: string): Promise<PersonaTree | undefined> {
    const path = this.personaPath(agentId, userId);
    if (!existsSync(path)) return undefined;
    const raw = await readFile(path, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(`[PersonaStore] Malformed JSON for ${agentId}/${userId}, ignoring`);
      return undefined;
    }
    const validated = safeParsePersona(parsed);
    if (validated === null) {
      console.warn(`[PersonaStore] Invalid persona JSON for ${agentId}/${userId}, ignoring`);
      return undefined;
    }
    // Backfill userId for personas created before identity.userId was persisted
    if (!validated.identity.userId) {
      validated.identity.userId = userId;
    }
    return validated;
  }

  async save(agentId: string, userId: string, persona: PersonaTree): Promise<void> {
    const dir = join(this.configDir, COGNITIVE_DIR, PERSONA_DIR, agentId);
    await mkdir(dir, { recursive: true });
    const targetPath = this.personaPath(agentId, userId);
    const tmpPath = join(tmpdir(), `kaijibot-persona-${randomUUID()}.json`);
    await writeFile(tmpPath, JSON.stringify(persona, null, 2), "utf-8");
    await rename(tmpPath, targetPath);
  }

  async loadOrCreate(agentId: string, userId: string): Promise<PersonaTree> {
    const existing = await this.load(agentId, userId);
    if (existing) return existing;
    const persona = createDefaultPersona();
    persona.identity.userId = userId;
    return persona;
  }

  async listUserIds(agentId: string): Promise<string[]> {
    const dir = join(this.configDir, COGNITIVE_DIR, PERSONA_DIR, agentId);
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
    const dir = join(this.configDir, COGNITIVE_DIR, PERSONA_DIR);
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

export function createDefaultPersona(): PersonaTree {
  return {
    identity: {
      coreTraits: {},
      expertDomains: [],
      interestDomains: [],
      curiosityDomains: [],
    },
    domains: {},
    recentFocus: [],
    activeProjects: [],
    moodHistory: [],
    feedbackProfile: {
      topicBandits: {},
      preferredStyle: "observation",
      optimalFrequencyHours: 4,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [],
      recentInsightDomains: [],
      recentInsightTypes: [],
    },
    rapport: {
      trustScore: 0.1,
      totalExchanges: 0,
      avgResponseLength: 0,
      selfDisclosureLevel: 0,
    },
    domainBlacklist: [],
    lifecycle: {
      stage: "new",
      lastActiveAt: 0,
      lastStageTransitionAt: 0,
      consecutiveSilentDays: 0,
      totalActiveDays: 0,
    },
    calibrationHistory: [],
    contradictionLog: [],
  };
}
