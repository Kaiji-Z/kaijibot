import { describe, it, expect } from "vitest";
import { updateBanditFromFeedback, pickBestTopic, adaptFrequency, sampleTopicScores } from "./preference-learner.js";
import type { FeedbackProfile } from "../types.js";
import type { FeedbackEvent } from "./types.js";

function makeProfile(bandits?: Record<string, { alpha: number; beta: number }>): FeedbackProfile {
  return {
    topicBandits: bandits ?? {},
    preferredStyle: "observation",
    optimalFrequencyHours: 4,
    lastProactiveAt: 0,
  };
}

describe("updateBanditFromFeedback", () => {
  it("adds positive feedback to alpha", () => {
    const profile = makeProfile();
    const feedback: FeedbackEvent = { targetId: "1", type: "positive", mechanism: "emoji", timestamp: Date.now(), topic: "AI" };
    const result = updateBanditFromFeedback(profile, feedback);
    expect(result.topicBandits["AI"]!.alpha).toBe(3); // 2 (prior) + 1
  });

  it("adds negative feedback to beta", () => {
    const profile = makeProfile();
    const feedback: FeedbackEvent = { targetId: "1", type: "negative", mechanism: "button", timestamp: Date.now(), topic: "sports" };
    const result = updateBanditFromFeedback(profile, feedback);
    expect(result.topicBandits["sports"]!.beta).toBe(2); // 1 (prior) + 1
  });

  it("does not mutate the original profile", () => {
    const profile = makeProfile({ AI: { alpha: 2, beta: 1 } });
    const feedback: FeedbackEvent = { targetId: "1", type: "positive", mechanism: "emoji", timestamp: Date.now(), topic: "AI" };
    updateBanditFromFeedback(profile, feedback);
    expect(profile.topicBandits["AI"]!.alpha).toBe(2);
  });
});

describe("pickBestTopic", () => {
  it("returns a topic with high sampling score", () => {
    const profile = makeProfile({ AI: { alpha: 10, beta: 1 }, sports: { alpha: 1, beta: 10 } });
    // With deterministic rng, AI should win
    const topic = pickBestTopic(profile, { rng: () => 0.5 });
    expect(topic).toBe("AI");
  });

  it("returns undefined when all topics are excluded", () => {
    const profile = makeProfile({ AI: { alpha: 5, beta: 1 } });
    const topic = pickBestTopic(profile, { excludeTopics: ["AI"] });
    expect(topic).toBeUndefined();
  });

  it("returns undefined when no topics exist", () => {
    const profile = makeProfile();
    const topic = pickBestTopic(profile);
    expect(topic).toBeUndefined();
  });
});

describe("adaptFrequency", () => {
  it("increases frequency on positive feedback", () => {
    const result = adaptFrequency(4, { targetId: "1", type: "positive", mechanism: "emoji", timestamp: Date.now() });
    expect(result).toBe(3.5);
  });

  it("decreases frequency on negative feedback", () => {
    const result = adaptFrequency(4, { targetId: "1", type: "negative", mechanism: "button", timestamp: Date.now() });
    expect(result).toBe(6);
  });

  it("clamps to minimum of 1 hour", () => {
    const result = adaptFrequency(1, { targetId: "1", type: "positive", mechanism: "emoji", timestamp: Date.now() });
    expect(result).toBe(1);
  });

  it("clamps to maximum of 48 hours", () => {
    const result = adaptFrequency(47, { targetId: "1", type: "negative", mechanism: "button", timestamp: Date.now() });
    expect(result).toBe(48);
  });
});
