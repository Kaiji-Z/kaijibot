import { describe, it, expect } from "vitest";
import {
  updateBanditFromFeedback,
  pickBestTopic,
  adaptFrequency,
  sampleTopicScores,
  decayBandit,
  decayAllBandits,
  DECAY_HALF_LIFE_MS,
  pickPromptVariant,
  updatePromptBandit,
} from "./preference-learner.js";
import type { FeedbackProfile, TopicBandit } from "../types.js";
import type { FeedbackEvent } from "./types.js";

function makeProfile(bandits?: Record<string, TopicBandit>): FeedbackProfile {
  return {
    topicBandits: bandits ?? {},
    optimalFrequencyHours: 4,
    lastProactiveAt: 0,
    recentInsightIds: [],
    recentInsightContents: [],
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

  it("sets lastUpdated on the bandit after update", () => {
    const ts = 1700000000000;
    const profile = makeProfile();
    const feedback: FeedbackEvent = { targetId: "1", type: "positive", mechanism: "emoji", timestamp: ts, topic: "AI" };
    const result = updateBanditFromFeedback(profile, feedback);
    expect(result.topicBandits["AI"]!.lastUpdated).toBe(ts);
  });

  it("applies decay before update when bandit has lastUpdated", () => {
    const oldTs = 1700000000000;
    const newTs = oldTs + DECAY_HALF_LIFE_MS; // exactly one half-life later
    const profile = makeProfile({ AI: { alpha: 12, beta: 1, lastUpdated: oldTs } });
    const feedback: FeedbackEvent = { targetId: "1", type: "positive", mechanism: "emoji", timestamp: newTs, topic: "AI" };
    const result = updateBanditFromFeedback(profile, feedback);

    // alpha should decay 50% toward prior(2): 2 + (12-2)*0.5 = 7, then +1 = 8
    expect(result.topicBandits["AI"]!.alpha).toBeCloseTo(8, 5);
    expect(result.topicBandits["AI"]!.lastUpdated).toBe(newTs);
  });

  it("does not decay when lastUpdated is missing (legacy)", () => {
    const ts = 1700000000000;
    const profile = makeProfile({ AI: { alpha: 12, beta: 1 } });
    const feedback: FeedbackEvent = { targetId: "1", type: "positive", mechanism: "emoji", timestamp: ts, topic: "AI" };
    const result = updateBanditFromFeedback(profile, feedback);
    // No decay: 12 + 1 = 13
    expect(result.topicBandits["AI"]!.alpha).toBe(13);
  });
});

