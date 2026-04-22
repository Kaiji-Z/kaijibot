import { describe, it, expect, vi } from "vitest";
import { ProactiveScheduler, filterBlacklistedOpportunities } from "./proactive-scheduler.js";
import { createDefaultPersona } from "../persona/store.js";
import type { SchedulerConfig, Opportunity } from "./types.js";
import type { PersonaTree } from "../types.js";
import type { InsightCandidate } from "../insight/types.js";

function personaWithDomains(): PersonaTree {
  const persona = createDefaultPersona();
  persona.rapport.trustScore = 0.7;
  persona.rapport.totalExchanges = 10;
  persona.domains = {
    "AI/机器学习": {
      depth: 5,
      recurrence: 10,
      lastMentioned: Date.now(),
      keyInsights: ["Transformer架构"],
      activeQuestions: [],
      connections: [],
      negationSignals: 0,
    },
    "Rust": {
      depth: 4,
      recurrence: 8,
      lastMentioned: Date.now(),
      keyInsights: [],
      activeQuestions: [],
      connections: [],
      negationSignals: 0,
    },
    "Design": {
      depth: 3,
      recurrence: 5,
      lastMentioned: Date.now(),
      keyInsights: [],
      activeQuestions: [],
      connections: [],
      negationSignals: 0,
    },
  };
  persona.feedbackProfile.topicBandits = {
    "AI/机器学习": { alpha: 5, beta: 1 },
    "Rust": { alpha: 4, beta: 2 },
  };
  persona.lifecycle = { ...persona.lifecycle, stage: "active", lastActiveAt: Date.now() };
  return persona;
}

function personaWithPendingQuestions(): PersonaTree {
  const persona = personaWithDomains();
  persona.pendingQuestions = ["如何优化Transformer注意力机制？", "Rust异步运行时选哪个？"];
  return persona;
}

const config: SchedulerConfig = {
  minIntervalHours: 4,
  minTrustScore: 0.3,
};

const highThresholdConfig: SchedulerConfig = {
  minIntervalHours: 4,
  minTrustScore: 0.3,
  costFalseNegative: 0.01,
  costFalseAlarm: 100,
};

function makeScheduler(
  schedulerConfig: SchedulerConfig = config,
  persona?: PersonaTree,
  overrides?: {
    insightGenerator?: (persona: PersonaTree) => Promise<InsightCandidate[]>;
  },
): ProactiveScheduler {
  return new ProactiveScheduler(
    schedulerConfig,
    {
      loadPersona: async () => persona ?? personaWithDomains(),
      onInsightReady: async () => {},
      savePersona: async () => {},
    },
    {
      insightGenerator: overrides?.insightGenerator
        ? (_p, _input, _opts) => overrides.insightGenerator!(_p)
        : undefined,
    },
  );
}

