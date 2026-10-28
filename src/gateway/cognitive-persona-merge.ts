import type { FeedbackProfile } from "../cognitive/types.js";

/**
 * Field-level merge for the proactive scheduler's persona saves.
 *
 * The scheduler holds one persona snapshot across a multi-minute LLM resolve
 * loop (generate → critique → refine → verify). A wholesale
 * `current.feedbackProfile = snapshot.feedbackProfile` at save time would
 * revert every write the reply path persisted during that window — most
 * critically `resetNoResponseStreak` (a user reply clearing the
 * no-response ledger), Thompson-Sampling bandit updates, and
 * `optimalFrequencyHours` nudges. Reverting a ledger reset can push a
 * responsive user over the hard veto threshold (U ≥ 3) and silence them
 * despite having answered.
 *
 * Ownership rules:
 * - Scheduler-owned pacing/dedup fields are copied from the snapshot (the
 *   scheduler is the only writer at save time).
 * - Reply-path-owned fields (bandits, frequency, suppression, ledger) are
 *   kept from `current`. The ledger is persisted exclusively by the atomic
 *   `applyNoResponseLedger` callback, never by savePersona.
 */
export function mergeSchedulerFeedbackProfile(
  current: FeedbackProfile,
  snapshot: FeedbackProfile,
): FeedbackProfile {
  return {
    ...current,
    lastProactiveAt: snapshot.lastProactiveAt,
    pendingInsightDelivery: snapshot.pendingInsightDelivery,
    awaitingDeliveryConfirmation: snapshot.awaitingDeliveryConfirmation,
    recentInsightIds: snapshot.recentInsightIds,
    recentInsightContents: snapshot.recentInsightContents,
    recentInsightDomains: snapshot.recentInsightDomains,
    recentInsightTypes: snapshot.recentInsightTypes,
    recentInsightModes: snapshot.recentInsightModes,
    recentInsightQueryHistory: snapshot.recentInsightQueryHistory,
    consecutiveResolveFailures: snapshot.consecutiveResolveFailures,
    dailySendAnchorDay: snapshot.dailySendAnchorDay,
    dailySendCount: snapshot.dailySendCount,
    lastReEngageAttemptAt: snapshot.lastReEngageAttemptAt,
    // Deliberately kept from `current` (reply-path owned):
    // topicBandits, promptBandits, modeBandits, optimalFrequencyHours,
    // suppressUntil, consecutiveNoResponses, lastNoResponseAt.
  };
}
