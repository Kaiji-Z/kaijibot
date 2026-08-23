import type { PersonaTree } from "../types.js";

export type ContentStrategyHint = {
  /** Domains to exclude from the next insight search. */
  excludeDomains: string[];
  /** Force a specific mode (overrides normal mode routing). */
  forceMode?: "surprise" | "extend" | "pattern";
  /** Whether to increase novelty/exploration in insight generation. */
  noveltyBoost: boolean;
};

/**
 * Compute a content strategy hint based on the user's no-response streak.
 *
 * Pure function — no side effects, no I/O.
 *
 * The strategy only diversifies WHAT is said at streak 1 (skip the ignored
 * domain). From streak 2 the social ledger itself throttles contact (g(U)
 * and the veto), so trying harder with novelty boosts would fight the
 * ledger — a friend who is being ignored goes quiet, they do not switch
 * to flashier topics.
 */
export function computeContentStrategy(persona: PersonaTree): ContentStrategyHint {
  const streak = persona.feedbackProfile.consecutiveNoResponses ?? 0;
  const domains = persona.feedbackProfile.recentInsightDomains ?? [];

  if (streak === 0) {
    return { excludeDomains: [], forceMode: undefined, noveltyBoost: false };
  }

  if (streak === 1) {
    const excludeDomains = [...new Set(domains.slice(-1).flat())];
    return { excludeDomains, forceMode: undefined, noveltyBoost: false };
  }

  const excludeDomains = [...new Set(domains.slice(-2).flat())];
  return { excludeDomains, forceMode: undefined, noveltyBoost: false };
}
