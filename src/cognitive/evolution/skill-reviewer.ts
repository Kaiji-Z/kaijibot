/**
 * Independent skill reviewer (LLM-as-judge, AFTER save).
 *
 * Unlike the quality gate, this runs from a fresh context with NO conversation
 * history: it judges whether the skill, viewed in isolation, will actually
 * accomplish its stated purpose. It is intended to be invoked asynchronously so
 * it never blocks skill creation.
 *
 * Reviewer infrastructure failures (call error / non-JSON response) are retried
 * once, then reported via `ReviewResult.failure` so the audit log distinguishes
 * "reviewer was broken" from "reviewer disapproved" (issue #27).
 */
import { formatErrorMessage } from "../../infra/errors.js";
import { parseJsonLoose, STRICT_JSON_SUFFIX, truncateForJudge } from "./judge-utils.js";
import type { SkillDraft } from "./types.js";

/** Review attempts before giving up: initial call + one stricter retry. */
const REVIEWER_ATTEMPTS = 2;

export type ReviewFailureMode = "reviewer_call_failed" | "reviewer_invalid_json";

export type ReviewFailure = {
  mode: ReviewFailureMode;
  detail: string;
};

export type ReviewResult = {
  approved: boolean;
  confidence: number;
  notes: string;
  /** Present only when the reviewer itself failed — never for a disapproval. */
  failure?: ReviewFailure;
};

export type ReviewDeps = {
  generateText: (prompt: string) => Promise<string>;
  /** Diagnostic sink for reviewer failures (defaults to console.warn). */
  log?: (message: string) => void;
};

type RawReview = {
  approved?: unknown;
  confidence?: unknown;
  notes?: unknown;
};

function clamp01(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n));
}

function buildReviewPrompt(draft: SkillDraft, taskSummary: string): string {
  return [
    "You are reviewing a skill for an AI assistant. Given ONLY this skill content and its claimed purpose, will it work correctly?",
    "",
    `Skill purpose: ${taskSummary}`,
    "",
    "Skill content:",
    `Name: ${draft.name}`,
    `Description: ${draft.description}`,
    `Triggers: ${draft.triggerPhrases.join(", ")}`,
    "Body:",
    truncateForJudge(draft.bodyMarkdown),
    "",
    'Respond as JSON: {"approved": true/false, "confidence": 0.0-1.0, "notes": "..."}',
  ].join("\n");
}

export async function reviewSkill(
  draft: SkillDraft,
  taskSummary: string,
  deps: ReviewDeps,
): Promise<ReviewResult> {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const basePrompt = buildReviewPrompt(draft, taskSummary);

  let failure: ReviewFailure | null = null;
  for (let attempt = 1; attempt <= REVIEWER_ATTEMPTS; attempt++) {
    const prompt = attempt === 1 ? basePrompt : basePrompt + STRICT_JSON_SUFFIX;
    let response: string;
    try {
      response = await deps.generateText(prompt);
    } catch (error) {
      failure = { mode: "reviewer_call_failed", detail: formatErrorMessage(error) };
      log(
        `[skill-reviewer] call failed (attempt ${attempt}/${REVIEWER_ATTEMPTS}): ${failure.detail}`,
      );
      continue;
    }
    try {
      const raw = parseJsonLoose(response) as RawReview;
      const notes = typeof raw.notes === "string" && raw.notes.trim() ? raw.notes : "";
      return {
        approved: raw.approved === true,
        confidence: clamp01(raw.confidence),
        notes,
      };
    } catch (error) {
      failure = { mode: "reviewer_invalid_json", detail: formatErrorMessage(error) };
      log(
        `[skill-reviewer] response unparseable (attempt ${attempt}/${REVIEWER_ATTEMPTS}): ${failure.detail}`,
      );
    }
  }

  // Fail-closed with attribution: an outage is recorded distinctly from a
  // genuine disapproval in the audit log. The loop above always executes at
  // least once, so `failure` is set here.
  return {
    approved: false,
    confidence: 0,
    notes: `Review failed (${failure!.mode}) — not a review verdict`,
    failure: failure!,
  };
}
