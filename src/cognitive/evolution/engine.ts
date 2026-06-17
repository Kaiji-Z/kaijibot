import { generateSkillDraft } from "./skill-draft-generator.js";
import type { SkillLifecycleManager } from "./skill-lifecycle.js";
import type { SkillPersistenceWriter } from "./skill-writer.js";
import { EvolutionStore } from "./store.js";
import type { EvolutionCandidate, SkillDraft, SkillPatch, SkillPatchResult } from "./types.js";

export type DraftGeneratorFn = (candidate: EvolutionCandidate) => Promise<SkillDraft>;

export class EvolutionEngine {
  constructor(
    private readonly store: EvolutionStore,
    private readonly draftGenerator?: DraftGeneratorFn,
  ) {}

  async generate(candidate: EvolutionCandidate): Promise<SkillDraft> {
    if (this.draftGenerator) {
      return this.draftGenerator(candidate);
    }
    return generateSkillDraft(candidate);
  }

  async checkBeforeGenerate(
    candidate: EvolutionCandidate,
    lifecycle?: SkillLifecycleManager,
    existingSkills?: Array<{ name: string; description: string }>,
    deps?: { generateText: (prompt: string) => Promise<string> },
  ): Promise<{ shouldCreate: boolean; existingSkill?: string }> {
    if (!lifecycle) {
      return { shouldCreate: true };
    }

    const result =
      deps?.generateText && existingSkills
        ? await lifecycle.checkSemanticDuplicate(
            candidate.taskSummary,
            candidate.taskSummary,
            existingSkills,
            deps,
          )
        : await lifecycle.checkDuplicate(candidate.domain, candidate.taskSummary);

    if (result.duplicate) {
      return { shouldCreate: false, existingSkill: result.existingName };
    }

    return { shouldCreate: true };
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
