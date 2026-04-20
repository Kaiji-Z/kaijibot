import type { EvolutionCandidate, SkillDraft } from "./types.js";
import { generateSkillDraft, sanitizeSkillName } from "./skill-draft-generator.js";

/** Injected dependencies for LLM-based draft generation. */
export type LlmDraftDeps = {
  generateText: (prompt: string) => Promise<string>;
};

function buildPrompt(candidate: EvolutionCandidate): string {
  return [
    "You are a skill draft generator for an AI assistant. Given a completed task, generate a reusable Skill proposal.",
    "",
    "## Task Summary",
    candidate.taskSummary,
    "",
    "## Domain",
    candidate.domain,
    "",
    "## Tools Used",
    ...candidate.toolCalls.map((t, i) => `${i + 1}. ${t}`),
    "",
    "## Reasoning Turns",
    String(candidate.reasoningTurns),
    "",
    "Generate a JSON object with these fields:",
    "- name: kebab-case skill name (e.g. 'feishu-wiki-archive')",
    "- description: one-line description under 200 chars, including trigger context",
    "- triggerPhrases: array of 3-5 trigger phrases (mix Chinese and English)",
    "- bodyMarkdown: markdown body with ## When to use, ## Workflow (numbered steps), ## Notes sections",
    "",
    "Return ONLY valid JSON, no markdown fences.",
  ].join("\n");
}

const MAX_DESCRIPTION_LENGTH = 200;
const MAX_TRIGGER_PHRASES = 5;

function validateAndRepair(raw: Record<string, unknown>, candidate: EvolutionCandidate): SkillDraft {
  const name = typeof raw.name === "string" ? sanitizeSkillName(raw.name) : `skill-${candidate.domain}`;

  let description = typeof raw.description === "string" ? raw.description : `${candidate.taskSummary}`;
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    description = description.slice(0, MAX_DESCRIPTION_LENGTH - 1) + "…";
  }

  let triggerPhrases: string[] = [];
  if (Array.isArray(raw.triggerPhrases)) {
    triggerPhrases = raw.triggerPhrases.filter((p): p is string => typeof p === "string").slice(0, MAX_TRIGGER_PHRASES);
  }

  const bodyMarkdown = typeof raw.bodyMarkdown === "string" ? raw.bodyMarkdown : "";

  if (!triggerPhrases.length || !bodyMarkdown) {
    return generateSkillDraft(candidate);
  }

  return { name, description, triggerPhrases, bodyMarkdown };
}

/**
 * Generate a SkillDraft using an LLM, falling back to the rule-based
 * generator when the LLM call fails, times out, or returns unparseable
 * output.
 *
 * This function never throws.
 */
export async function generateSkillDraftLLM(
  candidate: EvolutionCandidate,
  deps: LlmDraftDeps,
): Promise<SkillDraft> {
  try {
    const prompt = buildPrompt(candidate);
    const response = await deps.generateText(prompt);

    let parsed: Record<string, unknown>;
    try {
      const cleaned = response.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "");
      parsed = JSON.parse(cleaned);
    } catch {
      return generateSkillDraft(candidate);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return generateSkillDraft(candidate);
    }

    return validateAndRepair(parsed, candidate);
  } catch {
    return generateSkillDraft(candidate);
  }
}

export { buildPrompt, validateAndRepair };
