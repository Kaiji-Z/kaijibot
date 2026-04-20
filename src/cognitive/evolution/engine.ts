import { evaluateComplexity } from "./complexity-evaluator.js";
import { generateSkillDraft } from "./skill-draft-generator.js";
import type { EvolutionPreferenceAdapter } from "./preference-adapter.js";
import { EvolutionStore } from "./store.js";
import type {
  EvolutionCandidate,
  EvolutionConfig,
  EvolutionDecision,
  EvolutionRecord,
  EvolutionUserResponse,
  SkillDraft,
} from "./types.js";
import { DEFAULT_EVOLUTION_CONFIG } from "./types.js";
import { randomUUID } from "node:crypto";

export type DraftGeneratorFn = (candidate: EvolutionCandidate) => Promise<SkillDraft>;

export class EvolutionEngine {
  constructor(
    private readonly store: EvolutionStore,
    private readonly config?: Partial<EvolutionConfig>,
    private readonly preferenceAdapter?: EvolutionPreferenceAdapter,
    private readonly draftGenerator?: DraftGeneratorFn,
  ) {}

  private async effectiveConfig(): Promise<EvolutionConfig> {
    if (this.config) return { ...DEFAULT_EVOLUTION_CONFIG, ...this.config };
    const stored = await this.store.loadConfig();
    return { ...DEFAULT_EVOLUTION_CONFIG, ...stored };
  }

  async evaluate(
    candidate: EvolutionCandidate,
    userId: string,
  ): Promise<EvolutionDecision> {
    const config = await this.effectiveConfig();

    if (!config.enabled) {
      return {
        shouldSuggest: false,
        confidence: 0,
        complexityScore: 0,
        reasoning: "Evolution engine is disabled",
      };
    }

    const complexity = evaluateComplexity(candidate);

    if (complexity.score < config.minComplexity) {
      return {
        shouldSuggest: false,
        confidence: 0,
        complexityScore: complexity.score,
        reasoning: `Complexity score ${complexity.score.toFixed(2)} below threshold ${config.minComplexity}`,
      };
    }

    const recentInCooldown =
      await this.store.getRecentSuggestions(userId, config.cooldownHours);
    if (recentInCooldown.length > 0) {
      return {
        shouldSuggest: false,
        confidence: 0,
        complexityScore: complexity.score,
        reasoning: `Suggested recently (cooldown ${config.cooldownHours}h)`,
      };
    }

    const recentToday = await this.store.getRecentSuggestions(userId, 24);
    if (recentToday.length >= config.maxSuggestionsPerDay) {
      return {
        shouldSuggest: false,
        confidence: 0,
        complexityScore: complexity.score,
        reasoning: `Daily limit reached (${config.maxSuggestionsPerDay}/day)`,
      };
    }

    let confidence = complexity.score;
    if (this.preferenceAdapter) {
      const domainRate = await this.preferenceAdapter.getDomainAcceptanceRate(userId, candidate.domain);
      confidence = confidence * domainRate;
    }

    return {
      shouldSuggest: true,
      confidence,
      complexityScore: complexity.score,
      reasoning: `Task is complex enough (score ${complexity.score.toFixed(2)}) for skill suggestion`,
    };
  }

  async generate(candidate: EvolutionCandidate): Promise<SkillDraft> {
    if (this.draftGenerator) return this.draftGenerator(candidate);
    return generateSkillDraft(candidate);
  }

  async recordResponse(
    recordId: string,
    userId: string,
    response: EvolutionUserResponse,
    savedPath?: string,
  ): Promise<EvolutionRecord> {
    const records = await this.store.list(userId);
    const record = records.find((r) => r.id === recordId);
    if (!record) {
      throw new Error(`Record ${recordId} not found for user ${userId}`);
    }

    const updated: EvolutionRecord = {
      ...record,
      userResponse: response,
      savedSkillPath: savedPath,
    };

    await this.store.save(updated);
    return updated;
  }
}