describe("ProactiveScheduler", () => {
  it("returns undefined when persona not found", async () => {
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => undefined,
      onInsightReady: async () => {},
      savePersona: async () => {},
    });

    const result = await scheduler.processEvent("user1", {
      type: "timer",
      timestamp: Date.now(),
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when gate blocks", async () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.1;

    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => persona,
      onInsightReady: async () => {},
      savePersona: async () => {},
    });

    const result = await scheduler.processEvent("user1", {
      type: "timer",
      timestamp: Date.now(),
    });
    expect(result).toBeUndefined();
  });

  it("generates insight when all gates pass", async () => {
    const persona = personaWithDomains();
    let savedPersona: PersonaTree | undefined;

    const capturedCandidates: InsightCandidate[] = [];
    const fakeInsight: InsightCandidate = {
      id: "test-id",
      content: "Test insight",
      rationale: "test",
      targetDomains: ["AI/机器学习"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
      verificationStatus: "unverified",
    };
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => persona,
      onInsightReady: async (_userId, candidate) => {
        capturedCandidates.push(candidate);
      },
      savePersona: async (_userId, p) => {
        savedPersona = p;
      },
    }, { insightGenerator: async () => [fakeInsight] });

    const now = Date.now();
    const result = await scheduler.processEvent("user1", {
      type: "timer",
      timestamp: now,
    });

    expect(result).toBeDefined();
    expect(capturedCandidates.length).toBe(1);
    expect(savedPersona?.feedbackProfile.lastProactiveAt).toBe(now);
  });

  it("start and stop do not throw", () => {
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => personaWithDomains(),
      onInsightReady: async () => {},
      savePersona: async () => {},
    });

    expect(() => scheduler.start(async () => ["user1"], 60000)).not.toThrow();
    expect(() => scheduler.stop()).not.toThrow();
  });

  it("stop is idempotent", () => {
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => undefined,
      onInsightReady: async () => {},
      savePersona: async () => {},
    });

    scheduler.stop();
    scheduler.stop();
  });

  it("start iterates all discovered users on tick", async () => {
    const processedUsers: string[] = [];
    let allProcessed: () => void;
    const allProcessedPromise = new Promise<void>((resolve) => {
      allProcessed = resolve;
    });
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async (userId) => {
        processedUsers.push(userId);
        if (processedUsers.length >= 3) allProcessed!();
        return personaWithDomains();
      },
      onInsightReady: async () => {},
      savePersona: async () => {},
    });

    const userIds = ["user-a", "user-b", "user-c"];
    scheduler.start(async () => userIds, 10);

    await Promise.race([allProcessedPromise, new Promise((resolve) => setTimeout(resolve, 500))]);
    scheduler.stop();
    expect(processedUsers.sort()).toEqual(["user-a", "user-b", "user-c"].sort());
  });

  it("start isolates errors per user", async () => {
    const processedUsers: string[] = [];
    let goodProcessed: () => void;
    const goodProcessedPromise = new Promise<void>((resolve) => {
      goodProcessed = resolve;
    });
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async (userId) => {
        if (userId === "bad-user") throw new Error("load failed");
        processedUsers.push(userId);
        goodProcessed!();
        return personaWithDomains();
      },
      onInsightReady: async () => {},
      savePersona: async () => {},
    });

    const userIds = ["bad-user", "good-user"];
    scheduler.start(async () => userIds, 10);

    await Promise.race([goodProcessedPromise, new Promise((resolve) => setTimeout(resolve, 500))]);
    scheduler.stop();
    expect(processedUsers).toEqual(["good-user"]);
  });

  it("start handles empty user list gracefully", async () => {
    const processedUsers: string[] = [];
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async (userId) => {
        processedUsers.push(userId);
        return personaWithDomains();
      },
      onInsightReady: async () => {},
      savePersona: async () => {},
    });

    scheduler.start(async () => [], 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    scheduler.stop();
    expect(processedUsers).toEqual([]);
  });

  it("generates cross-domain insight on persona_change event", async () => {
    const persona = personaWithDomains();
    const capturedCandidates: InsightCandidate[] = [];
    const fakeInsight: InsightCandidate = {
      id: "test-id",
      content: "Test insight",
      rationale: "test",
      targetDomains: ["区块链"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
      verificationStatus: "unverified",
    };
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => persona,
      onInsightReady: async (_userId, candidate) => {
        capturedCandidates.push(candidate);
      },
      savePersona: async () => {},
    }, { insightGenerator: async () => [fakeInsight] });

    const result = await scheduler.processEvent("user1", {
      type: "persona_change",
      timestamp: Date.now(),
      payload: { newDomains: ["区块链"], domainCount: 3 },
    });

    expect(result).toBeDefined();
    expect(capturedCandidates.length).toBeGreaterThanOrEqual(1);
  });

  it("generates insight on info_scan event", async () => {
    const persona = personaWithDomains();
    const capturedCandidates: InsightCandidate[] = [];
    const fakeInsight: InsightCandidate = {
      id: "test-id",
      content: "Test insight",
      rationale: "test",
      targetDomains: ["AI/机器学习"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
      verificationStatus: "unverified",
    };
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => persona,
      onInsightReady: async (_userId, candidate) => {
        capturedCandidates.push(candidate);
      },
      savePersona: async () => {},
    }, { insightGenerator: async () => [fakeInsight] });

    const result = await scheduler.processEvent("user1", {
      type: "info_scan",
      timestamp: Date.now(),
      payload: { scanIntervalMs: 3600_000 },
    });

    expect(result).toBeDefined();
    expect(capturedCandidates.length).toBe(1);
  });

  it("handles all event types without timer interval dependency", async () => {
    const persona = personaWithDomains();
    const eventTypes: Array<"timer" | "persona_change" | "info_scan"> = ["timer", "persona_change", "info_scan"];
    const results: Array<InsightCandidate | undefined> = [];

    const fakeInsight: InsightCandidate = {
      id: "test-id",
      content: "Test insight",
      rationale: "test",
      targetDomains: ["AI/机器学习"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
      verificationStatus: "unverified",
    };
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => JSON.parse(JSON.stringify(persona)) as PersonaTree,
      onInsightReady: async () => {},
      savePersona: async () => {},
    }, { insightGenerator: async () => [fakeInsight] });

    for (const type of eventTypes) {
      const result = await scheduler.processEvent("user1", {
        type,
        timestamp: Date.now(),
      });
      results.push(result);
    }

    for (const type of eventTypes) {
      expect(results[eventTypes.indexOf(type)]).toBeDefined();
    }
  });
});