describe("decayBandit", () => {
  it("returns unchanged when lastUpdated is missing", () => {
    const bandit: TopicBandit = { alpha: 10, beta: 5 };
    const result = decayBandit(bandit, Date.now());
    expect(result.alpha).toBe(10);
    expect(result.beta).toBe(5);
  });

  it("returns unchanged when age is zero", () => {
    const now = 1700000000000;
    const bandit: TopicBandit = { alpha: 10, beta: 5, lastUpdated: now };
    const result = decayBandit(bandit, now);
    expect(result.alpha).toBe(10);
    expect(result.beta).toBe(5);
  });

  it("decays 50% toward prior after one half-life", () => {
    const oldTs = 1700000000000;
    const bandit: TopicBandit = { alpha: 12, beta: 5, lastUpdated: oldTs };
    const result = decayBandit(bandit, oldTs + DECAY_HALF_LIFE_MS);

    // alpha: 2 + (12-2)*0.5 = 7
    expect(result.alpha).toBeCloseTo(7, 5);
    // beta: 1 + (5-1)*0.5 = 3
    expect(result.beta).toBeCloseTo(3, 5);
  });

  it("decays more after two half-lives", () => {
    const oldTs = 1700000000000;
    const bandit: TopicBandit = { alpha: 12, beta: 5, lastUpdated: oldTs };
    const result = decayBandit(bandit, oldTs + 2 * DECAY_HALF_LIFE_MS);

    // alpha: 2 + (12-2)*0.25 = 4.5
    expect(result.alpha).toBeCloseTo(4.5, 5);
    // beta: 1 + (5-1)*0.25 = 2
    expect(result.beta).toBeCloseTo(2, 5);
  });

  it("never decays alpha below prior (2)", () => {
    const oldTs = 1700000000000;
    const bandit: TopicBandit = { alpha: 2.5, beta: 1, lastUpdated: oldTs };
    const result = decayBandit(bandit, oldTs + 10 * DECAY_HALF_LIFE_MS);
    expect(result.alpha).toBeGreaterThanOrEqual(2);
    expect(result.beta).toBeGreaterThanOrEqual(1);
  });

  it("never decays beta below prior (1)", () => {
    const oldTs = 1700000000000;
    const bandit: TopicBandit = { alpha: 2, beta: 1.3, lastUpdated: oldTs };
    const result = decayBandit(bandit, oldTs + 10 * DECAY_HALF_LIFE_MS);
    expect(result.beta).toBeGreaterThanOrEqual(1);
  });

  it("preserves lastUpdated timestamp", () => {
    const oldTs = 1700000000000;
    const bandit: TopicBandit = { alpha: 10, beta: 3, lastUpdated: oldTs };
    const result = decayBandit(bandit, oldTs + DECAY_HALF_LIFE_MS);
    expect(result.lastUpdated).toBe(oldTs);
  });

  it("accepts custom halfLife", () => {
    const oldTs = 1700000000000;
    const customHalfLife = 1000; // 1 second
    const bandit: TopicBandit = { alpha: 12, beta: 5, lastUpdated: oldTs };
    const result = decayBandit(bandit, oldTs + 1000, customHalfLife);

    // alpha: 2 + (12-2)*0.5 = 7
    expect(result.alpha).toBeCloseTo(7, 5);
  });
});

describe("decayAllBandits", () => {
  it("decays all bandits in profile", () => {
    const oldTs = 1700000000000;
    const profile = makeProfile({
      AI: { alpha: 12, beta: 3, lastUpdated: oldTs },
      sports: { alpha: 6, beta: 2, lastUpdated: oldTs },
    });
    const result = decayAllBandits(profile, oldTs + DECAY_HALF_LIFE_MS);

    // AI: alpha 2+(12-2)*0.5=7, beta 1+(3-1)*0.5=2
    expect(result.topicBandits["AI"]!.alpha).toBeCloseTo(7, 5);
    expect(result.topicBandits["AI"]!.beta).toBeCloseTo(2, 5);
    // sports: alpha 2+(6-2)*0.5=4, beta 1+(2-1)*0.5=1.5
    expect(result.topicBandits["sports"]!.alpha).toBeCloseTo(4, 5);
    expect(result.topicBandits["sports"]!.beta).toBeCloseTo(1.5, 5);
  });

  it("does not mutate original profile", () => {
    const oldTs = 1700000000000;
    const profile = makeProfile({ AI: { alpha: 12, beta: 3, lastUpdated: oldTs } });
    decayAllBandits(profile, oldTs + DECAY_HALF_LIFE_MS);
    expect(profile.topicBandits["AI"]!.alpha).toBe(12);
  });

  it("skips bandits without lastUpdated", () => {
    const now = 1700000000000;
    const profile = makeProfile({ AI: { alpha: 10, beta: 5 } });
    const result = decayAllBandits(profile, now + DECAY_HALF_LIFE_MS);
    expect(result.topicBandits["AI"]!.alpha).toBe(10);
    expect(result.topicBandits["AI"]!.beta).toBe(5);
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

describe("pickPromptVariant", () => {
  const arms = ["casual", "formal", "concise", "detailed"];

  it("cold start: all equal priors produce roughly uniform selection", () => {
    const counts = new Array(arms.length).fill(0);
    const profile = makeProfile();
    for (let i = 0; i < 1000; i++) {
      counts[pickPromptVariant(profile, arms)]++;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThan(150);
    }
  });

  it("exploits: arm with high alpha/low beta wins >80% over 1000 draws", () => {
    const profile = makeProfile();
    profile.promptBandits = {
      casual: { alpha: 20, beta: 1 },
      formal: { alpha: 2, beta: 1 },
      concise: { alpha: 2, beta: 1 },
      detailed: { alpha: 2, beta: 1 },
    };
    let wins = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickPromptVariant(profile, arms) === 0) wins++;
    }
    expect(wins).toBeGreaterThan(700);
  });

  it("explores: arm with very few trials occasionally beats established arm", () => {
    const profile = makeProfile();
    profile.promptBandits = {
      casual: { alpha: 20, beta: 20 },
      formal: { alpha: 2, beta: 1 },
    };
    let formalWins = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickPromptVariant(profile, ["casual", "formal"]) === 1) formalWins++;
    }
    expect(formalWins).toBeGreaterThan(50);
  });

  it("works with undefined promptBandits (empty profile)", () => {
    const profile = makeProfile();
    expect(profile.promptBandits).toBeUndefined();
    const idx = pickPromptVariant(profile, ["a", "b"]);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(2);
  });

  it("returns 0 for single arm", () => {
    const profile = makeProfile();
    expect(pickPromptVariant(profile, ["only"])).toBe(0);
  });

  it("uses rng parameter for deterministic selection", () => {
    const profile = makeProfile();
    profile.promptBandits = {
      a: { alpha: 5, beta: 1 },
      b: { alpha: 1, beta: 5 },
    };
    const results = new Set<number>();
    for (let i = 0; i < 10; i++) {
      results.add(pickPromptVariant(profile, ["a", "b"], () => 0.5));
    }
    expect(results.size).toBe(1);
  });
});

