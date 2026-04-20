import { describe, it, expect } from "vitest";
import { checkProactiveGate, computeGradedGate, computeRepetitionDecay } from "./gate.js";
import { createDefaultPersona } from "../persona/store.js";
import type { SchedulerConfig, GateContext } from "./types.js";

const baseConfig: SchedulerConfig = {
  minIntervalHours: 4,
  minTrustScore: 0.3,
};

// ── Legacy binary gate tests ─────────────────────────────────────────

describe("checkProactiveGate", () => {
  it("blocks when trust is too low", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.1;
    persona.rapport.totalExchanges = 10;
    const result = checkProactiveGate(persona, baseConfig);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Trust score")]),
    );
  });

  it("blocks when too soon after last proactive", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.5;
    persona.rapport.totalExchanges = 10;
    persona.feedbackProfile.lastProactiveAt = Date.now() - 1000;
    const result = checkProactiveGate(persona, baseConfig);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Too soon")]),
    );
  });

  it("blocks when suppressed", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.5;
    persona.rapport.totalExchanges = 10;
    persona.feedbackProfile.lastProactiveAt = 0;
    persona.feedbackProfile.suppressUntil = Date.now() + 3600000;
    const result = checkProactiveGate(persona, baseConfig);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Suppressed")]),
    );
  });

  it("blocks when total exchanges < 5", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.5;
    persona.rapport.totalExchanges = 3;
    persona.feedbackProfile.lastProactiveAt = 0;
    const result = checkProactiveGate(persona, baseConfig);
    expect(result.allowed).toBe(false);
  });

  it("allows when all conditions are met", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.5;
    persona.rapport.totalExchanges = 10;
    persona.feedbackProfile.lastProactiveAt = 0;
    const result = checkProactiveGate(persona, baseConfig);
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("blocks outside active hours", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.5;
    persona.rapport.totalExchanges = 10;
    persona.feedbackProfile.lastProactiveAt = 0;

    const config: SchedulerConfig = {
      ...baseConfig,
      activeHoursStart: "09:00",
      activeHoursEnd: "10:00",
      timezone: "UTC",
    };

    const testTime = new Date("2026-04-11T15:00:00Z").getTime();
    const result = checkProactiveGate(persona, config, testTime);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Outside active hours")]),
    );
  });

  it("allows within active hours", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.5;
    persona.rapport.totalExchanges = 10;
    persona.feedbackProfile.lastProactiveAt = 0;

    const config: SchedulerConfig = {
      ...baseConfig,
      activeHoursStart: "09:00",
      activeHoursEnd: "22:00",
      timezone: "UTC",
    };

    const testTime = new Date("2026-04-11T14:00:00Z").getTime();
    const result = checkProactiveGate(persona, config, testTime);
    expect(result.allowed).toBe(true);
  });
});

// ── PRISM graded gate tests ──────────────────────────────────────────

