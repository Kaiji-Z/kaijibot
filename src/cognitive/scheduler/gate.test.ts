import { describe, it, expect } from "vitest";
import { checkProactiveGate, computeGradedGate, computeRepetitionDecay, computeEngagementFactor } from "./gate.js";
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
  const now = Date.now();
  const persona = createDefaultPersona();
  persona.rapport.trustScore = 0.7;
  persona.rapport.totalExchanges = 10;
  persona.feedbackProfile.lastProactiveAt = 0;
  persona.lifecycle.stage = "active";
  persona.lifecycle.lastActiveAt = now;
  persona.lifecycle.totalActiveDays = 15;
  persona.domains = {
    "AI/ML": { depth: 5, recurrence: 10, lastMentioned: now,         keyInsights: [], activeQuestions: [], negationSignals: 0 },
    "Rust": { depth: 4, recurrence: 8, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
    "Design": { depth: 3, recurrence: 5, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
  };
  persona.feedbackProfile.topicBandits = {
    "AI/ML": { alpha: 5, beta: 1 },
    "Rust": { alpha: 4, beta: 2 },
  };

  return {
    persona,
    event: { type: "persona_change", timestamp: now },
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
        p.lifecycle.stage = "active";
        p.lifecycle.lastActiveAt = now;
        p.lifecycle.totalActiveDays = 10;
        p.domains = { "AI": { depth: 5, recurrence: 10, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 } };
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
        p.lifecycle.stage = "active";
        p.lifecycle.lastActiveAt = now;
        p.lifecycle.totalActiveDays = 10;
        p.domains = { "AI": { depth: 5, recurrence: 10, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 } };
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
      p.lifecycle.stage = "active";
      p.lifecycle.lastActiveAt = now;
      p.lifecycle.totalActiveDays = 10;
      p.domains = { "AI": { depth: 5, recurrence: 10, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 } };
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
    const now = Date.now();
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.7;
    persona.rapport.totalExchanges = 10;
    persona.feedbackProfile.lastProactiveAt = 0;
    persona.lifecycle.stage = "active";
    persona.lifecycle.lastActiveAt = now;
    persona.lifecycle.totalActiveDays = 15;
    persona.domains = {
      "AI/ML": { depth: 5, recurrence: 10, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
    };
    persona.feedbackProfile.topicBandits = { "AI/ML": { alpha: 5, beta: 1 } };

    const ctx = makeGateContext({
      persona,
      config: { ...baseConfig, costFalseNegative: 10.0, costFalseAlarm: 1.0 },
    });
    const result = computeGradedGate(ctx);
    // threshold = 1/(10+1) ≈ 0.091
    // With engaged user, should trigger easily
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

  it("default config triggers for engaged user with persona_change event", () => {
    const ctx = makeGateContext({
      config: { ...baseConfig },
    });
    const result = computeGradedGate(ctx);
    // Default threshold = C_FA/(C_FN+C_FA) = 1/(5+1) ≈ 0.167
    // With active user, good domains, persona_change event → should trigger
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
  it("returns 1 when only one recent insight", () => {
    const persona = createDefaultPersona();
    persona.feedbackProfile.recentInsightDomains = [["AI/ML"]];
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

  it("does not penalize a single broad insight overlapping with narrow ones", () => {
    const persona = createDefaultPersona();
    persona.feedbackProfile.recentInsightDomains = [
      ["哲学"],
      ["AI工具链"],
      ["产品"],
      ["机器学习"],
      ["认知架构", "产品", "软件架构", "机器学习", "云", "编程", "哲学", "创业"],
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
    expect(decay).toBeGreaterThanOrEqual(0.25);
  });

  it("decays when most insights share overlapping domains", () => {
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

});

// ── Engagement factor tests ──────────────────────────────────────────

describe("computeEngagementFactor", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function makePersona(overrides?: {
    stage?: "new" | "active" | "dormant" | "lapsed";
    lastActiveAt?: number;
    totalActiveDays?: number;
    domains?: Record<string, { depth: number; recurrence: number; lastMentioned: number; keyInsights: string[]; activeQuestions: string[]; negationSignals: number }>;
  }) {
    const persona = createDefaultPersona();
    persona.lifecycle.stage = overrides?.stage ?? "active";
    persona.lifecycle.lastActiveAt = overrides?.lastActiveAt ?? Date.now();
    persona.lifecycle.totalActiveDays = overrides?.totalActiveDays ?? 10;
    persona.rapport.totalExchanges = 20;
    if (overrides?.domains) persona.domains = overrides.domains;
    return persona;
  }

  it("floors at 0.08 — never zero", () => {
    const persona = makePersona({
      stage: "active",
      lastActiveAt: Date.now() - 365 * DAY_MS,
      totalActiveDays: 0,
      domains: {},
    });
    const factor = computeEngagementFactor(persona, Date.now());
    expect(factor).toBeGreaterThanOrEqual(0.08);
  });

  it("new users get reduced recency (0.3)", () => {
    const persona = makePersona({ stage: "new", totalActiveDays: 0 });
    const now = Date.now();
    persona.lifecycle.lastActiveAt = now;
    const factor = computeEngagementFactor(persona, now);
    expect(factor).toBeLessThan(0.3);
  });

  it("peaks at 7-14 day silence window", () => {
    const now = Date.now();
    const persona = makePersona({
      stage: "active",
      lastActiveAt: now - 10 * DAY_MS,
      totalActiveDays: 30,
      domains: {
        "AI": { depth: 5, recurrence: 10, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
        "Rust": { depth: 4, recurrence: 8, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
        "Design": { depth: 3, recurrence: 5, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
        "Cloud": { depth: 3, recurrence: 4, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
        "DevOps": { depth: 2, recurrence: 3, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
      },
    });

    const factorAt10d = computeEngagementFactor(persona, now);

    const persona3d = makePersona({
      stage: "active",
      lastActiveAt: now - 3 * DAY_MS,
      totalActiveDays: 30,
      domains: persona.domains,
    });
    const factorAt3d = computeEngagementFactor(persona3d, now);

    const persona30d = makePersona({
      stage: "dormant",
      lastActiveAt: now - 30 * DAY_MS,
      totalActiveDays: 30,
      domains: persona.domains,
    });
    const factorAt30d = computeEngagementFactor(persona30d, now);

    expect(factorAt10d).toBeGreaterThan(factorAt3d);
    expect(factorAt10d).toBeGreaterThan(factorAt30d);
  });

  it("investment only grows, never decays", () => {
    const now = Date.now();
    const base = { stage: "active" as const, lastActiveAt: now, domains: {} };

    const lowInvestment = makePersona({ ...base, totalActiveDays: 1 });
    const highInvestment = makePersona({ ...base, totalActiveDays: 100 });

    const factorLow = computeEngagementFactor(lowInvestment, now);
    const factorHigh = computeEngagementFactor(highInvestment, now);

    expect(factorHigh).toBeGreaterThan(factorLow);
  });

  it("more broad domains increases factor", () => {
    const now = Date.now();
    const narrow = makePersona({
      stage: "active",
      lastActiveAt: now,
      totalActiveDays: 10,
      domains: {
        "AI": { depth: 3, recurrence: 1, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
      },
    });

    const broad = makePersona({
      stage: "active",
      lastActiveAt: now,
      totalActiveDays: 10,
      domains: {
        "AI": { depth: 3, recurrence: 3, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
        "Rust": { depth: 3, recurrence: 4, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
        "Design": { depth: 3, recurrence: 5, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
        "Cloud": { depth: 3, recurrence: 6, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
        "DevOps": { depth: 3, recurrence: 7, lastMentioned: now, keyInsights: [], activeQuestions: [], negationSignals: 0 },
      },
    });

    expect(computeEngagementFactor(broad, now)).toBeGreaterThan(computeEngagementFactor(narrow, now));
  });

  it("no death spiral: cold user with zero domains still gets floor value", () => {
    const now = Date.now();
    const persona = makePersona({
      stage: "lapsed",
      lastActiveAt: now - 200 * DAY_MS,
      totalActiveDays: 0,
      domains: {},
    });
    const factor = computeEngagementFactor(persona, now);
    expect(factor).toBeGreaterThanOrEqual(0.08);
  });

  it("dormant users get re-engagement boost in pNeed via shouldReEngage", () => {
    const now = Date.now();
    const dormantPersona = createDefaultPersona();
    dormantPersona.rapport.trustScore = 0.7;
    dormantPersona.rapport.totalExchanges = 20;
    dormantPersona.feedbackProfile.lastProactiveAt = 0;
    dormantPersona.lifecycle.stage = "dormant";
    dormantPersona.lifecycle.lastActiveAt = now - 10 * DAY_MS;
    dormantPersona.lifecycle.totalActiveDays = 15;
    dormantPersona.domains = {
      "AI": { depth: 3, recurrence: 5, lastMentioned: now - 10 * DAY_MS, keyInsights: [], activeQuestions: [], negationSignals: 0 },
    };

    const activePersona = createDefaultPersona();
    activePersona.rapport.trustScore = 0.7;
    activePersona.rapport.totalExchanges = 20;
    activePersona.feedbackProfile.lastProactiveAt = 0;
    activePersona.lifecycle.stage = "active";
    activePersona.lifecycle.lastActiveAt = now - 10 * DAY_MS;
    activePersona.lifecycle.totalActiveDays = 15;
    activePersona.domains = {
      "AI": { depth: 3, recurrence: 5, lastMentioned: now - 10 * DAY_MS, keyInsights: [], activeQuestions: [], negationSignals: 0 },
    };

    const dormantCtx: GateContext = {
      persona: dormantPersona,
      event: { type: "timer", timestamp: now },
      recentInsightCount: 0,
      config: baseConfig,
    };
    const activeCtx: GateContext = {
      persona: activePersona,
      event: { type: "timer", timestamp: now },
      recentInsightCount: 0,
      config: baseConfig,
    };

    const dormantResult = computeGradedGate(dormantCtx);
    const activeResult = computeGradedGate(activeCtx);

    expect(dormantResult.pNeed).toBeGreaterThan(activeResult.pNeed);
  });
});
