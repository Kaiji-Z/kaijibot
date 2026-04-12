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

/**
 * Update the bandit for a topic based on feedback.
 * Returns a new FeedbackProfile (does not mutate input).
 */
export function updateBanditFromFeedback(
  profile: FeedbackProfile,
  feedback: FeedbackEvent,
): FeedbackProfile {
  const topic = feedback.topic ?? "general";
  const bandit: TopicBandit = profile.topicBandits[topic] ?? { alpha: OPTIMISTIC_ALPHA, beta: OPTIMISTIC_BETA };

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
      [topic]: { alpha: newAlpha, beta: newBeta },
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