describe("updatePromptBandit", () => {
  const ts = 1700000000000;

  it("positive feedback increments alpha by 1, beta unchanged", () => {
    const profile = makeProfile();
    profile.promptBandits = { style: { alpha: 3, beta: 2 } };
    const result = updatePromptBandit(profile, "style", "positive", ts);
    expect(result["style"]!.alpha).toBe(4);
    expect(result["style"]!.beta).toBe(2);
  });

  it("negative feedback increments beta by 1, alpha unchanged", () => {
    const profile = makeProfile();
    profile.promptBandits = { style: { alpha: 3, beta: 2 } };
    const result = updatePromptBandit(profile, "style", "negative", ts);
    expect(result["style"]!.alpha).toBe(3);
    expect(result["style"]!.beta).toBe(3);
  });

  it("neutral feedback increments beta by 0.5", () => {
    const profile = makeProfile();
    profile.promptBandits = { style: { alpha: 3, beta: 2 } };
    const result = updatePromptBandit(profile, "style", "neutral", ts);
    expect(result["style"]!.alpha).toBe(3);
    expect(result["style"]!.beta).toBeCloseTo(2.5);
  });

  it("engaged feedback increments alpha by 1", () => {
    const profile = makeProfile();
    profile.promptBandits = { style: { alpha: 3, beta: 2 } };
    const result = updatePromptBandit(profile, "style", "engaged", ts);
    expect(result["style"]!.alpha).toBe(4);
    expect(result["style"]!.beta).toBe(2);
  });

  it("creates new arm with optimistic prior then updates", () => {
    const profile = makeProfile();
    const result = updatePromptBandit(profile, "newArm", "positive", ts);
    expect(result["newArm"]!.alpha).toBe(3); // prior 2 + 1
    expect(result["newArm"]!.beta).toBe(1);
  });

  it("does NOT mutate original profile", () => {
    const profile = makeProfile();
    profile.promptBandits = { style: { alpha: 3, beta: 2 } };
    const originalAlpha = profile.promptBandits["style"]!.alpha;
    updatePromptBandit(profile, "style", "positive", ts);
    expect(profile.promptBandits["style"]!.alpha).toBe(originalAlpha);
  });

  it("sets lastUpdated to the provided timestamp", () => {
    const profile = makeProfile();
    const result = updatePromptBandit(profile, "style", "positive", ts);
    expect(result["style"]!.lastUpdated).toBe(ts);
  });

  it("works with undefined promptBandits on profile", () => {
    const profile = makeProfile();
    expect(profile.promptBandits).toBeUndefined();
    const result = updatePromptBandit(profile, "arm", "negative", ts);
    expect(result["arm"]!.alpha).toBe(2);
    expect(result["arm"]!.beta).toBe(2); // prior 1 + 1
  });
});