function makeGateContext(overrides?: Partial<GateContext>): GateContext {
  const persona = createDefaultPersona();
  persona.rapport.trustScore = 0.7;
  persona.rapport.totalExchanges = 10;
  persona.feedbackProfile.lastProactiveAt = 0;
  persona.domains = {
    "AI/ML": { depth: 5, recurrence: 10, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
    "Rust": { depth: 4, recurrence: 8, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
    "Design": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
  };
  persona.feedbackProfile.topicBandits = {
    "AI/ML": { alpha: 5, beta: 1 },
    "Rust": { alpha: 4, beta: 2 },
  };

  return {
    persona,
    event: { type: "persona_change", timestamp: Date.now() },
    recentInsightCount: 3,
    config: baseConfig,
    ...overrides,
  };
}

describe("computeGradedGate", () => {
  it("returns GradedGateDecision with all probability fields in [0,1]", () => {
    const ctx = makeGateContext();
    const result = computeGradedGate(ctx);

    expect(result.pNeed).toBeGreaterThanOrEqual(0);
    expect(result.pNeed).toBeLessThanOrEqual(1);
    expect(result.pAccept).toBeGreaterThanOrEqual(0);
    expect(result.pAccept).toBeLessThanOrEqual(1);
    expect(result.pAct).toBeGreaterThanOrEqual(0);
    expect(result.pAct).toBeLessThanOrEqual(1);
    expect(typeof result.decision).toBe("boolean");
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it("pAct equals pNeed * pAccept exactly", () => {
    const ctx = makeGateContext();
    const result = computeGradedGate(ctx);

    expect(result.pAct).toBeCloseTo(result.pNeed * result.pAccept, 10);
  });

  it("p_need increases with time since last proactive", () => {
    const now = Date.now();
    const recentCtx = makeGateContext({
      persona: (() => {
        const p = createDefaultPersona();
        p.rapport.trustScore = 0.7;
        p.rapport.totalExchanges = 10;
        p.feedbackProfile.lastProactiveAt = now - 1 * 3600_000; // 1 hour ago
        p.domains = { "AI": { depth: 5, recurrence: 10, lastMentioned: now, keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 } };
        return p;
      })(),
      event: { type: "timer", timestamp: now },
    });

    const oldCtx = makeGateContext({
      persona: (() => {
        const p = createDefaultPersona();
        p.rapport.trustScore = 0.7;
        p.rapport.totalExchanges = 10;
        p.feedbackProfile.lastProactiveAt = now - 24 * 3600_000; // 24 hours ago
        p.domains = { "AI": { depth: 5, recurrence: 10, lastMentioned: now, keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 } };
        return p;
      })(),
      event: { type: "timer", timestamp: now },
    });

    const recentResult = computeGradedGate(recentCtx);
    const oldResult = computeGradedGate(oldCtx);

    expect(oldResult.pNeed).toBeGreaterThan(recentResult.pNeed);
  });

  it("p_need is higher for persona_change vs timer events", () => {
    const now = Date.now();
    const basePersona = () => {
      const p = createDefaultPersona();
      p.rapport.trustScore = 0.7;
      p.rapport.totalExchanges = 10;
      p.feedbackProfile.lastProactiveAt = now - 10 * 3600_000;
      p.domains = { "AI": { depth: 5, recurrence: 10, lastMentioned: now, keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 } };
      return p;
    };

    const timerCtx = makeGateContext({
      persona: basePersona(),
      event: { type: "timer", timestamp: now },
    });
    const changeCtx = makeGateContext({
      persona: basePersona(),
      event: { type: "persona_change", timestamp: now },
    });

    const timerResult = computeGradedGate(timerCtx);
    const changeResult = computeGradedGate(changeCtx);

    expect(changeResult.pNeed).toBeGreaterThan(timerResult.pNeed);
  });

  it("p_accept increases with trust score", () => {
    const now = Date.now();
    const makePersona = (trust: number) => {
      const p = createDefaultPersona();
      p.rapport.trustScore = trust;
      p.rapport.totalExchanges = 10;
      p.feedbackProfile.topicBandits = { "AI": { alpha: 3, beta: 1 } };
      return p;
    };

    const lowTrust = makePersona(0.2);
    const highTrust = makePersona(0.9);

    const lowResult = computeGradedGate(makeGateContext({ persona: lowTrust, event: { type: "timer", timestamp: now } }));
    const highResult = computeGradedGate(makeGateContext({ persona: highTrust, event: { type: "timer", timestamp: now } }));

    expect(highResult.pAccept).toBeGreaterThan(lowResult.pAccept);
  });

  it("p_accept increases with positive bandit means", () => {
    const now = Date.now();
    const makePersona = (bandits: Record<string, { alpha: number; beta: number }>) => {
      const p = createDefaultPersona();
      p.rapport.trustScore = 0.5;
      p.rapport.totalExchanges = 10;
      p.feedbackProfile.topicBandits = bandits;
      return p;
    };

    const negativeBandits = makePersona({ "AI": { alpha: 2, beta: 10 } });
    const positiveBandits = makePersona({ "AI": { alpha: 10, beta: 1 } });

    const negResult = computeGradedGate(makeGateContext({ persona: negativeBandits, event: { type: "timer", timestamp: now } }));
    const posResult = computeGradedGate(makeGateContext({ persona: positiveBandits, event: { type: "timer", timestamp: now } }));

    expect(posResult.pAccept).toBeGreaterThan(negResult.pAccept);
  });

  it("higher C_FN lowers threshold, making it easier to trigger", () => {
    const ctx = makeGateContext({
      config: { ...baseConfig, costFalseNegative: 10.0, costFalseAlarm: 1.0 },
    });
    const result = computeGradedGate(ctx);
    // threshold = 1/(10+1) ≈ 0.091
    // With good persona, should trigger easily
    expect(result.decision).toBe(true);
  });

  it("higher C_FA raises threshold, making it harder to trigger", () => {
    const ctx = makeGateContext({
      config: { ...baseConfig, costFalseNegative: 1.0, costFalseAlarm: 100.0 },
    });
    const result = computeGradedGate(ctx);
    // threshold = 100/(1+100) ≈ 0.99 — nearly impossible
    expect(result.decision).toBe(false);
  });

  it("default config: C_FN=3.0, C_FA=1.0, threshold=0.25", () => {
    const ctx = makeGateContext({
      config: { ...baseConfig },
    });
    const result = computeGradedGate(ctx);
    // Default threshold = 1/(3+1) = 0.25
    // With trust=0.7, positive bandits, persona_change event → should trigger
    expect(result.decision).toBe(true);
  });

  // Hard veto tests

  it("hard veto: active hours check still enforced for timer events", () => {
    const ctx = makeGateContext({
      event: { type: "timer", timestamp: new Date("2026-04-11T23:00:00Z").getTime() },
      config: {
        ...baseConfig,
        activeHoursStart: "09:00",
        activeHoursEnd: "18:00",
        timezone: "UTC",
      },
    });
    const result = computeGradedGate(ctx);
    expect(result.decision).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Outside active hours")]),
    );
    expect(result.pNeed).toBe(0);
    expect(result.pAct).toBe(0);
  });

  it("active hours check does NOT veto non-timer events", () => {
    const ctx = makeGateContext({
      event: { type: "persona_change", timestamp: new Date("2026-04-11T23:00:00Z").getTime() },
      config: {
        ...baseConfig,
        activeHoursStart: "09:00",
        activeHoursEnd: "18:00",
        timezone: "UTC",
      },
    });
    const result = computeGradedGate(ctx);
    // persona_change events are not gated by active hours
    expect(result.pNeed).toBeGreaterThan(0);
  });

  it("hard veto: suppression still enforced", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.7;
    persona.rapport.totalExchanges = 10;
    persona.feedbackProfile.lastProactiveAt = 0;
    persona.feedbackProfile.suppressUntil = Date.now() + 3600000;

    const ctx = makeGateContext({ persona });
    const result = computeGradedGate(ctx);
    expect(result.decision).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Suppressed")]),
    );
    expect(result.pNeed).toBe(0);
  });

  it("hard veto: min exchanges still enforced", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.7;
    persona.rapport.totalExchanges = 2;
    persona.feedbackProfile.lastProactiveAt = 0;

    const ctx = makeGateContext({ persona });
    const result = computeGradedGate(ctx);
    expect(result.decision).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("exchanges")]),
    );
    expect(result.pNeed).toBe(0);
  });

  it("hard vetoes set all probabilities to 0", () => {
    const persona = createDefaultPersona();
    persona.rapport.totalExchanges = 2;

    const ctx = makeGateContext({ persona });
    const result = computeGradedGate(ctx);
    expect(result.pNeed).toBe(0);
    expect(result.pAccept).toBe(0);
    expect(result.pAct).toBe(0);
    expect(result.decision).toBe(false);
  });
});

