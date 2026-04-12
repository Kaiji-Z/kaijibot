import { describe, it, expect } from "vitest";
import { updateTrustFromFeedback, getInteractionPhase, getPhaseBehaviorAdvice, calculateTrustScore } from "./trust-calculator.js";
import type { RapportMetrics } from "../types.js";

function makeRapport(overrides?: Partial<RapportMetrics>): RapportMetrics {
  return {
    trustScore: 0.1,
    totalExchanges: 0,
    avgResponseLength: 0,
    selfDisclosureLevel: 0,
    ...overrides,
  };
}

describe("updateTrustFromFeedback", () => {
  it("increases trust on positive feedback", () => {
    const rapport = makeRapport({ trustScore: 0.5 });
    const result = updateTrustFromFeedback(rapport, { targetId: "1", type: "positive", mechanism: "emoji", timestamp: Date.now() });
    expect(result.trustScore).toBeGreaterThan(0.5);
  });

  it("decreases trust on negative feedback", () => {
    const rapport = makeRapport({ trustScore: 0.5 });
    const result = updateTrustFromFeedback(rapport, { targetId: "1", type: "negative", mechanism: "button", timestamp: Date.now() });
    expect(result.trustScore).toBeLessThan(0.5);
  });

  it("does not go below baseline", () => {
    const rapport = makeRapport({ trustScore: 0.1 });
    const result = updateTrustFromFeedback(rapport, { targetId: "1", type: "negative", mechanism: "button", timestamp: Date.now() });
    expect(result.trustScore).toBe(0.1);
  });

  it("does not exceed 1.0", () => {
    const rapport = makeRapport({ trustScore: 0.99 });
    const result = updateTrustFromFeedback(rapport, { targetId: "1", type: "engaged", mechanism: "emoji", timestamp: Date.now() });
    expect(result.trustScore).toBeLessThanOrEqual(1.0);
  });
});

describe("getInteractionPhase", () => {
  it("returns orientation for low trust", () => {
    expect(getInteractionPhase(0.1)).toBe("orientation");
  });
  it("returns exploration for medium-low trust", () => {
    expect(getInteractionPhase(0.4)).toBe("exploration");
  });
  it("returns rapport for medium-high trust", () => {
    expect(getInteractionPhase(0.6)).toBe("rapport");
  });
  it("returns partnership for high trust", () => {
    expect(getInteractionPhase(0.8)).toBe("partnership");
  });
});

describe("getPhaseBehaviorAdvice", () => {
  it("returns non-empty strings for all phases", () => {
    for (const phase of ["orientation", "exploration", "rapport", "partnership"] as const) {
      const advice = getPhaseBehaviorAdvice(phase);
      expect(advice.length).toBeGreaterThan(10);
    }
  });
});