describe("ProactiveScheduler.search", () => {
  it("returns multiple Opportunity objects for timer event", () => {
    const persona = personaWithPendingQuestions();
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: Date.now(),
    });

    expect(opportunities.length).toBeGreaterThanOrEqual(2);
    const types = new Set(opportunities.map((o) => o.type));
    expect(types.has("cross_domain")).toBe(true);
    expect(types.has("domain_depth")).toBe(true);
  });

  it("returns all strategies for external event", () => {
    const persona = personaWithPendingQuestions();
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "external",
      timestamp: Date.now(),
    });

    expect(opportunities.length).toBeGreaterThanOrEqual(2);
    const types = new Set(opportunities.map((o) => o.type));
    expect(types.has("cross_domain")).toBe(true);
    expect(types.has("domain_depth")).toBe(true);
  });

  it("returns persona-change-focused opportunities for persona_change event", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "persona_change",
      timestamp: Date.now(),
      payload: { newDomains: ["区块链"], domainCount: 4 },
    });

    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    for (const opp of opportunities) {
      expect(opp.pNeed).toBeGreaterThan(0);
      expect(opp.pAccept).toBeGreaterThan(0);
      expect(opp.pAct).toBeGreaterThan(0);
    }
    const hasNewDomainOpportunity = opportunities.some(
      (o) => o.metadata?.isNewDomain === true,
    );
    expect(hasNewDomainOpportunity).toBe(true);
  });

  it("returns info_scan_hit opportunities for info_scan event", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "info_scan",
      timestamp: Date.now(),
      payload: { scanIntervalMs: 3600_000 },
    });

    const scanHits = opportunities.filter((o) => o.type === "info_scan_hit");
    expect(scanHits.length).toBeGreaterThan(0);
    for (const hit of scanHits) {
      expect(hit.metadata?.scanDerived).toBe(true);
    }
  });

  it("returns empty array for persona with no domains", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.7;
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: Date.now(),
    });

    expect(opportunities).toEqual([]);
  });

  it("different event types produce different opportunity sets", () => {
    const persona = personaWithPendingQuestions();
    const scheduler = makeScheduler(config, persona);

    const timerOpps = scheduler.search(persona, { type: "timer", timestamp: Date.now() });
    const personaChangeOpps = scheduler.search(persona, {
      type: "persona_change",
      timestamp: Date.now(),
      payload: { newDomains: ["区块链"] },
    });
    const infoScanOpps = scheduler.search(persona, {
      type: "info_scan",
      timestamp: Date.now(),
    });

    const timerTypes = timerOpps.map((o) => o.type);
    const personaChangeTypes = personaChangeOpps.map((o) => o.type);
    const infoScanTypes = infoScanOpps.map((o) => o.type);

    expect(timerTypes).toContain("cross_domain");
    expect(personaChangeTypes).not.toContain("info_scan_hit");
    expect(infoScanTypes).toContain("info_scan_hit");
    expect(timerTypes).not.toContain("info_scan_hit");
  });
});

describe("ProactiveScheduler.identify", () => {
  it("ranks by pAct and returns top opportunity", () => {
    const scheduler = makeScheduler(config);
    const opportunities: Opportunity[] = [
      { type: "cross_domain", targetDomains: ["A"], sourceDomains: ["B"], pNeed: 0.5, pAccept: 0.5, pAct: 0.25 },
      { type: "domain_depth", targetDomains: ["A"], sourceDomains: [], pNeed: 0.9, pAccept: 0.9, pAct: 0.81 },
      { type: "exploration", targetDomains: ["C"], sourceDomains: [], pNeed: 0.7, pAccept: 0.8, pAct: 0.56 },
    ];

    const selected = scheduler.identify(opportunities);
    expect(selected).not.toBeNull();
    expect(selected!.type).toBe("domain_depth");
    expect(selected!.pAct).toBe(0.81);
  });

  it("returns null when all pAct below threshold", () => {
    const scheduler = makeScheduler(highThresholdConfig);
    const opportunities: Opportunity[] = [
      { type: "cross_domain", targetDomains: ["A"], sourceDomains: ["B"], pNeed: 0.1, pAccept: 0.1, pAct: 0.01 },
      { type: "domain_depth", targetDomains: ["C"], sourceDomains: [], pNeed: 0.2, pAccept: 0.2, pAct: 0.04 },
    ];

    const selected = scheduler.identify(opportunities);
    expect(selected).toBeNull();
  });

  it("returns null for empty opportunities", () => {
    const scheduler = makeScheduler(config);
    expect(scheduler.identify([])).toBeNull();
  });

  it("returns single opportunity when above threshold", () => {
    const scheduler = makeScheduler(config);
    const opportunities: Opportunity[] = [
      { type: "cross_domain", targetDomains: ["A"], sourceDomains: ["B"], pNeed: 0.8, pAccept: 0.8, pAct: 0.64 },
    ];

    const selected = scheduler.identify(opportunities);
    expect(selected).not.toBeNull();
    expect(selected!.pAct).toBe(0.64);
  });
});

