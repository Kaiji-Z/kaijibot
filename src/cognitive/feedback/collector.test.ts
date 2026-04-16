import { describe, it, expect } from "vitest";
import { processInsightFeedback, processInsightDeliverySignal } from "./collector.js";
import type { PersonaTree, InsightRecord } from "../types.js";

function makePersona(overrides: Partial<PersonaTree["feedbackProfile"]> = {}): PersonaTree {
  return {
    identity: {
      coreTraits: {},
      expertDomains: [],
      interestDomains: [],
      curiosityDomains: [],
    },
    domains: {},
    recentFocus: [],
    activeProjects: [],
    pendingQuestions: [],
    feedbackProfile: {
      topicBandits: {
        "AI/机器学习": { alpha: 3, beta: 2 },
        "软件架构": { alpha: 2, beta: 1 },
      },
      preferredStyle: "observation",
      optimalFrequencyHours: 4,
      lastProactiveAt: 0,
      recentInsightIds: [],
      ...overrides,
    },
    rapport: {
      trustScore: 0.5,
      totalExchanges: 10,
      avgResponseLength: 50,
      selfDisclosureLevel: 0.3,
    },
    domainBlacklist: [],
    lifecycle: { stage: "new", lastActiveAt: 0, lastStageTransitionAt: 0, consecutiveSilentDays: 0, totalActiveDays: 0 },
    calibrationHistory: [],
    contradictionLog: [],
    moodHistory: [],
  };
}

function makeInsight(overrides: Partial<InsightRecord> = {}): InsightRecord {
  return {
    id: "insight-test",
    generatedAt: 1000,
    triggerSource: "scheduled",
    targetDomains: ["AI/机器学习"],
    sourceDomains: ["arxiv"],
    content: "Test insight",
    rationale: "Test rationale",
    sources: [],
    deliveredAt: 1500,
    ...overrides,
  };
}

