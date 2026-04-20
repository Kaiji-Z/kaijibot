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
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => persona,
      onInsightReady: async (_userId, candidate) => {
        capturedCandidates.push(candidate);
      },
      savePersona: async (_userId, p) => {
        savedPersona = p;
      },
    });

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
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => persona,
      onInsightReady: async (_userId, candidate) => {
        capturedCandidates.push(candidate);
      },
      savePersona: async () => {},
    });

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
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => persona,
      onInsightReady: async (_userId, candidate) => {
        capturedCandidates.push(candidate);
      },
      savePersona: async () => {},
    });

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

    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => JSON.parse(JSON.stringify(persona)) as PersonaTree,
      onInsightReady: async () => {},
      savePersona: async () => {},
    });

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
    expect(types.has("pending_question")).toBe(true);
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
    expect(types.has("pending_question")).toBe(true);
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

    expect(timerTypes).toContain("pending_question");
    expect(personaChangeTypes).not.toContain("pending_question");
    expect(infoScanTypes).toContain("info_scan_hit");
    expect(timerTypes).not.toContain("info_scan_hit");
  });
});

describe("ProactiveScheduler.identify", () => {
  it("ranks by pAct and returns top opportunity", () => {
    const scheduler = makeScheduler(config);
    const opportunities: Opportunity[] = [
      { type: "cross_domain", targetDomains: ["A"], sourceDomains: ["B"], pNeed: 0.5, pAccept: 0.5, pAct: 0.25 },
      { type: "pending_question", targetDomains: ["A"], sourceDomains: [], pNeed: 0.9, pAccept: 0.9, pAct: 0.81 },
      { type: "domain_depth", targetDomains: ["C"], sourceDomains: [], pNeed: 0.7, pAccept: 0.8, pAct: 0.56 },
    ];

    const selected = scheduler.identify(opportunities);
    expect(selected).not.toBeNull();
    expect(selected!.type).toBe("pending_question");
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

describe("scanExploration (20% fixed slot)", () => {
  it("produces exploration opportunity when timestamp % 5 === 0", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: 1000, // 1000 % 5 === 0
    });

    const exploration = opportunities.filter((o) => o.type === "exploration");
    expect(exploration.length).toBe(1);
    expect(exploration[0]!.pNeed).toBe(0.5);
    expect(exploration[0]!.pAct).toBeCloseTo(0.5 * exploration[0]!.pAccept, 10);
  });

  it("does NOT produce exploration when timestamp % 5 !== 0", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: 1001, // 1001 % 5 === 1
    });

    const exploration = opportunities.filter((o) => o.type === "exploration");
    expect(exploration.length).toBe(0);
  });

  it("target domain is always outside user's known graph", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);
    const userDomainKeys = Object.keys(persona.domains);

    for (let t = 0; t < 50; t += 5) {
      const opportunities = scheduler.search(persona, {
        type: "timer",
        timestamp: t,
      });
      const exploration = opportunities.filter((o) => o.type === "exploration");
      if (exploration.length > 0) {
        for (const opp of exploration) {
          for (const td of opp.targetDomains) {
            for (const ud of userDomainKeys) {
              expect(td.toLowerCase()).not.toBe(ud.toLowerCase());
            }
          }
        }
      }
    }
  });

  it("returns empty when all KNOWN_UNIVERSE domains are already known", () => {
    const persona = createDefaultPersona();
    persona.rapport.trustScore = 0.7;
    persona.domains = {
      "AI": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "architecture": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "programming": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "product": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "business": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "data science": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "security": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "cloud": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "blockchain": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "quantum computing": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "digital art": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "biotech": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "psychology": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "philosophy": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "design thinking": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "project management": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "testing": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
      "DevSecOps": { depth: 3, recurrence: 5, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 },
    };
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: 1000,
    });

    const exploration = opportunities.filter((o) => o.type === "exploration");
    expect(exploration).toEqual([]);
  });

  it("exploration type is correct", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);

    const opportunities = scheduler.search(persona, {
      type: "timer",
      timestamp: 500,
    });

    const exploration = opportunities.find((o) => o.type === "exploration");
    expect(exploration).toBeDefined();
    expect(exploration!.type).toBe("exploration");
    expect(exploration!.pAccept).toBeLessThan(1);
    expect(exploration!.pAct).toBeGreaterThan(0);
  });

  it("fires for ALL event types when slot is active", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);
    const ts = 2000; // 2000 % 5 === 0

    const eventTypes: Array<"timer" | "persona_change" | "info_scan" | "external"> = [
      "timer", "persona_change", "info_scan", "external",
    ];

    for (const type of eventTypes) {
      const opportunities = scheduler.search(persona, { type, timestamp: ts, payload: {} });
      const hasExploration = opportunities.some((o) => o.type === "exploration");
      expect(hasExploration).toBe(true);
    }
  });

  it("~20% of events produce exploration opportunities", () => {
    const persona = personaWithDomains();
    const scheduler = makeScheduler(config, persona);

    let explorationCount = 0;
    const total = 1000;

    for (let i = 0; i < total; i++) {
      const opportunities = scheduler.search(persona, {
        type: "timer",
        timestamp: i,
      });
      if (opportunities.some((o) => o.type === "exploration")) {
        explorationCount++;
      }
    }

    const ratio = explorationCount / total;
    expect(ratio).toBeGreaterThanOrEqual(0.18);
    expect(ratio).toBeLessThanOrEqual(0.22);
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
      type: "pending_question",
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
      sources: [],
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
      sources: [],
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
      sources: [],
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
      sources: [],
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
      sources: [],
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

  it("penalizes repeated opportunity type", () => {
    const scheduler = makeScheduler(lowThresholdConfig);
    const persona = personaWithDomains();
    persona.feedbackProfile.recentInsightTypes = ["domain_depth", "domain_depth", "domain_depth"];

    const opportunities: Opportunity[] = [
      { type: "domain_depth", targetDomains: ["Rust"], sourceDomains: [], pNeed: 0.9, pAccept: 0.9, pAct: 0.81 },
      { type: "cross_domain", targetDomains: ["Rust"], sourceDomains: ["Design"], pNeed: 0.7, pAccept: 0.7, pAct: 0.49 },
    ];

    const selected = scheduler.identify(opportunities, persona);
    expect(selected).not.toBeNull();
    expect(selected!.pAct).toBeLessThan(0.81);
  });
});
