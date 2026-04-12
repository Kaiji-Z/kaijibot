import type { RapportMetrics } from "../types.js";
import type { FeedbackEvent, ImplicitFeedbackSignal } from "./types.js";

/**
 * Calculate trust score based on interaction history and feedback.
 *
 * Trust is a composite of:
 * - Interaction depth (total exchanges)
 * - Self-disclosure level (how much the user shares about themselves)
 * - Response engagement (average response length as proxy)
 * - Feedback positivity ratio
 */

const TRUST_BASELINE = 0.1;
const MAX_TRUST = 1.0;

/**
 * Update trust score based on a feedback event.
 */
export function updateTrustFromFeedback(
  rapport: RapportMetrics,
  feedback: FeedbackEvent,
): RapportMetrics {
  const delta = feedbackScoreDelta(feedback.type);
  const newTrust = clampTrust(rapport.trustScore + delta);

  return {
    ...rapport,
    trustScore: newTrust,
    totalExchanges: rapport.totalExchanges + 1,
  };
}

/**
 * Update trust based on implicit feedback signals.
 */
export function updateTrustFromImplicit(
  rapport: RapportMetrics,
  signals: ImplicitFeedbackSignal[],
): RapportMetrics {
  let trustDelta = 0;
  let totalResponseLength = rapport.avgResponseLength * rapport.totalExchanges;
  let disclosureDelta = 0;

  for (const signal of signals) {
    switch (signal.type) {
      case "response_length":
        // Longer responses = more engagement
        if (signal.value > 100) trustDelta += 0.02;
        else if (signal.value < 20) trustDelta -= 0.01;
        totalResponseLength += signal.value;
        break;
      case "response_latency":
        // Quick response = engaged, very slow = disinterested
        if (signal.value < 60_000) trustDelta += 0.01;
        else if (signal.value > 3600_000) trustDelta -= 0.01;
        break;
      case "topic_continuation":
        trustDelta += 0.03;
        break;
      case "topic_abandonment":
        trustDelta -= 0.02;
        break;
      case "question_depth":
        // Deeper questions = higher engagement
        trustDelta += 0.02;
        disclosureDelta += 0.05;
        break;
    }
  }

  const newTotalExchanges = rapport.totalExchanges + signals.length;
  const newAvgResponseLength = newTotalExchanges > 0
    ? totalResponseLength / newTotalExchanges
    : rapport.avgResponseLength;

  return {
    ...rapport,
    trustScore: clampTrust(rapport.trustScore + trustDelta),
    totalExchanges: newTotalExchanges,
    avgResponseLength: newAvgResponseLength,
    selfDisclosureLevel: Math.min(1, rapport.selfDisclosureLevel + disclosureDelta),
  };
}

/**
 * Calculate trust score from scratch based on rapport metrics.
 */
export function calculateTrustScore(rapport: RapportMetrics): number {
  // Weighted composite score
  const exchangeScore = Math.min(1, rapport.totalExchanges / 50); // Max at 50 exchanges
  const lengthScore = Math.min(1, rapport.avgResponseLength / 200); // Max at 200 chars avg
  const disclosureScore = rapport.selfDisclosureLevel;
  const existingTrust = rapport.trustScore;

  // Weighted blend: existing trust gets highest weight (stickiness)
  const composite = existingTrust * 0.5 + exchangeScore * 0.2 + lengthScore * 0.15 + disclosureScore * 0.15;
  return clampTrust(composite);
}

/**
 * Determine the interaction phase based on trust score.
 * Maps to SARA framework strategies.
 */
export function getInteractionPhase(trustScore: number): "orientation" | "exploration" | "rapport" | "partnership" {
  if (trustScore < 0.3) return "orientation";
  if (trustScore < 0.5) return "exploration";
  if (trustScore < 0.7) return "rapport";
  return "partnership";
}

/**
 * Get recommended behavior based on interaction phase.
 */
export function getPhaseBehaviorAdvice(phase: ReturnType<typeof getInteractionPhase>): string {
  switch (phase) {
    case "orientation":
      return "Focus on demonstrating capability and active listening. Acknowledge and validate. No proactive suggestions yet.";
    case "exploration":
      return "Begin sharing observations about the user's interests. Ask occasional curiosity questions (1 per 3 turns). Still prioritize task execution.";
    case "rapport":
      return "Start connecting patterns across the user's domains. Offer brief insights when relevant. Use 2:1 statement-to-question ratio.";
    case "partnership":
      return "Proactively suggest insights. Cross-reference domains. Challenge assumptions respectfully. Full thinking partner mode.";
  }
}

function feedbackScoreDelta(type: FeedbackEvent["type"]): number {
  switch (type) {
    case "positive": return 0.05;
    case "engaged": return 0.08;
    case "negative": return -0.08;
    case "neutral": return 0;
  }
}

function clampTrust(value: number): number {
  return Math.max(TRUST_BASELINE, Math.min(MAX_TRUST, value));
}
