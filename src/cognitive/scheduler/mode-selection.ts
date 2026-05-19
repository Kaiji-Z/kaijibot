import type { InsightMode } from "../insight/types.js";
import type { TopicBandit } from "../types.js";
import type { ContentStrategyHint } from "./content-strategy.js";

/** Base weights for each insight mode (sum ≈ 1.0). */
const BASE_WEIGHTS: Record<InsightMode, number> = {
  pattern: 0.5,
  surprise: 0.4,
  extend: 0.1,
};

/** Minimum probability floor for any candidate mode (prevents starvation). */
const BASE_PROBABILITY_FLOOR = 0.3;

/**
 * Select a mode from candidates using bandit-weighted probabilities.
 *
 * Algorithm:
 * 1. Start with base weights for each candidate mode
 * 2. Multiply by bandit factor: alpha / (alpha + beta) — higher = more successful
 * 3. Apply 30% base probability floor to prevent starvation
 * 4. Normalize to sum = 1.0
 * 5. Deterministic selection using provided seed
 */
export function banditWeightedSelect(
  candidates: InsightMode[],
  modeBandits: Record<string, TopicBandit> | undefined,
  seed: number,
): InsightMode {
  if (candidates.length === 0) {
    candidates = Object.keys(BASE_WEIGHTS) as InsightMode[];
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  const scores = candidates.map((mode) => {
    const baseWeight = BASE_WEIGHTS[mode] ?? 0.3;
    const bandit = modeBandits?.[mode];
    const banditFactor = bandit
      ? bandit.alpha / (bandit.alpha + bandit.beta)
      : 0.5;
    const rawScore = baseWeight * banditFactor;
    // Apply floor: score = floor + (1 - floor) * rawScore
    const floored =
      BASE_PROBABILITY_FLOOR + (1 - BASE_PROBABILITY_FLOOR) * rawScore;
    return { mode, score: floored };
  });

  const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
  const probabilities = scores.map((s) => ({
    mode: s.mode,
    prob: s.score / totalScore,
  }));

  const roll = (seed % 10000) / 10000;
  let cumulative = 0;
  for (const p of probabilities) {
    cumulative += p.prob;
    if (roll < cumulative) {
      return p.mode;
    }
  }
  // Fallback (floating point safety)
  return probabilities[probabilities.length - 1]!.mode;
}

/**
 * Select the final insight mode for an opportunity.
 *
 * Priority:
 * 1. Content strategy override (forceMode from no-response streak handling)
 * 2. Bandit-weighted selection from opportunity's modeCandidates
 * 3. Fallback to "surprise" if nothing else works
 *
 * Returns the selected mode and whether pattern mode is feasible (requires fragment clusters).
 * Pattern mode is special: it requires async fragment checks, so we return it as a candidate
 * and let resolve() handle the fallback if insufficient fragments exist.
 */
export function selectMode(
  modeCandidates: InsightMode[] | undefined,
  modeBandits: Record<string, TopicBandit> | undefined,
  strategyHint: ContentStrategyHint | undefined,
  seed: number,
): InsightMode {
  // Priority 1: content strategy override
  if (strategyHint?.forceMode) {
    return strategyHint.forceMode;
  }

  const candidates =
    modeCandidates ?? (Object.keys(BASE_WEIGHTS) as InsightMode[]);
  return banditWeightedSelect(candidates, modeBandits, seed);
}
