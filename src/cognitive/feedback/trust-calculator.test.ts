import { describe, it, expect } from "vitest";
import { mergeExtraction } from "../persona/curator.js";
import { createDefaultPersona } from "../persona/store.js";
import type { RapportMetrics } from "../types.js";
import { extractImplicitSignals, processImplicitFeedback } from "./collector.js";
import {
  updateTrustFromFeedback,
  updateTrustFromImplicit,
  getInteractionPhase,
  getPhaseBehaviorAdvice,
} from "./trust-calculator.js";

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
    const result = updateTrustFromFeedback(rapport, {
      targetId: "1",
      type: "positive",
      mechanism: "emoji",
      timestamp: Date.now(),
    });
    expect(result.trustScore).toBeGreaterThan(0.5);
  });

  it("decreases trust on negative feedback", () => {
    const rapport = makeRapport({ trustScore: 0.5 });
    const result = updateTrustFromFeedback(rapport, {
      targetId: "1",
      type: "negative",
      mechanism: "button",
      timestamp: Date.now(),
    });
    expect(result.trustScore).toBeLessThan(0.5);
  });

  it("does not go below baseline", () => {
    const rapport = makeRapport({ trustScore: 0.1 });
    const result = updateTrustFromFeedback(rapport, {
      targetId: "1",
      type: "negative",
      mechanism: "button",
      timestamp: Date.now(),
    });
    expect(result.trustScore).toBe(0.1);
  });

  it("does not exceed 1.0", () => {
    const rapport = makeRapport({ trustScore: 0.99 });
    const result = updateTrustFromFeedback(rapport, {
      targetId: "1",
      type: "engaged",
      mechanism: "emoji",
      timestamp: Date.now(),
    });
    expect(result.trustScore).toBeLessThanOrEqual(1.0);
  });
});

describe("updateTrustFromImplicit", () => {
  it("does not count a turn's signals as extra exchanges", () => {
    // mergeExtraction has already counted this turn (10 → 11).
    const rapport = makeRapport({
      trustScore: 0.5,
      totalExchanges: 11,
      avgResponseLength: 100,
      selfDisclosureLevel: 0.3,
    });
    const message = "为什么会这样？请详细说明一下";
    const signals = extractImplicitSignals(message, undefined, "AI", ["AI"]);

    const result = updateTrustFromImplicit(rapport, signals);

    expect(signals.length).toBeGreaterThan(1);
    expect(result.totalExchanges).toBe(11);
    // The message is one new length sample across the 11 exchanges.
    expect(result.avgResponseLength).toBeCloseTo((100 * 10 + message.length) / 11, 10);
  });

  it("counts one exchange per conversation turn through the write pipeline", () => {
    let persona = createDefaultPersona();
    const emptyExtraction = { attributes: [], domains: [], recentFocus: [] };

    for (const message of ["帮我看看这个问题", "为什么会这样？", "好，继续"]) {
      const merged = mergeExtraction(persona, emptyExtraction);
      const signals = extractImplicitSignals(message, undefined, "调试", merged.recentFocus);
      persona = processImplicitFeedback(merged, signals);
    }

    expect(persona.rapport.totalExchanges).toBe(3);
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