describe("processInsightFeedback", () => {
  it("increases bandit alpha for target domains on positive feedback", () => {
    const persona = makePersona();
    const insight = makeInsight({ targetDomains: ["AI/机器学习"] });

    const result = processInsightFeedback(persona, insight, "positive");

    expect(result.feedbackProfile.topicBandits["AI/机器学习"].alpha).toBe(4);
    expect(result.feedbackProfile.topicBandits["AI/机器学习"].beta).toBe(2);
  });

  it("increases bandit alpha for engaged feedback", () => {
    const persona = makePersona();
    const insight = makeInsight({ targetDomains: ["AI/机器学习"] });

    const result = processInsightFeedback(persona, insight, "engaged");

    expect(result.feedbackProfile.topicBandits["AI/机器学习"].alpha).toBe(4);
    expect(result.feedbackProfile.topicBandits["AI/机器学习"].beta).toBe(2);
  });

  it("increases bandit beta for target domains on negative feedback", () => {
    const persona = makePersona();
    const insight = makeInsight({ targetDomains: ["AI/机器学习"] });

    const result = processInsightFeedback(persona, insight, "negative");

    expect(result.feedbackProfile.topicBandits["AI/机器学习"].alpha).toBe(3);
    expect(result.feedbackProfile.topicBandits["AI/机器学习"].beta).toBe(3);
  });

  it("does not change bandits on neutral feedback", () => {
    const persona = makePersona();
    const insight = makeInsight({ targetDomains: ["AI/机器学习"] });

    const result = processInsightFeedback(persona, insight, "neutral");

    expect(result.feedbackProfile.topicBandits["AI/机器学习"]).toEqual({ alpha: 3, beta: 2 });
  });

  it("skips domains without existing bandits", () => {
    const persona = makePersona();
    const insight = makeInsight({ targetDomains: ["unknown-domain"] });

    const result = processInsightFeedback(persona, insight, "positive");

    expect(result.feedbackProfile.topicBandits["unknown-domain"]).toBeUndefined();
  });

  it("increases trust by 0.05 on engaged feedback", () => {
    const persona = makePersona();
    const insight = makeInsight();

    const result = processInsightFeedback(persona, insight, "engaged");

    expect(result.rapport.trustScore).toBeCloseTo(0.55);
  });

  it("increases trust by 0.03 on positive feedback", () => {
    const persona = makePersona();
    const insight = makeInsight();

    const result = processInsightFeedback(persona, insight, "positive");

    expect(result.rapport.trustScore).toBeCloseTo(0.53);
  });

  it("decreases trust by 0.05 on negative feedback", () => {
    const persona = makePersona();
    const insight = makeInsight();

    const result = processInsightFeedback(persona, insight, "negative");

    expect(result.rapport.trustScore).toBeCloseTo(0.45);
  });

  it("reduces optimalFrequencyHours on positive feedback", () => {
    const persona = makePersona({ optimalFrequencyHours: 5 });
    const insight = makeInsight();

    const result = processInsightFeedback(persona, insight, "positive");

    expect(result.feedbackProfile.optimalFrequencyHours).toBe(4.5);
  });

  it("increases optimalFrequencyHours on negative feedback", () => {
    const persona = makePersona({ optimalFrequencyHours: 5 });
    const insight = makeInsight();

    const result = processInsightFeedback(persona, insight, "negative");

    expect(result.feedbackProfile.optimalFrequencyHours).toBe(7);
  });

  it("clamps frequency to [1, 48] range", () => {
    const personaLow = makePersona({ optimalFrequencyHours: 1 });
    const insight = makeInsight();

    const resultLow = processInsightFeedback(personaLow, insight, "negative");
    expect(resultLow.feedbackProfile.optimalFrequencyHours).toBe(3);

    const personaHigh = makePersona({ optimalFrequencyHours: 47 });
    const resultHigh = processInsightFeedback(personaHigh, insight, "positive");
    expect(resultHigh.feedbackProfile.optimalFrequencyHours).toBe(46.5);

    const personaAtMax = makePersona({ optimalFrequencyHours: 46 });
    const resultAtMax = processInsightFeedback(personaAtMax, insight, "negative");
    expect(resultAtMax.feedbackProfile.optimalFrequencyHours).toBe(48);
  });

  it("updates lastProactiveAt from insight.deliveredAt", () => {
    const persona = makePersona({ lastProactiveAt: 100 });
    const insight = makeInsight({ deliveredAt: 500 });

    const result = processInsightFeedback(persona, insight, "positive");

    expect(result.feedbackProfile.lastProactiveAt).toBe(500);
  });

  it("preserves lastProactiveAt when insight has no deliveredAt", () => {
    const persona = makePersona({ lastProactiveAt: 100 });
    const insight = makeInsight({ deliveredAt: undefined });

    const result = processInsightFeedback(persona, insight, "positive");

    expect(result.feedbackProfile.lastProactiveAt).toBe(100);
  });

  it("does not mutate input persona", () => {
    const persona = makePersona();
    const originalBandits = { ...persona.feedbackProfile.topicBandits };
    const originalBanditRef = persona.feedbackProfile.topicBandits["AI/机器学习"];
    const originalTrust = persona.rapport.trustScore;
    const originalFreq = persona.feedbackProfile.optimalFrequencyHours;
    const insight = makeInsight();

    processInsightFeedback(persona, insight, "positive");

    expect(persona.feedbackProfile.topicBandits).toEqual(originalBandits);
    expect(persona.feedbackProfile.topicBandits["AI/机器学习"]).toBe(originalBanditRef);
    expect(persona.rapport.trustScore).toBe(originalTrust);
    expect(persona.feedbackProfile.optimalFrequencyHours).toBe(originalFreq);
  });
});

describe("processInsightDeliverySignal", () => {
  it("updates lastProactiveAt from insight.deliveredAt", () => {
    const persona = makePersona({ lastProactiveAt: 100 });
    const insight = makeInsight({ deliveredAt: 500 });

    const result = processInsightDeliverySignal(persona, insight);

    expect(result.feedbackProfile.lastProactiveAt).toBe(500);
  });

  it("keeps higher lastProactiveAt when persona already has a later timestamp", () => {
    const persona = makePersona({ lastProactiveAt: 900 });
    const insight = makeInsight({ deliveredAt: 500 });

    const result = processInsightDeliverySignal(persona, insight);

    expect(result.feedbackProfile.lastProactiveAt).toBe(900);
  });

  it("does not change bandits or trust", () => {
    const persona = makePersona();
    const insight = makeInsight({ deliveredAt: 500 });

    const result = processInsightDeliverySignal(persona, insight);

    expect(result.feedbackProfile.topicBandits).toEqual(persona.feedbackProfile.topicBandits);
    expect(result.rapport.trustScore).toBe(persona.rapport.trustScore);
    expect(result.feedbackProfile.optimalFrequencyHours).toBe(persona.feedbackProfile.optimalFrequencyHours);
  });

  it("does not mutate input persona", () => {
    const persona = makePersona({ lastProactiveAt: 100 });
    const insight = makeInsight({ deliveredAt: 500 });

    processInsightDeliverySignal(persona, insight);

    expect(persona.feedbackProfile.lastProactiveAt).toBe(100);
  });
});