describe("computeRepetitionDecay", () => {
  it("returns 1 when no recent insight domains", () => {
    const persona = createDefaultPersona();
    expect(computeRepetitionDecay(persona)).toBe(1);
  });

  it("returns 1 when recent domains are diverse", () => {
    const persona = createDefaultPersona();
    persona.feedbackProfile.recentInsightDomains = [
      ["AI/ML"],
      ["Rust"],
      ["Design"],
      ["Security"],
      ["Cloud"],
    ];
    expect(computeRepetitionDecay(persona)).toBe(1);
  });

  it("decays when all recent insights target same domain", () => {
    const persona = createDefaultPersona();
    persona.feedbackProfile.recentInsightDomains = [
      ["编程语言"],
      ["编程语言"],
      ["编程语言"],
      ["编程语言"],
      ["编程语言"],
    ];
    const decay = computeRepetitionDecay(persona);
    expect(decay).toBeLessThan(1);
    expect(decay).toBe(0.125); // 0.5^(5-1) = 0.0625, clamped to 0.125
  });

  it("decays proportionally to domain repetition", () => {
    const persona = createDefaultPersona();
    persona.feedbackProfile.recentInsightDomains = [
      ["AI/ML", "Rust"],
      ["AI/ML", "Design"],
      ["AI/ML"],
    ];
    const decay = computeRepetitionDecay(persona);
    expect(decay).toBeLessThan(1);
    expect(decay).toBeGreaterThan(0);
  });

  it("pAct is reduced by repetition decay in graded gate", () => {
    const now = Date.now();
    const basePersona = () => {
      const p = createDefaultPersona();
      p.rapport.trustScore = 0.7;
      p.rapport.totalExchanges = 10;
      p.feedbackProfile.lastProactiveAt = 0;
      p.domains = { "AI": { depth: 5, recurrence: 10, lastMentioned: now, keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 } };
      return p;
    };

    const freshPersona = basePersona();
    const repeatedPersona = basePersona();
    repeatedPersona.feedbackProfile.recentInsightDomains = [["AI"], ["AI"], ["AI"], ["AI"]];

    const freshResult = computeGradedGate(makeGateContext({ persona: freshPersona, event: { type: "timer", timestamp: now } }));
    const repeatedResult = computeGradedGate(makeGateContext({ persona: repeatedPersona, event: { type: "timer", timestamp: now } }));

    expect(freshResult.pAct).toBeGreaterThan(repeatedResult.pAct);
  });
});
