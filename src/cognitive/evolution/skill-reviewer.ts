/**
 * Independent skill reviewer (LLM-as-judge, AFTER save).
 *
 * Unlike the quality gate, this runs from a fresh context with NO conversation
 * history: it judges whether the skill, viewed in isolation, will actually
 * accomplish its stated purpose. It is intended to be invoked asynchronously so
 * it never blocks skill creation.
 */
import type { SkillDraft } from "./types.js";

export type ReviewResult = {
  approved: boolean;
  confidence: number;
  notes: string;
};

export type ReviewDeps = {
  generateText: (prompt: string) => Promise<string>;
};

type RawReview = {
  approved?: unknown;
  confidence?: unknown;
  notes?: unknown;
};

const FALLBACK_RESULT: ReviewResult = {
  approved: false,
  confidence: 0,
  notes: "Review failed",
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
    draft.bodyMarkdown,
    "",
    'Respond as JSON: {"approved": true/false, "confidence": 0.0-1.0, "notes": "..."}',
  ].join("\n");
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in LLM response");
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

export async function reviewSkill(
  draft: SkillDraft,
  taskSummary: string,
  deps: ReviewDeps,
): Promise<ReviewResult> {
  let raw: RawReview;
  try {
    const response = await deps.generateText(buildReviewPrompt(draft, taskSummary));
    raw = parseJsonLoose(response) as RawReview;
  } catch {
    return { ...FALLBACK_RESULT };
  }

  const notes = typeof raw.notes === "string" && raw.notes.trim() ? raw.notes : "";
  return {
    approved: raw.approved === true,
    confidence: clamp01(raw.confidence),
    notes,
  };
}
