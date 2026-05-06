import type { PersonaTree, InsightRecord } from "../types.js";
import type { FeedbackEvent, ImplicitFeedbackSignal } from "./types.js";
import { updateBanditFromFeedback, adaptFrequency, updatePromptBandit } from "./preference-learner.js";
import { updateTrustFromFeedback, updateTrustFromImplicit } from "./trust-calculator.js";
import { recordCalibration } from "./calibration.js";

/**
 * Process a feedback event and return an updated PersonaTree.
 * Does NOT mutate the input.
 */
export function processFeedback(
  persona: PersonaTree,
  feedback: FeedbackEvent,
): PersonaTree {
  const updatedProfile = updateBanditFromFeedback(persona.feedbackProfile, feedback);
  const updatedRapport = updateTrustFromFeedback(persona.rapport, feedback);
  const updatedFrequency = adaptFrequency(updatedProfile.optimalFrequencyHours, feedback);

  return {
    ...persona,
    feedbackProfile: {
      ...updatedProfile,
      optimalFrequencyHours: updatedFrequency,
      lastProactiveAt: feedback.type === "positive" || feedback.type === "engaged"
        ? feedback.timestamp
        : updatedProfile.lastProactiveAt,
    },
    rapport: updatedRapport,
  };
}

/**
 * Process implicit feedback signals and return an updated PersonaTree.
 */
export function processImplicitFeedback(
  persona: PersonaTree,
  signals: ImplicitFeedbackSignal[],
): PersonaTree {
  if (signals.length === 0) return persona;

  const updatedRapport = updateTrustFromImplicit(persona.rapport, signals);

  const updatedBandits = { ...persona.feedbackProfile.topicBandits };
  for (const signal of signals) {
    if (signal.topic && signal.type === "topic_continuation") {
      const bandit = updatedBandits[signal.topic] ?? { alpha: 2, beta: 1 };
      updatedBandits[signal.topic] = { alpha: bandit.alpha + 0.5, beta: bandit.beta };
    }
    if (signal.topic && signal.type === "topic_abandonment") {
      const bandit = updatedBandits[signal.topic] ?? { alpha: 2, beta: 1 };
      updatedBandits[signal.topic] = { alpha: bandit.alpha, beta: bandit.beta + 0.3 };
    }
  }

  return {
    ...persona,
    rapport: updatedRapport,
    feedbackProfile: {
      ...persona.feedbackProfile,
      topicBandits: updatedBandits,
    },
  };
}

/**
 * Extract implicit feedback signals from a conversation turn.
 */
export function extractImplicitSignals(
  userMessage: string,
  responseLatencyMs?: number,
  topic?: string,
): ImplicitFeedbackSignal[] {
  const signals: ImplicitFeedbackSignal[] = [];

  signals.push({
    type: "response_length",
    topic,
    value: userMessage.length,
    timestamp: Date.now(),
  });

  if (responseLatencyMs !== undefined) {
    signals.push({
      type: "response_latency",
      topic,
      value: responseLatencyMs,
      timestamp: Date.now(),
    });
  }

  // Question depth — check if user asks deep follow-up questions
  const hasDeepQuestion = /[为什么|如何|怎样|what if|why|how come|深层|本质]/.test(userMessage);
  if (hasDeepQuestion) {
    signals.push({
      type: "question_depth",
      topic,
      value: 1,
      timestamp: Date.now(),
    });
  }

  return signals;
}

/**
 * Process explicit feedback on a delivered insight and return updated PersonaTree.
 * Updates topic bandits, trust, and proactive frequency — does NOT mutate input.
 */
export function processInsightFeedback(
  persona: PersonaTree,
  insight: InsightRecord,
  feedback: "positive" | "negative" | "neutral" | "engaged",
): PersonaTree {
  const updatedBandits = { ...persona.feedbackProfile.topicBandits };
  for (const domain of insight.targetDomains) {
    const bandit = updatedBandits[domain];
    if (bandit) {
      if (feedback === "positive" || feedback === "engaged") {
        updatedBandits[domain] = { ...bandit, alpha: bandit.alpha + 1.0 };
      } else if (feedback === "negative") {
        updatedBandits[domain] = { ...bandit, beta: bandit.beta + 1.0 };
      }
    }
  }

  let promptBandits = persona.feedbackProfile.promptBandits;
  if (insight.promptVariant) {
    const v = insight.promptVariant;
    const armKeys = [
      `fewShot:${v.fewShotSet}`,
      `frame:${v.frameIndex}`,
      ...(v.structureSeed !== undefined ? [`seed:${v.structureSeed}`] : []),
      ...(v.patternFrame !== undefined ? [`pattern:${v.patternFrame}`] : []),
    ];
    let updated = { ...(promptBandits ?? {}) };
    const timestamp = insight.deliveredAt ?? Date.now();
    for (const key of armKeys) {
      updated = updatePromptBandit({ promptBandits: updated }, key, feedback, timestamp);
    }
    promptBandits = updated;
  }

  const trustDelta = feedback === "positive"
    ? 0.03
    : feedback === "engaged"
      ? 0.05
      : feedback === "negative"
        ? -0.05
        : 0;

  const newTrustScore = Math.max(0.1, Math.min(1.0, persona.rapport.trustScore + trustDelta));

  const freqDelta = feedback === "positive" || feedback === "engaged"
    ? -0.5
    : feedback === "negative"
      ? 2.0
      : 0;

  const newFrequency = Math.max(1, Math.min(48, persona.feedbackProfile.optimalFrequencyHours + freqDelta));

  const lastProactiveAt = insight.deliveredAt
    ? Math.max(persona.feedbackProfile.lastProactiveAt, insight.deliveredAt)
    : persona.feedbackProfile.lastProactiveAt;

  const calRecord = recordCalibration(insight.id, 0.5, feedback);

  return {
    ...persona,
    rapport: {
      ...persona.rapport,
      trustScore: newTrustScore,
    },
    feedbackProfile: {
      ...persona.feedbackProfile,
      topicBandits: updatedBandits,
      promptBandits,
      optimalFrequencyHours: newFrequency,
      lastProactiveAt,
    },
    calibrationHistory: [...persona.calibrationHistory, calRecord],
  };
}

/**
 * Record that an insight was delivered without explicit user feedback.
 * Updates lastProactiveAt only — does NOT change bandits or trust.
 */
export function processInsightDeliverySignal(
  persona: PersonaTree,
  insight: InsightRecord,
): PersonaTree {
  const lastProactiveAt = insight.deliveredAt
    ? Math.max(persona.feedbackProfile.lastProactiveAt, insight.deliveredAt)
    : persona.feedbackProfile.lastProactiveAt;

  return {
    ...persona,
    feedbackProfile: {
      ...persona.feedbackProfile,
      lastProactiveAt,
    },
  };
}