describe("ProactiveScheduler.resolve", () => {
  it("generates insight for selected opportunity", async () => {
    const persona = personaWithDomains();
    const fakeInsight: InsightCandidate = {
      id: "test-id",
      content: "Test insight",
      rationale: "Test",
      targetDomains: ["AI/机器学习"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
      verificationStatus: "unverified",
    };

    const scheduler = makeScheduler(config, persona, {
      insightGenerator: async () => [fakeInsight],
    });

    const opportunity: Opportunity = {
      type: "cross_domain",
      targetDomains: ["AI/机器学习"],
      sourceDomains: ["Rust"],
      pNeed: 0.8,
      pAccept: 0.7,
      pAct: 0.56,
    };

    const result = await scheduler.resolve(persona, opportunity);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("test-id");
  });

  it("returns null when insight generator produces no candidates", async () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona, {
      insightGenerator: async () => [],
    });

    const opportunity: Opportunity = {
      type: "domain_depth",
      targetDomains: ["AI/机器学习"],
      sourceDomains: [],
      pNeed: 0.8,
      pAccept: 0.7,
      pAct: 0.56,
    };

    const result = await scheduler.resolve(persona, opportunity);
    expect(result).toBeNull();
  });

  it("returns null for unverified insight (no sources)", async () => {
    const persona = personaWithDomains();
    const fakeInsight: InsightCandidate = {
      id: "unverified-id",
      content: "Unverified insight",
      rationale: "test",
      targetDomains: ["AI/机器学习"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [],
      verificationStatus: "unverified",
    };

    const scheduler = makeScheduler(config, persona, {
      insightGenerator: async () => [fakeInsight],
    });

    const opportunity: Opportunity = {
      type: "cross_domain",
      targetDomains: ["AI/机器学习"],
      sourceDomains: ["Rust"],
      pNeed: 0.8,
      pAccept: 0.7,
      pAct: 0.56,
    };

    const result = await scheduler.resolve(persona, opportunity);
    expect(result).toBeNull();
  });

  it("returns candidate with partial verification", async () => {
    const persona = personaWithDomains();
    const fakeInsight: InsightCandidate = {
      id: "partial-id",
      content: "Partially verified insight",
      rationale: "test",
      targetDomains: ["AI/机器学习"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
      verificationStatus: "unverified",
    };

    const scheduler = makeScheduler(config, persona, {
      insightGenerator: async () => [fakeInsight],
    });

    const opportunity: Opportunity = {
      type: "cross_domain",
      targetDomains: ["AI/机器学习"],
      sourceDomains: ["Rust"],
      pNeed: 0.8,
      pAccept: 0.7,
      pAct: 0.56,
    };

    const result = await scheduler.resolve(persona, opportunity);
    expect(result).not.toBeNull();
    expect(result!.verificationStatus).toBe("partial");
  });
});

describe("ProactiveScheduler pipeline integration", () => {
  it("pipeline degrades gracefully: search empty → no identify → no resolve", async () => {
    const emptyPersona = createDefaultPersona();
    emptyPersona.rapport.trustScore = 0.7;
    emptyPersona.rapport.totalExchanges = 10;

    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => emptyPersona,
      onInsightReady: async () => {},
      savePersona: async () => {},
    });

    const result = await scheduler.processEvent("user1", {
      type: "timer",
      timestamp: Date.now(),
    });

    expect(result).toBeUndefined();
  });

  it("pipeline degrades gracefully: identify returns null", async () => {
    const persona = personaWithDomains();
    const scheduler = new ProactiveScheduler(highThresholdConfig, {
      loadPersona: async () => persona,
      onInsightReady: async () => {},
      savePersona: async () => {},
    });

    const result = await scheduler.processEvent("user1", {
      type: "timer",
      timestamp: Date.now(),
    });

    expect(result).toBeUndefined();
  });

  it("pipeline degrades gracefully: resolve returns null", async () => {
    const persona = personaWithDomains();
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => persona,
      onInsightReady: async () => {},
      savePersona: async () => {},
    }, {
      insightGenerator: async () => [],
    });

    const result = await scheduler.processEvent("user1", {
      type: "timer",
      timestamp: Date.now(),
    });

    expect(result).toBeUndefined();
  });
});

