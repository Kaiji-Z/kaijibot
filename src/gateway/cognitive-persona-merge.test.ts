import { describe, expect, it } from "vitest";
import type { FeedbackProfile } from "../cognitive/types.js";
import { mergeSchedulerFeedbackProfile } from "./cognitive-persona-merge.js";

function baseProfile(overrides: Partial<FeedbackProfile> = {}): FeedbackProfile {
  return {
    topicBandits: {},
    optimalFrequencyHours: 48,
    lastProactiveAt: 0,
    recentInsightIds: [],
    recentInsightContents: [],
    ...overrides,
  };
}

describe("mergeSchedulerFeedbackProfile", () => {
  it("keeps reply-path-owned fields from current (bandits, ledger, frequency, suppression)", () => {
    const current = baseProfile({
      topicBandits: { ai: { alpha: 3, beta: 1, lastUpdated: 2 } },
      promptBandits: { v1: { alpha: 1, beta: 0, lastUpdated: 3 } },
      modeBandits: { pattern: { alpha: 2, beta: 2, lastUpdated: 4 } },
      optimalFrequencyHours: 24,
      suppressUntil: 123,
      consecutiveNoResponses: 0,
      lastNoResponseAt: undefined,
    });
    const snapshot = baseProfile({
      topicBandits: {},
      optimalFrequencyHours: 48,
      consecutiveNoResponses: 3,
      lastNoResponseAt: 999,
    });

    const merged = mergeSchedulerFeedbackProfile(current, snapshot);

    // A user reply reset the ledger mid-resolve; the scheduler's stale
    // snapshot must NOT resurrect it (hard-veto invariant).
    expect(merged.consecutiveNoResponses).toBe(0);
    expect(merged.lastNoResponseAt).toBeUndefined();
    expect(merged.topicBandits).toEqual(current.topicBandits);
    expect(merged.promptBandits).toEqual(current.promptBandits);
    expect(merged.modeBandits).toEqual(current.modeBandits);
    expect(merged.optimalFrequencyHours).toBe(24);
    expect(merged.suppressUntil).toBe(123);
  });

  it("copies scheduler-owned pacing/dedup fields from the snapshot", () => {
    const current = baseProfile({
      pendingInsightDelivery: null,
      awaitingDeliveryConfirmation: null,
      dailySendCount: 0,
    });
    const snapshot = baseProfile({
      lastProactiveAt: 500,
      pendingInsightDelivery: {
        candidate: { id: "c1" } as never,
        generatedAt: 400,
        opportunityType: "cross_domain",
      },
      awaitingDeliveryConfirmation: {
        candidate: { id: "c1" } as never,
        opportunityType: "cross_domain",
        eventTimestamp: 500,
      },
      recentInsightIds: ["c1"],
      recentInsightContents: ["content"],
      recentInsightDomains: [["ai"]],
      recentInsightTypes: ["cross_domain"],
      recentInsightModes: ["surprise"],
      recentInsightQueryHistory: ["q"],
      consecutiveResolveFailures: 2,
      dailySendAnchorDay: 20,
      dailySendCount: 1,
      lastReEngageAttemptAt: 300,
    });

    const merged = mergeSchedulerFeedbackProfile(current, snapshot);

    expect(merged.lastProactiveAt).toBe(500);
    expect(merged.pendingInsightDelivery).toEqual(snapshot.pendingInsightDelivery);
    expect(merged.awaitingDeliveryConfirmation).toEqual(snapshot.awaitingDeliveryConfirmation);
    expect(merged.recentInsightIds).toEqual(["c1"]);
    expect(merged.recentInsightContents).toEqual(["content"]);
    expect(merged.recentInsightDomains).toEqual([["ai"]]);
    expect(merged.recentInsightTypes).toEqual(["cross_domain"]);
    expect(merged.recentInsightModes).toEqual(["surprise"]);
    expect(merged.recentInsightQueryHistory).toEqual(["q"]);
    expect(merged.consecutiveResolveFailures).toBe(2);
    expect(merged.dailySendAnchorDay).toBe(20);
    expect(merged.dailySendCount).toBe(1);
    expect(merged.lastReEngageAttemptAt).toBe(300);
  });
});
