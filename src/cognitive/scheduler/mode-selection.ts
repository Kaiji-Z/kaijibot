import type { InsightMode } from "../insight/types.js";
import type { TopicBandit } from "../types.js";
import type { ContentStrategyHint } from "./content-strategy.js";

/** Base weights for each insight mode (sum ≈ 1.0). */
const BASE_WEIGHTS: Record<InsightMode, number> = {
  pattern: 0.3,
  surprise: 0.4,
  extend: 0.3,
};

/** Minimum probability floor for any candidate mode (prevents starvation). */
const BASE_PROBABILITY_FLOOR = 0.3;

/**
 * Select a mode from candidates using bandit-weighted probabilities.
 *
 * Algorithm:
 * 1. Start with base weights for each candidate mode
 * 2. Multiply by bandit factor: alpha / (alpha + beta) — higher = more successful
 * 3. Normalize to probabilities (sum = 1.0)
 * 4. Apply the per-mode probability floor and renormalize to prevent starvation
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

  const rawScores = candidates.map((mode) => {
    const baseWeight = BASE_WEIGHTS[mode] ?? 0.3;
    const bandit = modeBandits?.[mode];
    const banditFactor = bandit ? bandit.alpha / (bandit.alpha + bandit.beta) : 0.5;
    return baseWeight * banditFactor;
  });

  // Normalize to probabilities FIRST, then floor. Flooring the raw scores
  // before normalizing made the floor ineffective: floored raw scores land in
  // [floor, floor + (1-floor)*max] and normalization dragged a 3-way split as
  // low as ~0.17 — below the intended 30% starvation guarantee.
  const rawTotal = rawScores.reduce((sum, s) => sum + s, 0);
  const normalized =
    rawTotal > 0 ? rawScores.map((s) => s / rawTotal) : rawScores.map(() => 1 / rawScores.length);

  const effectiveFloor = Math.min(BASE_PROBABILITY_FLOOR, 1 / candidates.length);
  const floored = normalized.map((p) => Math.max(p, effectiveFloor));
  const flooredTotal = floored.reduce((sum, p) => sum + p, 0);
  const probabilities = candidates.map((mode, i) => ({
    mode,
    prob: floored[i]! / flooredTotal,
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

  const candidates = modeCandidates ?? (Object.keys(BASE_WEIGHTS) as InsightMode[]);
  return banditWeightedSelect(candidates, modeBandits, seed);
}