describe("scanExploration (80/20 surprise/extend)", () => {
  it("always produces an exploration opportunity", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: 1001,
    });

    const exploration = opportunities.filter((o) => o.type === "exploration");
    expect(exploration.length).toBe(1);
  });

  it("surprise mode has empty targetDomains (inferred by interest layer)", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);

    const ts = 1000; // (1000 % 10) / 10 = 0 < 0.8 → surprise
    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: ts,
    });

    const exploration = opportunities.find((o) => o.type === "exploration");
    expect(exploration).toBeDefined();
    expect(exploration!.metadata).toEqual({ mode: "surprise" });
    expect(exploration!.targetDomains).toEqual([]);
    expect(exploration!.pNeed).toBe(0.55);
  });

  it("extend mode picks from user's own domains", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);

    const ts = 9001; // (9001 % 10) / 10 = 0.1 < 0.8... need ts%10 >= 8 → ts=8 → (8%10)/10=0.8, not < 0.8 → extend
    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: 8,
    });

    const exploration = opportunities.find((o) => o.type === "exploration");
    expect(exploration).toBeDefined();
    expect(exploration!.metadata).toEqual({ mode: "extend" });
    expect(exploration!.targetDomains.length).toBeGreaterThan(0);
    expect(exploration!.pNeed).toBe(0.5);
  });

  it("fires for ALL event types", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);

    const eventTypes: Array<"timer" | "persona_change" | "info_scan" | "external"> = [
      "timer", "persona_change", "info_scan", "external",
    ];

    for (const type of eventTypes) {
      const opportunities = scheduler.search(persona, { type, timestamp: 2000, payload: {} });
      const hasExploration = opportunities.some((o) => o.type === "exploration");
      expect(hasExploration).toBe(true);
    }
  });

  it("~80% of events produce surprise mode", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);

    let surpriseCount = 0;
    let extendCount = 0;
    const total = 1000;

    for (let i = 0; i < total; i++) {
      const opportunities = scheduler.search(persona, {
        type: "timer",
        timestamp: i,
      });
      const exploration = opportunities.find((o) => o.type === "exploration");
      if (exploration) {
        const mode = (exploration.metadata as Record<string, string>)?.mode;
        if (mode === "surprise") surpriseCount++;
        else extendCount++;
      }
    }

    const surpriseRatio = surpriseCount / total;
    expect(surpriseRatio).toBeGreaterThanOrEqual(0.78);
    expect(surpriseRatio).toBeLessThanOrEqual(0.82);
  });

  it("returns empty when persona has no domains", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.7;
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: 1000,
    });

    const exploration = opportunities.filter((o) => o.type === "exploration");
    expect(exploration).toEqual([]);
  });
});

describe("filterBlacklistedOpportunities", () => {
  const baseOpportunities: Opportunity[] = [
    {
      type: "cross_domain",
      targetDomains: ["AI/机器学习"],
      sourceDomains: ["软件架构"],
      pNeed: 0.7,
      pAccept: 0.5,
      pAct: 0.35,
    },
    {
      type: "domain_depth",
      targetDomains: ["Rust"],
      sourceDomains: [],
      pNeed: 0.6,
      pAccept: 0.5,
      pAct: 0.3,
    },
    {
      type: "domain_depth",
      targetDomains: ["Design"],
      sourceDomains: ["AI/机器学习"],
      pNeed: 0.5,
      pAccept: 0.5,
      pAct: 0.25,
    },
  ];

  it("returns all opportunities when blacklist is empty", () => {
    const result = filterBlacklistedOpportunities(baseOpportunities, []);
    expect(result).toHaveLength(3);
  });

  it("filters opportunities with blacklisted target domains", () => {
    const result = filterBlacklistedOpportunities(baseOpportunities, ["AI/机器学习"]);
    expect(result).toHaveLength(1);
    expect(result[0].targetDomains).toContain("Rust");
  });

  it("filters opportunities with blacklisted source domains", () => {
    const result = filterBlacklistedOpportunities(baseOpportunities, ["AI/机器学习"]);
    expect(result.every((o) => !o.sourceDomains.includes("AI/机器学习"))).toBe(true);
  });

  it("returns empty when all opportunities are blacklisted", () => {
    const result = filterBlacklistedOpportunities(baseOpportunities, [
      "AI/机器学习", "Rust", "Design",
    ]);
    expect(result).toHaveLength(0);
  });

  it("does not modify original opportunities array", () => {
    const original = [...baseOpportunities];
    filterBlacklistedOpportunities(baseOpportunities, ["AI/机器学习"]);
    expect(baseOpportunities).toHaveLength(original.length);
  });
});

