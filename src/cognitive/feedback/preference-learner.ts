import type { TopicBandit, FeedbackProfile } from "../types.js";
import type { FeedbackEvent, TopicFeedbackSummary } from "./types.js";

/**
 * Thompson Sampling preference learner.
 *
 * Each topic has a Beta(α, β) posterior. On positive feedback α+=1,
 * on negative feedback β+=1. Sample from posterior to decide whether
 * to push this topic.
 *
 * Cold start: optimistic initialization with α=2, β=1 (prior belief of relevance).
 */

const OPTIMISTIC_ALPHA = 2;
const OPTIMISTIC_BETA = 1;

/** 90-day half-life for preference decay toward priors */
export const DECAY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Exponential decay of a single bandit toward priors.
 * Formula: decayed = prior + (current - prior) * exp(-ln2 * age / halfLife)
 * Clamped so alpha/beta never drop below priors.
 */
export function decayBandit(
  bandit: TopicBandit,
  nowMs: number,
  halfLifeMs: number = DECAY_HALF_LIFE_MS,
): TopicBandit {
  if (bandit.lastUpdated === undefined) return bandit;
  const age = nowMs - bandit.lastUpdated;
  if (age <= 0) return bandit;
  const factor = Math.exp(-Math.LN2 * age / halfLifeMs);
  const decayedAlpha = OPTIMISTIC_ALPHA + (bandit.alpha - OPTIMISTIC_ALPHA) * factor;
  const decayedBeta = OPTIMISTIC_BETA + (bandit.beta - OPTIMISTIC_BETA) * factor;
  return {
    alpha: Math.max(OPTIMISTIC_ALPHA, decayedAlpha),
    beta: Math.max(OPTIMISTIC_BETA, decayedBeta),
    lastUpdated: bandit.lastUpdated,
  };
}

export function decayAllBandits(
  profile: FeedbackProfile,
  nowMs: number,
): FeedbackProfile {
  const newBandits: Record<string, TopicBandit> = {};
  for (const [topic, bandit] of Object.entries(profile.topicBandits)) {
    newBandits[topic] = decayBandit(bandit, nowMs);
  }
  return { ...profile, topicBandits: newBandits };
}

/**
 * Update the bandit for a topic based on feedback.
 * Returns a new FeedbackProfile (does not mutate input).
 */
export function updateBanditFromFeedback(
  profile: FeedbackProfile,
  feedback: FeedbackEvent,
): FeedbackProfile {
  const topic = feedback.topic ?? "general";
  const rawBandit: TopicBandit = profile.topicBandits[topic] ?? { alpha: OPTIMISTIC_ALPHA, beta: OPTIMISTIC_BETA };

  // Apply decay before update so stale bandits regress toward priors
  const bandit = decayBandit(rawBandit, feedback.timestamp);

  let newAlpha = bandit.alpha;
  let newBeta = bandit.beta;

  switch (feedback.type) {
    case "positive":
    case "engaged":
      newAlpha += 1;
      break;
    case "negative":
      newBeta += 1;
      break;
    case "neutral":
      // Slight negative signal — half increment
      newBeta += 0.5;
      break;
  }

  return {
    ...profile,
    topicBandits: {
      ...profile.topicBandits,
      [topic]: { alpha: newAlpha, beta: newBeta, lastUpdated: feedback.timestamp },
    },
  };
}

/**
 * Sample from all topic bandits to get exploration-exploitation scores.
 * Higher score = more likely to be relevant NOW.
 */
export function sampleTopicScores(
  profile: FeedbackProfile,
  rng?: () => number,
): Map<string, number> {
  const random = rng ?? Math.random;
  const scores = new Map<string, number>();

  for (const [topic, bandit] of Object.entries(profile.topicBandits)) {
    scores.set(topic, sampleBeta(bandit.alpha, bandit.beta, random));
  }

  return scores;
}

/**
 * Pick the best topic to push based on Thompson Sampling scores.
 * Returns undefined if no topics available or if all scores are below threshold.
 */
