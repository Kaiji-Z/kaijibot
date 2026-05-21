import type { EvolutionUserResponse } from "./types.js";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

type DomainBandit = {
  alpha: number;
  beta: number;
};

type PreferenceState = {
  userId: string;
  bandits: Record<string, DomainBandit>;
};

const PRIOR_ALPHA = 2;
const PRIOR_BETA = 1;

export class EvolutionPreferenceAdapter {
  constructor(private readonly configDir: string) {}

  private statePath(agentId: string, userId: string): string {
    return join(this.configDir, "cognitive", "evolution", agentId, "preferences", `${userId}.json`);
  }

  private sampleBeta(alpha: number, beta: number): number {
    const x = this.sampleGamma(alpha);
    const y = this.sampleGamma(beta);
    return x / (x + y);
  }

  private sampleGamma(shape: number): number {
    if (shape < 1) {
      return this.sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x: number;
      let v: number;
      do {
        x = this.randn();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  private randn(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  async recordResponse(agentId: string, userId: string, domain: string, response: EvolutionUserResponse): Promise<void> {
    const state = await this.loadState(agentId, userId);
    if (!state.bandits[domain]) {
      state.bandits[domain] = { alpha: PRIOR_ALPHA, beta: PRIOR_BETA };
    }
    const bandit = state.bandits[domain];
    if (response === "accepted") {
      bandit.alpha += 1;
    } else if (response === "rejected") {
      bandit.beta += 1;
    }
    if (response === "modified") {
      bandit.alpha += 0.5;
    }
    await this.saveState(agentId, userId, state);
  }

  async getDomainAcceptanceRate(agentId: string, userId: string, domain: string): Promise<number> {
    const state = await this.loadState(agentId, userId);
    const bandit = state.bandits[domain];
    if (!bandit) return PRIOR_ALPHA / (PRIOR_ALPHA + PRIOR_BETA);
    return this.sampleBeta(bandit.alpha, bandit.beta);
  }

  async getTopDomains(agentId: string, userId: string, limit: number): Promise<Array<{ domain: string; score: number }>> {
    const state = await this.loadState(agentId, userId);
    const entries = Object.entries(state.bandits).map(([domain, bandit]) => ({
      domain,
      score: this.sampleBeta(bandit.alpha, bandit.beta),
    }));
    entries.sort((a, b) => b.score - a.score);
    return entries.slice(0, limit);
  }

  async getRawBandit(agentId: string, userId: string, domain: string): Promise<DomainBandit | undefined> {
    const state = await this.loadState(agentId, userId);
    return state.bandits[domain];
  }

  private async loadState(agentId: string, userId: string): Promise<PreferenceState> {
    const path = this.statePath(agentId, userId);
    if (!existsSync(path)) return { userId, bandits: {} };
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as PreferenceState;
    } catch {
      return { userId, bandits: {} };
    }
  }

  private async saveState(agentId: string, userId: string, state: PreferenceState): Promise<void> {
    const path = this.statePath(agentId, userId);
    const dir = join(path, "..");
    await mkdir(dir, { recursive: true });
    const tmpPath = join(tmpdir(), `kaijibot-pref-${randomUUID()}.json`);
    await writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
    await rename(tmpPath, path);
  }
}