describe("ProactiveScheduler.search — blacklist integration", () => {
  const config: SchedulerConfig = {
    minIntervalHours: 4,
    minTrustScore: 0.3,
  };

  it("search filters out blacklisted domains from opportunities", () => {
    const persona = personaWithDomains();
    persona.domainBlacklist = ["AI/机器学习"];

    const scheduler = makeScheduler(config, persona);
    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: Date.now(),
    });

    for (const opp of opportunities) {
      expect(opp.targetDomains).not.toContain("AI/机器学习");
      expect(opp.sourceDomains).not.toContain("AI/机器学习");
    }
  });
});

describe("ProactiveScheduler — semantic dedup", () => {
  it("skips insight when targetDomains 100% overlap with recent insight", async () => {
    const persona = personaWithDomains();
    persona.feedbackProfile.recentInsightDomains = [["AI/机器学习"]];
    persona.feedbackProfile.lastProactiveAt = 0;

    const fakeInsight: InsightCandidate = {
      id: "dedup-test",
      content: "重复洞察",
      rationale: "test",
      targetDomains: ["AI/机器学习"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
      verificationStatus: "unverified",
    };

    const scheduler = new ProactiveScheduler(
      config,
      {
        loadPersona: async () => persona,
        onInsightReady: async () => {},
        savePersona: async () => {},
      },
      { insightGenerator: async () => [fakeInsight] },
    );

    const result = await scheduler.processEvent("user1", {
      type: "timer",
      timestamp: Date.now(),
    });

    expect(result).toBeUndefined(); // 100% overlap → dedup
  });

  it("allows insight when domains have no overlap", async () => {
    const persona = personaWithDomains();
    persona.feedbackProfile.recentInsightDomains = [["Rust"]];
    persona.feedbackProfile.lastProactiveAt = 0;

    const fakeInsight: InsightCandidate = {
      id: "new-insight",
      content: "全新领域洞察",
      rationale: "test",
      targetDomains: ["Design"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
      verificationStatus: "unverified",
    };

    const scheduler = new ProactiveScheduler(
      config,
      {
        loadPersona: async () => persona,
        onInsightReady: async () => {},
        savePersona: async () => {},
      },
      { insightGenerator: async () => [fakeInsight] },
    );

    const result = await scheduler.processEvent("user1", {
      type: "timer",
      timestamp: Date.now(),
    });

    expect(result).toBeDefined();
  });

  it("allows insight when recentInsightDomains is empty", async () => {
    const persona = personaWithDomains();
    persona.feedbackProfile.lastProactiveAt = 0;

    const fakeInsight: InsightCandidate = {
      id: "first-insight",
      content: "第一个洞察",
      rationale: "test",
      targetDomains: ["AI/机器学习"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
      verificationStatus: "unverified",
    };

    const scheduler = new ProactiveScheduler(
      config,
      {
        loadPersona: async () => persona,
        onInsightReady: async () => {},
        savePersona: async () => {},
      },
      { insightGenerator: async () => [fakeInsight] },
    );

    const result = await scheduler.processEvent("user1", {
      type: "timer",
      timestamp: Date.now(),
    });

    expect(result).toBeDefined();
  });

  it("stores recentInsightDomains and recentInsightTypes after delivery", async () => {
    const persona = personaWithDomains();
    persona.feedbackProfile.lastProactiveAt = 0;
    let savedPersona: PersonaTree | undefined;

    const fakeInsight: InsightCandidate = {
      id: "test-id",
      content: "Test insight",
      rationale: "test",
      targetDomains: ["AI/机器学习"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
      verificationStatus: "unverified",
    };

    const scheduler = new ProactiveScheduler(
      config,
      {
        loadPersona: async () => persona,
        onInsightReady: async () => {},
        savePersona: async (_userId, p) => { savedPersona = p; },
      },
      { insightGenerator: async () => [fakeInsight] },
    );

    await scheduler.processEvent("user1", {
      type: "info_scan",
      timestamp: Date.now(),
    });

    expect(savedPersona?.feedbackProfile.recentInsightDomains).toBeDefined();
    expect(savedPersona?.feedbackProfile.recentInsightDomains).toContainEqual(["AI/机器学习"]);
    expect(savedPersona?.feedbackProfile.recentInsightTypes).toBeDefined();
  });

  it("does not dedup when overlap is exactly 50% (boundary)", async () => {
    const persona = personaWithDomains();
    persona.feedbackProfile.recentInsightDomains = [["AI/机器学习", "Rust"]];
    persona.feedbackProfile.lastProactiveAt = 0;

    const fakeInsight: InsightCandidate = {
      id: "boundary-test",
      content: "边界测试",
      rationale: "test",
      targetDomains: ["AI/机器学习"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.65,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
      verificationStatus: "unverified",
    };

    const scheduler = new ProactiveScheduler(
      config,
      {
        loadPersona: async () => persona,
        onInsightReady: async () => {},
        savePersona: async () => {},
      },
      { insightGenerator: async () => [fakeInsight] },
    );

    const result = await scheduler.processEvent("user1", {
      type: "timer",
      timestamp: Date.now(),
    });

    // overlap = 1/max(1,2) = 0.5 → NOT > 0.5 → should pass
    expect(result).toBeDefined();
  });
});

describe("ProactiveScheduler.identify — repetition penalty", () => {
  const lowThresholdConfig: SchedulerConfig = {
    minIntervalHours: 4,
    minTrustScore: 0.3,
    costFalseNegative: 10,
    costFalseAlarm: 1,
  };

  it("penalizes opportunities with overlapping recent domains", () => {
    const scheduler = makeScheduler(lowThresholdConfig);
    const persona = personaWithDomains();
    persona.feedbackProfile.recentInsightDomains = [["AI/机器学习"], ["AI/机器学习"], ["AI/机器学习"]];

    const opportunities: Opportunity[] = [
      { type: "domain_depth", targetDomains: ["AI/机器学习"], sourceDomains: [], pNeed: 0.9, pAccept: 0.9, pAct: 0.81 },
      { type: "cross_domain", targetDomains: ["Design"], sourceDomains: ["Rust"], pNeed: 0.5, pAccept: 0.5, pAct: 0.25 },
    ];

    const selected = scheduler.identify(opportunities, persona);
    expect(selected).not.toBeNull();
    expect(selected!.pAct).toBeLessThan(0.81);
  });

  it("selects non-overlapping opportunity when dominant one is penalized", () => {
    const scheduler = makeScheduler(lowThresholdConfig);
    const persona = personaWithDomains();
    persona.feedbackProfile.recentInsightDomains = [["AI/机器学习"], ["AI/机器学习"], ["AI/机器学习"], ["AI/机器学习"], ["AI/机器学习"]];

    const opportunities: Opportunity[] = [
      { type: "domain_depth", targetDomains: ["AI/机器学习"], sourceDomains: [], pNeed: 0.9, pAccept: 0.9, pAct: 0.81 },
      { type: "cross_domain", targetDomains: ["Design"], sourceDomains: [], pNeed: 0.7, pAccept: 0.7, pAct: 0.49 },
    ];

    const selected = scheduler.identify(opportunities, persona);
    expect(selected).not.toBeNull();
    expect(selected!.targetDomains).toContain("Design");
  });

  it("does not penalize when persona has no recent insights", () => {
    const scheduler = makeScheduler(lowThresholdConfig);

    const opportunities: Opportunity[] = [
      { type: "domain_depth", targetDomains: ["AI/机器学习"], sourceDomains: [], pNeed: 0.9, pAccept: 0.9, pAct: 0.81 },
    ];

    const selected = scheduler.identify(opportunities);
    expect(selected).not.toBeNull();
    expect(selected!.pAct).toBe(0.81);
  });

  it("penalizes repeated opportunity type with 0.5 multiplier", () => {
    const scheduler = makeScheduler(lowThresholdConfig);
    const persona = personaWithDomains();
    persona.feedbackProfile.recentInsightTypes = ["domain_depth", "domain_depth", "domain_depth"];

    const opportunities: Opportunity[] = [
      { type: "domain_depth", targetDomains: ["Rust"], sourceDomains: [], pNeed: 0.9, pAccept: 0.9, pAct: 0.81 },
      { type: "cross_domain", targetDomains: ["Rust"], sourceDomains: ["Design"], pNeed: 0.7, pAccept: 0.7, pAct: 0.49 },
    ];

    const selected = scheduler.identify(opportunities, persona);
    expect(selected).not.toBeNull();
    // domain_depth 0.81 * 0.5 = 0.405, cross_domain 0.49 → cross_domain wins
    expect(selected!.pAct).toBe(0.49);
    expect(selected!.type).toBe("cross_domain");
  });
});

describe("pNeed imbalance fix", () => {
  function deepDomainPersona(): PersonaTree {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.7;
    persona.rapport.totalExchanges = 10;
    persona.domains = {
      "AI/机器学习": {
        depth: 10,
        recurrence: 20,
        lastMentioned: Date.now(),
        keyInsights: ["Transformer架构", "注意力机制"],
        activeQuestions: [],
        connections: [],
        negationSignals: 0,
      },
      "软件架构": {
        depth: 5,
        recurrence: 8,
        lastMentioned: Date.now(),
        keyInsights: [],
        activeQuestions: [],
        connections: [],
        negationSignals: 0,
      },
    };
    persona.feedbackProfile.topicBandits = {
      "AI/机器学习": { alpha: 5, beta: 1 },
      "软件架构": { alpha: 4, beta: 2 },
    };
    persona.lifecycle = { ...persona.lifecycle, stage: "active", lastActiveAt: Date.now() };
    return persona;
  }

  const lowThresholdConfig: SchedulerConfig = {
    minIntervalHours: 4,
    minTrustScore: 0.3,
    costFalseNegative: 10,
    costFalseAlarm: 1,
  };

  it("scanDomainDepth never exceeds 0.7 pNeed", () => {
    const persona = deepDomainPersona();
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: Date.now(),
    });

    const domainDepthOpps = opportunities.filter((o) => o.type === "domain_depth");
    expect(domainDepthOpps.length).toBeGreaterThan(0);

    for (const opp of domainDepthOpps) {
      expect(opp.pNeed).toBeLessThanOrEqual(0.7);
    }

    // With depth=10 and recencyBoost=1: uncapped would be 0.3+0.8+0.2=1.3, now capped at 0.7
    const deepOpp = domainDepthOpps.find((o) => o.targetDomains.includes("AI/机器学习"));
    expect(deepOpp).toBeDefined();
    expect(deepOpp!.pNeed).toBe(0.7);
  });

  it("scanCrossDomain can reach 0.85 pNeed with deep domain", () => {
    const persona = deepDomainPersona();
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: Date.now(),
    });

    const crossDomainOpps = opportunities.filter((o) => o.type === "cross_domain");
    // "AI/机器学习" has depth=10 → depthFactor=min(10/5,1)=1 → pNeed=0.55*1+0.3=0.85
    const aiCross = crossDomainOpps.find((o) => o.targetDomains.includes("AI/机器学习"));
    if (aiCross) {
      expect(aiCross.pNeed).toBeCloseTo(0.85, 5);
    }
  });

  it("scanExploration has no pAccept penalty", () => {
    const persona = deepDomainPersona();
    const scheduler = makeScheduler(config, persona);

    // Compute expected baseline: trustFactor=0.7, bandits mean=(5/6 + 4/6)/2
    // meanPosterior = (0.8333 + 0.6667) / 2 = 0.75
    // baseline = 0.5*0.7 + 0.5*0.75 = 0.725
    const baseline = 0.5 * 0.7 + 0.5 * ((5 / 6 + 4 / 6) / 2);

    // Check both surprise and extend modes
    for (let ts = 0; ts < 20; ts++) {
      const opportunities = scheduler.search(persona, {
        type: "timer",
        timestamp: ts,
      });
      const exploration = opportunities.find((o) => o.type === "exploration");
      if (!exploration) continue;

      expect(exploration.pAccept).toBeCloseTo(baseline, 5);
    }
  });

  it("identify applies 0.5 same-type penalty", () => {
    const scheduler = makeScheduler(lowThresholdConfig);
    const persona = personaWithDomains();
    // Last type is domain_depth → domain_depth gets 0.5 penalty
    persona.feedbackProfile.recentInsightTypes = ["cross_domain", "domain_depth"];

    const originalPAct = 0.8;
    const opportunities: Opportunity[] = [
      { type: "domain_depth", targetDomains: ["A"], sourceDomains: [], pNeed: 0.9, pAccept: 0.9, pAct: originalPAct },
    ];

    const selected = scheduler.identify(opportunities, persona);
    expect(selected).not.toBeNull();
    expect(selected!.pAct).toBeCloseTo(originalPAct * 0.5, 5);
  });
});
