import type { PersonaTree } from "../types.js";

export type ContentStrategyHint = {
  /** Domains to exclude from the next insight search. */
  excludeDomains: string[];
  /** Force a specific mode (overrides normal mode routing). */
  forceMode?: "surprise" | "extend" | "pattern";
  /** Whether to increase novelty/exploration in insight generation. */
  noveltyBoost: boolean;
};

const AVAILABLE_MODES = ["pattern", "surprise", "extend"] as const;

/**
 * Approximate Thompson Sampling sample for a Beta(alpha, beta) arm.
 * Uses mean + small noise from a provided uniform random value.
 */
function sampleBeta(alpha: number, beta: number, rng: number): number {
  const mean = alpha / (alpha + beta);
  return mean + (rng - 0.5) * 0.1;
}

/**
 * Compute a content strategy hint based on the user's no-response streak.
 *
 * Pure function — no side effects, no I/O.
 */
export function computeContentStrategy(persona: PersonaTree): ContentStrategyHint {
  const streak = persona.feedbackProfile.consecutiveNoResponses ?? 0;
  const domains = persona.feedbackProfile.recentInsightDomains ?? [];
  const modes = persona.feedbackProfile.recentInsightModes ?? [];
  const modeBandits = persona.feedbackProfile.modeBandits;

  if (streak === 0) {
    return { excludeDomains: [], forceMode: undefined, noveltyBoost: false };
  }

  if (streak === 1) {
    const excludeDomains = [...new Set(domains.slice(-1).flat())];
    return { excludeDomains, forceMode: undefined, noveltyBoost: false };
  }

  if (streak === 2) {
    const excludeDomains = [...new Set(domains.slice(-2).flat())];
    const lastMode = modes.length > 0 ? modes[modes.length - 1] : undefined;

    if (!lastMode) {
      return { excludeDomains, forceMode: undefined, noveltyBoost: false };
    }

    const candidates = AVAILABLE_MODES.filter((m) => m !== lastMode);
    const forceMode = pickMode(candidates, modeBandits);

    return { excludeDomains, forceMode, noveltyBoost: false };
  }

  // streak >= 3
  const excludeDomains = [...new Set(domains.slice(-3).flat())];
  return { excludeDomains, forceMode: "surprise", noveltyBoost: true };
}

function pickMode(
  candidates: readonly string[],
  modeBandits: Record<string, { alpha: number; beta: number }> | undefined,
): "surprise" | "extend" | "pattern" {
  if (candidates.length === 0) {
    return AVAILABLE_MODES[Math.floor(Math.random() * AVAILABLE_MODES.length)];
  }

  if (candidates.length === 1) {
    return candidates[0] as "surprise" | "extend" | "pattern";
  }

  if (modeBandits) {
    let best: string = candidates[0];
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const arm = modeBandits[candidate];
      const rng = Math.random();
      const score = arm ? sampleBeta(arm.alpha, arm.beta, rng) : rng;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best as "surprise" | "extend" | "pattern";
  }

  return candidates[Math.floor(Math.random() * candidates.length)] as
    | "surprise"
    | "extend"
    | "pattern";
}
