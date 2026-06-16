/**
 * Skill quality gate (LLM-as-judge) and draft refiner.
 *
 * `evaluateSkillQuality` runs BEFORE a generated skill is persisted. It asks an
 * LLM to rate the draft on four actionable dimensions and only lets high-quality
 * skills through (mean score >= QUALITY_THRESHOLD).
 *
 * `refineSkillDraft` asks the LLM to rewrite a rejected draft to address the
 * recorded critique/issues, then re-parses the result via the shared
 * `validateAndRepair` parser so it stays consistent with normal skill generation.
 */
import { generateSkillDraft } from "./skill-draft-generator.js";
import { validateAndRepair } from "./llm-draft-generator.js";
import type { EvolutionCandidate, SkillDraft } from "./types.js";

/** Mean-score cutoff below which a draft is rejected. */
const QUALITY_THRESHOLD = 0.7;

export type QualityResult = {
  passed: boolean;
  /** Mean of the four dimension scores (0-1). */
  score: number;
  critique: string;
  issues: string[];
};

export type QualityDeps = {
  generateText: (prompt: string) => Promise<string>;
  /** When provided, surfaced to the LLM so it can flag unknown tool references. */
  validToolNames?: string[];
};

export type RefineDeps = {
  generateText: (prompt: string) => Promise<string>;
};

type RawQualityScores = {
  actionable?: number;
  validTools?: number;
  meaningfulTriggers?: number;
  solvesProblem?: number;
  critique?: string;
  issues?: unknown;
};

const FALLBACK_RESULT: QualityResult = {
  passed: false,
  score: 0,
  critique: "Evaluation failed",
  issues: ["LLM parse error"],
};

function clamp01(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n));
}

function toStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x)).filter((x) => x.length > 0);
  }
  return [];
}

function buildEvaluatePrompt(draft: SkillDraft, deps: QualityDeps): string {
  const lines: string[] = [
    "You are a strict quality evaluator for AI agent skills. Rate this skill on 4 dimensions (0.0-1.0):",
    "- actionable: Are the workflow steps concrete and executable?",
    "- validTools: Do referenced tools exist and are they used correctly?",
    "- meaningfulTriggers: Are trigger phrases specific enough to match the intended use case?",
    "- solvesProblem: Does this skill actually solve the stated problem?",
    "",
    "Skill:",
    `Name: ${draft.name}`,
    `Description: ${draft.description}`,
    `Triggers: ${draft.triggerPhrases.join(", ")}`,
    "Body:",
    draft.bodyMarkdown,
  ];

  if (deps.validToolNames && deps.validToolNames.length > 0) {
    lines.push("", `Known valid tools: ${deps.validToolNames.join(", ")}`);
  }

  lines.push(
    "",
    'Respond as JSON: {"actionable": 0.0-1.0, "validTools": 0.0-1.0, "meaningfulTriggers": 0.0-1.0, "solvesProblem": 0.0-1.0, "critique": "...", "issues": ["...", "..."]}',
  );

  return lines.join("\n");
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in LLM response");
  }
  const jsonText = trimmed.slice(start, end + 1);
  return JSON.parse(jsonText) as unknown;
}

export async function evaluateSkillQuality(
  draft: SkillDraft,
  deps: QualityDeps,
): Promise<QualityResult> {
  let raw: RawQualityScores;
  try {
    const response = await deps.generateText(buildEvaluatePrompt(draft, deps));
    raw = parseJsonLoose(response) as RawQualityScores;
  } catch {
    return { ...FALLBACK_RESULT };
  }

  const actionable = clamp01(raw.actionable);
  const validTools = clamp01(raw.validTools);
  const meaningfulTriggers = clamp01(raw.meaningfulTriggers);
  const solvesProblem = clamp01(raw.solvesProblem);
  const score = (actionable + validTools + meaningfulTriggers + solvesProblem) / 4;
  const critique = typeof raw.critique === "string" && raw.critique.trim() ? raw.critique : "";
  const issues = toStringList(raw.issues);

  return {
    passed: score >= QUALITY_THRESHOLD,
    score,
    critique,
    issues,
  };
}

function buildRefinePrompt(draft: SkillDraft, critique: string, issues: string[]): string {
  return [
    "Rewrite this skill to fix the issues below. Keep it actionable and concrete.",
    "Output ONLY a complete SKILL.md file starting with `---` frontmatter, including a `## Triggers` section.",
    "",
    "Issues to fix:",
    ...issues.map((i) => `- ${i}`),
    "",
    "Critique:",
    critique || "(none provided)",
    "",
    "Current skill:",
    `Name: ${draft.name}`,
    `Description: ${draft.description}`,
    `Triggers: ${draft.triggerPhrases.join(", ")}`,
    "Body:",
    draft.bodyMarkdown,
  ].join("\n");
}

/** Minimal candidate used only as the `validateAndRepair` fallback source. */
function toFallbackCandidate(draft: SkillDraft): EvolutionCandidate {
  return {
    taskSummary: draft.description,
    toolCalls: draft.triggerPhrases.length > 0 ? [draft.triggerPhrases[0]!] : [],
    uniqueToolCount: draft.triggerPhrases.length > 0 ? 1 : 0,
    reasoningTurns: 0,
    durationMs: 0,
    domain: draft.name,
  };
}

function sameDraft(a: SkillDraft, b: SkillDraft): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.bodyMarkdown === b.bodyMarkdown &&
    a.triggerPhrases.length === b.triggerPhrases.length &&
    a.triggerPhrases.every((p, i) => p === b.triggerPhrases[i])
  );
}

export async function refineSkillDraft(
  draft: SkillDraft,
  critique: string,
  issues: string[],
  deps: RefineDeps,
): Promise<SkillDraft> {
  let response: string;
  try {
    response = await deps.generateText(buildRefinePrompt(draft, critique, issues));
  } catch {
    return draft;
  }

  const candidate = toFallbackCandidate(draft);
  // validateAndRepair falls back to generateSkillDraft(candidate) on a malformed
  // response; detect that fallback and return the original draft instead.
  const fallback = generateSkillDraft(candidate);
  const parsed = validateAndRepair(response, candidate);
  if (sameDraft(parsed, fallback)) {
    return draft;
  }
  return parsed;
}
