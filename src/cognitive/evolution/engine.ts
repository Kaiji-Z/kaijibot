import { detectTrialAndError, evaluateComplexity } from "./complexity-evaluator.js";
import { generateSkillDraft } from "./skill-draft-generator.js";
import type { EvolutionPreferenceAdapter } from "./preference-adapter.js";
import { EvolutionStore } from "./store.js";
import type {
  EvolutionCandidate,
  EvolutionConfig,
  EvolutionDecision,
  EvolutionRecord,
  EvolutionUserResponse,
  RecentSuggestionSummary,
  SkillDraft,
  SkillPatch,
  SkillPatchResult,
} from "./types.js";
import { DEFAULT_EVOLUTION_CONFIG } from "./types.js";
import type { SkillPersistenceWriter } from "./skill-writer.js";
import type { SkillLifecycleManager } from "./skill-lifecycle.js";

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
    const trialError = detectTrialAndError(candidate);

    const reasoningParts: string[] = [];

    if (trialError.detected) {
      reasoningParts.push(`Trial-and-error detected: ${trialError.signals.length} signals, boost +${trialError.boost.toFixed(2)}`);
    }

    const hasErrors = (candidate.errorProfile?.errorCount ?? 0) > 0;
    const uniqueSet = new Set(candidate.toolCalls);
    const rawRetryCount = candidate.toolCalls.length - uniqueSet.size;
    const retryCount = hasErrors ? rawRetryCount : 0;
    const hasRetries = retryCount > 0;

    const threshold = (hasErrors || hasRetries)
      ? config.errorComplexityThreshold
      : config.minComplexity;

    if (hasErrors) {
      reasoningParts.push(`Tool errors detected (${candidate.errorProfile!.errorCount} errors in: ${candidate.errorProfile!.failedToolNames.join(", ")}), using error threshold ${threshold}`);
    }
    if (hasRetries) {
      reasoningParts.push(`Tool retries detected (${retryCount} retries), using error threshold ${threshold}`);
    }

    // Fetch recent suggestions as context for the agent (not a gate)
    const recentRecords = await this.store.getRecentSuggestions(userId, 48);
    const recentSuggestions: RecentSuggestionSummary[] = recentRecords.map((r) => ({
      skillName: r.draft?.name,
      domain: r.candidate.domain,
      hoursAgo: Math.round((Date.now() - r.timestamp) / 3_600_000),
      userResponse: r.userResponse,
    }));

    if (complexity.score < threshold) {
      return {
        shouldSuggest: false,
        confidence: 0,
        complexityScore: complexity.score,
        reasoning: reasoningParts.length > 0
          ? `${reasoningParts.join("; ")}; Complexity score ${complexity.score.toFixed(2)} below threshold ${threshold}`
          : `Complexity score ${complexity.score.toFixed(2)} below threshold ${threshold}`,
        recentSuggestions,
      };
    }

    let confidence = complexity.score;
    if (this.preferenceAdapter) {
      const domainRate = await this.preferenceAdapter.getDomainAcceptanceRate(userId, candidate.domain);
      confidence = confidence * domainRate;
    }

    reasoningParts.push(`Task is complex enough (score ${complexity.score.toFixed(2)}) for skill suggestion`);

    return {
      shouldSuggest: true,
      confidence,
      complexityScore: complexity.score,
      reasoning: reasoningParts.join("; "),
      recentSuggestions,
    };
  }

  async generate(candidate: EvolutionCandidate): Promise<SkillDraft> {
    if (this.draftGenerator) return this.draftGenerator(candidate);
    return generateSkillDraft(candidate);
  }

  async checkBeforeGenerate(
    candidate: EvolutionCandidate,
    lifecycle?: SkillLifecycleManager,
  ): Promise<{ shouldCreate: boolean; existingSkill?: string }> {
    if (!lifecycle) {
      return { shouldCreate: true };
    }

    const result = await lifecycle.checkDuplicate(
      candidate.domain,
      candidate.taskSummary,
    );

    if (result.duplicate) {
      return { shouldCreate: false, existingSkill: result.existingName };
    }

    return { shouldCreate: true };
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

  async patchSkill(
    patch: SkillPatch,
    deps: { generateText?: (prompt: string) => Promise<string>; writer: SkillPersistenceWriter },
  ): Promise<SkillPatchResult> {
    const rawContent = await deps.writer.readRawSkill(patch.name);
    if (rawContent === null) {
      return { ok: false, error: `Skill not found: ${patch.name}` };
    }

    // Fast path: direct text replacement without LLM
    if (patch.replacements && patch.replacements.length > 0 && !deps.generateText) {
      let updated = rawContent;
      for (const { oldText, newText } of patch.replacements) {
        if (!updated.includes(oldText)) {
          return { ok: false, error: `Text not found in skill: "${oldText}"` };
        }
        updated = updated.replace(oldText, newText);
      }
      const updatedPath = await deps.writer.updateSkill(patch.name, updated);
      return { ok: true, updatedPath };
    }

    // LLM path: natural language instructions
    if (!deps.generateText) {
      return { ok: false, error: "LLM text generation required but not provided" };
    }

    const replacementsSection = patch.replacements
      ? `\nSpecific text replacements:\n${patch.replacements.map((r) => `- Replace "${r.oldText}" with "${r.newText}"`).join("\n")}\n`
      : "";

    const prompt = `You are a skill patching assistant. Update the following SKILL.md based on the user's instructions.

Current SKILL.md content:
---
${rawContent}
---

Instructions for changes:
${patch.instructions}${replacementsSection}

Return ONLY the complete updated SKILL.md content with YAML frontmatter preserved. Do not include any explanation outside the SKILL.md content.`;

    try {
      const updatedContent = await deps.generateText(prompt);
      const updatedPath = await deps.writer.updateSkill(patch.name, updatedContent);
      return { ok: true, updatedPath };
    } catch (err) {
      return { ok: false, error: `Failed to patch skill: ${String(err)}` };
    }
  }
}
