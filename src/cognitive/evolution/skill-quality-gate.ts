import { formatErrorMessage } from "../../infra/errors.js";
import { parseJsonLoose, STRICT_JSON_SUFFIX, truncateForJudge } from "./judge-utils.js";
import { validateAndRepair } from "./llm-draft-generator.js";
/**
 * Skill quality gate (LLM-as-judge) and draft refiner.
 *
 * `evaluateSkillQuality` runs BEFORE a generated skill is persisted. It asks an
 * LLM to rate the draft on four actionable dimensions and only lets high-quality
 * skills through (mean score >= QUALITY_THRESHOLD).
 *
 * Evaluator infrastructure failures (call timeout / rate limit / non-JSON
 * response) are retried once, then reported via `QualityResult.failure` with a
 * distinguishable mode — they must never masquerade as a genuine quality
 * verdict of 0 (issue #27).
 *
 * `refineSkillDraft` asks the LLM to rewrite a rejected draft to address the
 * recorded critique/issues, then re-parses the result via the shared
 * `validateAndRepair` parser so it stays consistent with normal skill generation.
 */
import { generateSkillDraft } from "./skill-draft-generator.js";
import type { EvolutionCandidate, SkillDraft } from "./types.js";

/** Mean-score cutoff below which a draft is rejected. */
const QUALITY_THRESHOLD = 0.7;

/** Judge attempts before giving up: initial call + one stricter retry. */
const EVALUATOR_ATTEMPTS = 2;

export type QualityFailureMode = "evaluator_call_failed" | "evaluator_invalid_json";

export type QualityFailure = {
  mode: QualityFailureMode;
  /** Short human-readable cause (error message or response shape). */
  detail: string;
};

export type QualityResult = {
  passed: boolean;
  /** Mean of the four dimension scores (0-1). */
  score: number;
  critique: string;
  issues: string[];
  /** Present only when the evaluator itself failed — never for a genuine low score. */
  failure?: QualityFailure;
};

export type QualityDeps = {
  generateText: (prompt: string) => Promise<string>;
  /** When provided, surfaced to the LLM so it can flag unknown tool references. */
  validToolNames?: string[];
  /** Diagnostic sink for evaluator failures (defaults to console.warn). */
  log?: (message: string) => void;
};

export type RefineDeps = {
  generateText: (prompt: string) => Promise<string>;
  /** Diagnostic sink for refine failures (defaults to console.warn). */
  log?: (message: string) => void;
};

type RawQualityScores = {
  actionable?: number;
  validTools?: number;
  meaningfulTriggers?: number;
  solvesProblem?: number;
  critique?: string;
  issues?: unknown;
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
    truncateForJudge(draft.bodyMarkdown),
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

type JudgeAttempt =
  | { ok: true; raw: RawQualityScores }
  | { ok: false; failure: { mode: QualityFailureMode; detail: string } };

function describeUnparseable(response: string, error: unknown): string {
  const snippet = JSON.stringify(response.trim().slice(0, 80).replace(/\s+/g, " "));
  return `judge response was not valid JSON (${formatErrorMessage(error)}); length=${response.length}, starts with: ${snippet}`;
}

async function runJudgeAttempt(
  prompt: string,
  deps: QualityDeps,
  log: (message: string) => void,
  attempt: number,
): Promise<JudgeAttempt> {
  let response: string;
  try {
    response = await deps.generateText(prompt);
  } catch (error) {
    const detail = formatErrorMessage(error);
    log(
      `[skill-quality-gate] evaluator call failed (attempt ${attempt}/${EVALUATOR_ATTEMPTS}): ${detail}`,
    );
    return { ok: false, failure: { mode: "evaluator_call_failed", detail } };
  }
  try {
    return { ok: true, raw: parseJsonLoose(response) as RawQualityScores };
  } catch (error) {
    const detail = describeUnparseable(response, error);
    log(
      `[skill-quality-gate] evaluator response unparseable (attempt ${attempt}/${EVALUATOR_ATTEMPTS}): ${detail}`,
    );
    return { ok: false, failure: { mode: "evaluator_invalid_json", detail } };
  }
}

function scoredResult(raw: RawQualityScores): QualityResult {
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

export async function evaluateSkillQuality(
  draft: SkillDraft,
  deps: QualityDeps,
): Promise<QualityResult> {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const basePrompt = buildEvaluatePrompt(draft, deps);

  let failure: { mode: QualityFailureMode; detail: string } | null = null;
  for (let attempt = 1; attempt <= EVALUATOR_ATTEMPTS; attempt++) {
    const prompt = attempt === 1 ? basePrompt : basePrompt + STRICT_JSON_SUFFIX;
    const result = await runJudgeAttempt(prompt, deps, log, attempt);
    if (result.ok) {
      return scoredResult(result.raw);
    }
    failure = result.failure;
  }

  // Fail-closed (no skill is persisted), but clearly attributed: this is an
  // evaluator outage, not a quality verdict on the draft. The loop above always
  // executes at least once, so `failure` is set here.
  return {
    passed: false,
    score: 0,
    critique: `Evaluation failed (${failure!.mode}) — not a quality verdict`,
    issues: [failure!.mode],
    failure: failure!,
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
    truncateForJudge(draft.bodyMarkdown),
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
  } catch (error) {
    const log = deps.log ?? ((message: string) => console.warn(message));
    log(
      `[skill-quality-gate] refine call failed, keeping original draft: ${formatErrorMessage(error)}`,
    );
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
