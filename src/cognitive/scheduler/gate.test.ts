import { describe, it, expect } from "vitest";
import { createDefaultPersona } from "../persona/store.js";
import {
  checkProactiveGate,
  computeGradedGate,
  computeRepetitionDecay,
  computeEngagementFactor,
  computeTimeFactor,
} from "./gate.js";
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
    expect(result.reasons).toEqual(expect.arrayContaining([expect.stringContaining("Too soon")]));
  });

  it("blocks when suppressed", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.5;
    persona.rapport.totalExchanges = 10;
    persona.feedbackProfile.lastProactiveAt = 0;
    persona.feedbackProfile.suppressUntil = Date.now() + 3600000;
    const result = checkProactiveGate(persona, baseConfig);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([expect.stringContaining("Suppressed")]));
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
  persona.feedbackProfile.lastProactiveAt = now - 10 * 3600_000;
  persona.feedbackProfile.optimalFrequencyHours = 4;
  persona.lifecycle.stage = "active";
  persona.lifecycle.lastActiveAt = now - 3 * 3600_000;
  persona.lifecycle.totalActiveDays = 15;
  persona.domains = {
    "AI/ML": {
      depth: 5,
      recurrence: 10,
      lastMentioned: now,
      keyInsights: [],
      activeQuestions: [],
      negationSignals: 0,
    },
    Rust: {
      depth: 4,
      recurrence: 8,
      lastMentioned: now,
      keyInsights: [],
      activeQuestions: [],
      negationSignals: 0,
    },
    Design: {
      depth: 3,
      recurrence: 5,
      lastMentioned: now,
      keyInsights: [],
      activeQuestions: [],
      negationSignals: 0,
    },
  };
  persona.feedbackProfile.topicBandits = {
    "AI/ML": { alpha: 5, beta: 1 },
    Rust: { alpha: 4, beta: 2 },
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

  it("pAct uses geometric mean sqrt(pNeed*pAccept) to correct for positive correlation", () => {
    const ctx = makeGateContext();
    const result = computeGradedGate(ctx);

    expect(result.pAct).toBeCloseTo(Math.sqrt(result.pNeed * result.pAccept), 10);
  });

  // MIGRATED (goal 洞察投放人化重构): pNeed no longer depends on time since
  // last proactive — anti-double-send belongs to the scheduler's min-interval
  // cooldown, and waiting longer must not revive propensity (non-revival
  // invariant, see human-cadence.sim.test.ts).
  it("p_need is independent of time since last proactive (non-revival)", () => {
    const now = Date.now();
    const makePersonaWith = (lastProactiveOffsetMs: number) => {
      const p = createDefaultPersona();
      p.rapport.trustScore = 0.7;
      p.rapport.totalExchanges = 10;
      p.feedbackProfile.lastProactiveAt = now - lastProactiveOffsetMs;
      p.feedbackProfile.optimalFrequencyHours = 4;
      p.lifecycle.stage = "active";
      p.lifecycle.lastActiveAt = now - 2 * 3600_000;
      p.lifecycle.totalActiveDays = 10;
      p.domains = {
        AI: {
          depth: 5,
          recurrence: 10,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
      };
      return p;
    };

    const recentResult = computeGradedGate(
      makeGateContext({
        persona: makePersonaWith(1 * 3600_000),
        event: { type: "timer", timestamp: now },
      }),
    );
    const oldResult = computeGradedGate(
      makeGateContext({
        persona: makePersonaWith(24 * 3600_000),
        event: { type: "timer", timestamp: now },
      }),
    );

    expect(oldResult.pNeed).toBeCloseTo(recentResult.pNeed, 10);
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
      p.domains = {
        AI: {
          depth: 5,
          recurrence: 10,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
      };
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
      p.feedbackProfile.topicBandits = { AI: { alpha: 3, beta: 1 } };
      return p;
    };

    const lowTrust = makePersona(0.2);
    const highTrust = makePersona(0.9);

    const lowResult = computeGradedGate(
      makeGateContext({ persona: lowTrust, event: { type: "timer", timestamp: now } }),
    );
    const highResult = computeGradedGate(
      makeGateContext({ persona: highTrust, event: { type: "timer", timestamp: now } }),
    );

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

    const negativeBandits = makePersona({ AI: { alpha: 2, beta: 10 } });
    const positiveBandits = makePersona({ AI: { alpha: 10, beta: 1 } });

    const negResult = computeGradedGate(
      makeGateContext({ persona: negativeBandits, event: { type: "timer", timestamp: now } }),
    );
    const posResult = computeGradedGate(
      makeGateContext({ persona: positiveBandits, event: { type: "timer", timestamp: now } }),
    );

    expect(posResult.pAccept).toBeGreaterThan(negResult.pAccept);
  });

  it("higher C_FN lowers threshold, making it easier to trigger", () => {
    const now = Date.now();
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.7;
    persona.rapport.totalExchanges = 10;
    persona.feedbackProfile.lastProactiveAt = now - 10 * 3600_000;
    persona.feedbackProfile.optimalFrequencyHours = 4;
    persona.lifecycle.stage = "active";
    persona.lifecycle.lastActiveAt = now - 3 * 3600_000;
    persona.lifecycle.totalActiveDays = 15;
    persona.domains = {
      "AI/ML": {
        depth: 5,
        recurrence: 10,
        lastMentioned: now,
        keyInsights: [],
        activeQuestions: [],
        negationSignals: 0,
      },
    };
    persona.feedbackProfile.topicBandits = { "AI/ML": { alpha: 5, beta: 1 } };

    const ctx = makeGateContext({
      persona,
      config: { ...baseConfig, costFalseNegative: 10.0, costFalseAlarm: 1.0 },
    });
    const result = computeGradedGate(ctx);
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

  it("cross-day active hours: overnight range 22:00-07:00 allows late night", () => {
    const ctx = makeGateContext({
      event: { type: "timer", timestamp: new Date("2026-04-11T23:00:00Z").getTime() },
      config: {
        ...baseConfig,
        activeHoursStart: "22:00",
        activeHoursEnd: "07:00",
        timezone: "UTC",
      },
    });
    const result = computeGradedGate(ctx);
    expect(result.reasons).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Outside active hours")]),
    );
  });

  it("cross-day active hours: overnight range 22:00-07:00 blocks midday", () => {
    const ctx = makeGateContext({
      event: { type: "timer", timestamp: new Date("2026-04-11T12:00:00Z").getTime() },
      config: {
        ...baseConfig,
        activeHoursStart: "22:00",
        activeHoursEnd: "07:00",
        timezone: "UTC",
      },
    });
    const result = computeGradedGate(ctx);
    expect(result.decision).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Outside active hours")]),
    );
  });

  it("active hours check does NOT veto non-timer events", () => {
    const eventTime = new Date("2026-04-11T23:00:00Z").getTime();
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.7;
    persona.rapport.totalExchanges = 10;
    persona.feedbackProfile.lastProactiveAt = eventTime - 10 * 3600_000;
    persona.feedbackProfile.optimalFrequencyHours = 4;
    persona.lifecycle.stage = "active";
    persona.lifecycle.lastActiveAt = eventTime - 3 * 3600_000;
    persona.lifecycle.totalActiveDays = 15;
    persona.domains = {
      "AI/ML": {
        depth: 5,
        recurrence: 10,
        lastMentioned: eventTime,
        keyInsights: [],
        activeQuestions: [],
        negationSignals: 0,
      },
    };
    persona.feedbackProfile.topicBandits = { "AI/ML": { alpha: 5, beta: 1 } };

    const ctx = makeGateContext({
      persona,
      event: { type: "persona_change", timestamp: eventTime },
      config: {
        ...baseConfig,
        activeHoursStart: "09:00",
        activeHoursEnd: "18:00",
        timezone: "UTC",
      },
    });
    const result = computeGradedGate(ctx);
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
    expect(result.reasons).toEqual(expect.arrayContaining([expect.stringContaining("Suppressed")]));
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
    expect(result.reasons).toEqual(expect.arrayContaining([expect.stringContaining("exchanges")]));
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
    domains?: Record<
      string,
      {
        depth: number;
        recurrence: number;
        lastMentioned: number;
        keyInsights: string[];
        activeQuestions: string[];
        negationSignals: number;
      }
    >;
  }) {
    const persona = createDefaultPersona();
    persona.lifecycle.stage = overrides?.stage ?? "active";
    persona.lifecycle.lastActiveAt = overrides?.lastActiveAt ?? Date.now();
    persona.lifecycle.totalActiveDays = overrides?.totalActiveDays ?? 10;
    persona.rapport.totalExchanges = 20;
    if (overrides?.domains) {
      persona.domains = overrides.domains;
    }
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
        AI: {
          depth: 5,
          recurrence: 10,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
        Rust: {
          depth: 4,
          recurrence: 8,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
        Design: {
          depth: 3,
          recurrence: 5,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
        Cloud: {
          depth: 3,
          recurrence: 4,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
        DevOps: {
          depth: 2,
          recurrence: 3,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
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
        AI: {
          depth: 3,
          recurrence: 1,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
      },
    });

    const broad = makePersona({
      stage: "active",
      lastActiveAt: now,
      totalActiveDays: 10,
      domains: {
        AI: {
          depth: 3,
          recurrence: 3,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
        Rust: {
          depth: 3,
          recurrence: 4,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
        Design: {
          depth: 3,
          recurrence: 5,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
        Cloud: {
          depth: 3,
          recurrence: 6,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
        DevOps: {
          depth: 3,
          recurrence: 7,
          lastMentioned: now,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
      },
    });

    expect(computeEngagementFactor(broad, now)).toBeGreaterThan(
      computeEngagementFactor(narrow, now),
    );
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

  // MIGRATED (goal 洞察投放人化重构): inverted — dormant users must have
  // LOWER pNeed (lifecycleFactor 1.5, no re-engage multiplier). The old test
  // asserted dormant > active, which produced 3×/day bombardment of silent
  // users (sim evidence: .goal/evidence/round1-red-old-code.txt).
  it("dormant users get reduced p_need vs active users", () => {
    const now = Date.now();
    const basePersona = () => {
      const p = createDefaultPersona();
      p.rapport.trustScore = 0.7;
      p.rapport.totalExchanges = 20;
      p.feedbackProfile.lastProactiveAt = now - 10 * 3600_000;
      p.feedbackProfile.optimalFrequencyHours = 4;
      p.lifecycle.lastActiveAt = now - 2 * 3600_000;
      p.lifecycle.totalActiveDays = 15;
      p.domains = {
        AI: {
          depth: 3,
          recurrence: 5,
          lastMentioned: now - 2 * 3600_000,
          keyInsights: [],
          activeQuestions: [],
          negationSignals: 0,
        },
      };
      return p;
    };

    const dormantPersona = basePersona();
    dormantPersona.lifecycle.stage = "dormant";
    const activePersona = basePersona();
    activePersona.lifecycle.stage = "active";

    const dormantResult = computeGradedGate({
      persona: dormantPersona,
      event: { type: "timer", timestamp: now },
      recentInsightCount: 0,
      config: baseConfig,
    });
    const activeResult = computeGradedGate({
      persona: activePersona,
      event: { type: "timer", timestamp: now },
      recentInsightCount: 0,
      config: baseConfig,
    });

    expect(dormantResult.pNeed).toBeLessThan(activeResult.pNeed);
  });

  // NEW (goal 洞察投放人化重构): social ledger hard veto.
  it("ledger veto: U >= 3 hard-vetoes for trusted users", () => {
    const ctx = makeGateContext();
    ctx.persona.feedbackProfile.consecutiveNoResponses = 3;
    ctx.persona.rapport.trustScore = 0.8;
    const result = computeGradedGate(ctx);
    expect(result.decision).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([expect.stringContaining("Ledger")]));
  });

  it("ledger veto: low-trust users get tighter cap of 2", () => {
    const ctx = makeGateContext();
    ctx.persona.rapport.trustScore = 0.6;
    ctx.persona.feedbackProfile.consecutiveNoResponses = 2;
    const result = computeGradedGate(ctx);
    expect(result.decision).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([expect.stringContaining("cap 2")]));
  });

  it("ledger below cap does not veto", () => {
    const ctx = makeGateContext();
    ctx.persona.rapport.trustScore = 0.8;
    ctx.persona.feedbackProfile.consecutiveNoResponses = 2;
    const result = computeGradedGate(ctx);
    expect(result.reasons).not.toEqual(expect.arrayContaining([expect.stringContaining("Ledger")]));
  });
});

// ── Time factor (social-decay: momentum × ledger) tests ──────────────

describe("computeTimeFactor", () => {
  const HR = 3600_000;

  function makeTimePersona(overrides?: {
    lastActiveAt?: number;
    lastProactiveAt?: number;
    optimalFrequencyHours?: number;
    consecutiveNoResponses?: number;
  }) {
    const persona = createDefaultPersona();
    persona.lifecycle.lastActiveAt = overrides?.lastActiveAt ?? Date.now();
    persona.feedbackProfile.lastProactiveAt = overrides?.lastProactiveAt ?? 0;
    persona.feedbackProfile.optimalFrequencyHours = overrides?.optimalFrequencyHours ?? 4;
    persona.feedbackProfile.consecutiveNoResponses = overrides?.consecutiveNoResponses ?? 0;
    return persona;
  }

  // MIGRATED (goal 洞察投放人化重构): the entire block below replaces the
  // cadence-gaussian/recovery/linear-backoff/compensatory semantics with
  // momentum × ledger-decay semantics. Migration reasons per test are noted
  // inline; the behavioral contract is enforced end-to-end by
  // human-cadence.sim.test.ts.

  it("momentum is highest right after user activity and decays with silence", () => {
    const now = Date.now();
    const at = (offsetH: number) =>
      computeTimeFactor(
        makeTimePersona({ lastActiveAt: now - offsetH * HR, lastProactiveAt: 0 }),
        baseConfig,
        now,
      );

    const fresh = at(0.25);
    const two = at(2);
    const atDay = at(24);
    const beyondDay = at(25);

    expect(fresh).toBeCloseTo(1.0, 5);
    expect(two).toBeCloseTo((1.0 / 1.3) * 1.0, 5);
    expect(atDay).toBeCloseTo(0.85 / 1.3, 5);
    expect(beyondDay).toBe(0);
    expect(fresh).toBeGreaterThan(two);
    expect(two).toBeGreaterThan(atDay);
  });

  // MIGRATED: "is near zero right after sending" + "recovers over time" —
  // anti-double-send moved to the scheduler min-interval cooldown.
  it("factor is independent of time since last proactive (non-revival)", () => {
    const now = Date.now();
    const recent = makeTimePersona({ lastActiveAt: now - 2 * HR, lastProactiveAt: now - 1000 });
    const old = makeTimePersona({ lastActiveAt: now - 2 * HR, lastProactiveAt: now - 48 * HR });

    expect(computeTimeFactor(recent, baseConfig, now)).toBeCloseTo(
      computeTimeFactor(old, baseConfig, now),
      10,
    );
  });

  // MIGRATED: linear 0.03-slope floored at 0.7 was too weak to change
  // behavior — replaced by geometric ledger decay {1.0, 0.45, 0.12}.
  it("ledger decay is geometric: g(1)=0.45, g(2+)=0.12", () => {
    const now = Date.now();
    const at = (unanswered: number) =>
      computeTimeFactor(
        makeTimePersona({ lastActiveAt: now - 2 * HR, consecutiveNoResponses: unanswered }),
        baseConfig,
        now,
      );

    expect(at(0)).toBeGreaterThan(0);
    expect(at(1)).toBeCloseTo(at(0) * 0.45, 5);
    expect(at(2)).toBeCloseTo(at(0) * 0.12, 5);
    expect(at(5)).toBeCloseTo(at(2), 10);
    expect(at(20)).toBeCloseTo(at(2), 10);
  });

  // MIGRATED: "compensatory signal grows with silence" inverted — growing
  // silence must never RAISE propensity (non-revival invariant).
  it("longer mutual silence never increases the factor", () => {
    const now = Date.now();
    const recent = makeTimePersona({
      lastActiveAt: now - 10 * 24 * HR,
      lastProactiveAt: now - 2 * HR,
      consecutiveNoResponses: 3,
    });
    const longSilence = makeTimePersona({
      lastActiveAt: now - 10 * 24 * HR,
      lastProactiveAt: now - 10 * 24 * HR,
      consecutiveNoResponses: 3,
    });

    expect(computeTimeFactor(longSilence, baseConfig, now)).toBeLessThanOrEqual(
      computeTimeFactor(recent, baseConfig, now),
    );
    expect(computeTimeFactor(longSilence, baseConfig, now)).toBe(0);
  });

  // MIGRATED: "silence breaker" / "long-silence correction" floors removed —
  // users silent >24h are served only by the re-engagement budget, never by
  // the cadence path.
  it("user silent beyond 24h closes the normal cadence path (factor 0)", () => {
    const now = Date.now();
    const persona = makeTimePersona({
      lastActiveAt: now - 60 * 24 * HR,
      lastProactiveAt: now - 60 * 24 * HR,
      consecutiveNoResponses: 0,
    });
    expect(computeTimeFactor(persona, baseConfig, now)).toBe(0);
  });

  it("never-active user has zero momentum", () => {
    const now = Date.now();
    const persona = makeTimePersona({ lastActiveAt: 0, lastProactiveAt: 0 });
    expect(computeTimeFactor(persona, baseConfig, now)).toBe(0);
  });
});