export function pickBestTopic(
  profile: FeedbackProfile,
  options?: {
    minScore?: number;
    excludeTopics?: string[];
    rng?: () => number;
  },
): string | undefined {
  const minScore = options?.minScore ?? 0.3;
  const exclude = new Set(options?.excludeTopics ?? []);
  const scores = sampleTopicScores(profile, options?.rng);

  let bestTopic: string | undefined;
  let bestScore = -1;

  for (const [topic, score] of scores) {
    if (exclude.has(topic)) continue;
    if (score < minScore) continue;
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestTopic;
}

/**
 * Get a summary of all topic feedback.
 */
export function getTopicSummaries(profile: FeedbackProfile): TopicFeedbackSummary[] {
  return Object.entries(profile.topicBandits).map(([topic, bandit]) => ({
    topic,
    positiveCount: Math.max(0, bandit.alpha - OPTIMISTIC_ALPHA),
    negativeCount: Math.max(0, bandit.beta - OPTIMISTIC_BETA),
    neutralCount: 0,
    engagedCount: 0,
    lastFeedbackAt: 0,
    samplingScore: bandit.alpha / (bandit.alpha + bandit.beta),
  }));
}

/**
 * Update the optimal frequency based on feedback patterns.
 * If user responds positively, increase frequency. If negatively, decrease.
 */
export function adaptFrequency(
  currentHours: number,
  feedback: FeedbackEvent,
): number {
  const delta = feedback.type === "positive" || feedback.type === "engaged"
    ? -0.5  // more frequent (reduce hours)
    : feedback.type === "negative"
      ? 2.0  // less frequent (increase hours)
      : 0;   // no change

  // Clamp between 1 and 48 hours
  return Math.max(1, Math.min(48, currentHours + delta));
}

/**
 * Pick the best prompt variant by Thompson Sampling over prompt bandits.
 * For each armKey, get or create a TopicBandit from profile.promptBandits
 * (cold start: optimistic prior { alpha: 2, beta: 1 }).
 * Returns the 0-based index of the arm with the highest sampled score.
 */
export function pickPromptVariant(
  profile: { promptBandits?: Record<string, TopicBandit> },
  armKeys: string[],
  rng?: () => number,
): number {
  const random = rng ?? Math.random;
  const bandits = profile.promptBandits ?? {};
  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < armKeys.length; i++) {
    const bandit = bandits[armKeys[i]] ?? { alpha: OPTIMISTIC_ALPHA, beta: OPTIMISTIC_BETA };
    const score = sampleBeta(bandit.alpha, bandit.beta, random);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

/**
 * Update the prompt bandit for a specific arm based on feedback.
 * Returns a new promptBandits record (does NOT mutate the input).
 * Update logic matches updateBanditFromFeedback:
 *   positive/engaged → alpha += 1
 *   negative → beta += 1
 *   neutral → beta += 0.5
 */
export function updatePromptBandit(
  profile: { promptBandits?: Record<string, TopicBandit> },
  armKey: string,
  feedback: "positive" | "negative" | "neutral" | "engaged",
  timestamp: number,
): Record<string, TopicBandit> {
  const existing = profile.promptBandits ?? {};
  const rawBandit: TopicBandit = existing[armKey] ?? { alpha: OPTIMISTIC_ALPHA, beta: OPTIMISTIC_BETA };

  let newAlpha = rawBandit.alpha;
  let newBeta = rawBandit.beta;

  switch (feedback) {
    case "positive":
    case "engaged":
      newAlpha += 1;
      break;
    case "negative":
      newBeta += 1;
      break;
    case "neutral":
      newBeta += 0.5;
      break;
  }

  return {
    ...existing,
    [armKey]: { alpha: newAlpha, beta: newBeta, lastUpdated: timestamp },
  };
}

// --- Beta distribution sampling using Marsaglia and Tsang's method ---

function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

function sampleGamma(shape: number, rng: () => number): number {
  // Simple Gamma(α,1) sampling for α >= 1 using Marsaglia and Tsang
  if (shape < 1) {
    // Use Ahrens-Dieter: Gamma(α) = Gamma(α+1) * U^(1/α)
    return sampleGamma(shape + 1, rng) * Math.pow(rng(), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x: number;
    let v: number;
    do {
      x = randomNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = rng();

    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function randomNormal(rng: () => number): number {
  // Box-Muller transform
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
