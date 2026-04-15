import type { PersonaTree } from "../types.js";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { safeParsePersona } from "./persona-schema.js";

const COGNITIVE_DIR = "cognitive";
const PERSONA_DIR = "persona";

export class PersonaStore {
  constructor(private readonly configDir: string) {}

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
    return validated;
  }

  async save(agentId: string, userId: string, persona: PersonaTree): Promise<void> {
    const dir = join(this.configDir, COGNITIVE_DIR, PERSONA_DIR, agentId);
    await mkdir(dir, { recursive: true });
    await writeFile(this.personaPath(agentId, userId), JSON.stringify(persona, null, 2), "utf-8");
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
    pendingQuestions: [],
    feedbackProfile: {
      topicBandits: {},
      preferredStyle: "observation",
      optimalFrequencyHours: 4,
      lastProactiveAt: 0,
    },
    rapport: {
      trustScore: 0.1,
      totalExchanges: 0,
      avgResponseLength: 0,
      selfDisclosureLevel: 0,
    },
  };
}
