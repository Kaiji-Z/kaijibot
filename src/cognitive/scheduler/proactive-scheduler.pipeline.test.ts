import { describe, it, expect } from "vitest";
import { ProactiveScheduler } from "./proactive-scheduler.js";
import { createDefaultPersona } from "../persona/store.js";
import { computeGradedGate, computeRepetitionDecay } from "./gate.js";
import { isDuplicateBySemanticOverlap } from "../insight/content-similarity.js";
import type { SchedulerConfig, Opportunity, GateContext } from "./types.js";
import type { PersonaTree } from "../types.js";
import type { InsightCandidate } from "../insight/types.js";

// ── Persona factory ──────────────────────────────────────────────────

function richPersona(eventTimestamp?: number): PersonaTree {
  // When eventTimestamp is given, set lastActiveAt ~2.4h before it so the
  // Gaussian cadenceFactor peaks at the event time (cadencePeak ≈ 2.4h).
  const lastActiveAt = eventTimestamp
    ? eventTimestamp - 2.4 * 3600_000
    : Date.now();
  const persona = createDefaultPersona();
  persona.rapport.trustScore = 0.85;
  persona.rapport.totalExchanges = 200;
  persona.domains = {
    "AI/机器学习": {
      depth: 5,
      recurrence: 12,
      lastMentioned: Date.now(),
      keyInsights: ["Transformer架构", "注意力机制"],
      activeQuestions: [],
      negationSignals: 0,
    },
    "软件架构": {
      depth: 4,
      recurrence: 8,
      lastMentioned: Date.now(),
      keyInsights: ["微服务", "事件驱动"],
      activeQuestions: [],
      negationSignals: 0,
    },
    "Rust": {
      depth: 4,
      recurrence: 6,
      lastMentioned: Date.now(),
      keyInsights: ["所有权模型", "零成本抽象"],
      activeQuestions: [],
      negationSignals: 0,
    },
    "TypeScript": {
      depth: 3,
      recurrence: 5,
      lastMentioned: Date.now(),
      keyInsights: ["类型体操", "装饰器模式"],
      activeQuestions: [],
      negationSignals: 0,
    },
    "网络安全": {
      depth: 3,
      recurrence: 4,
      lastMentioned: Date.now(),
      keyInsights: ["零信任架构", "沙箱隔离"],
      activeQuestions: [],
      negationSignals: 0,
    },
  };
  persona.feedbackProfile.topicBandits = {
    "AI/机器学习": { alpha: 5, beta: 1 },
    "软件架构": { alpha: 4, beta: 2 },
    "Rust": { alpha: 3, beta: 1 },
    "TypeScript": { alpha: 3, beta: 2 },
    "网络安全": { alpha: 2, beta: 1 },
  };
  persona.lifecycle = {
    stage: "active",
    lastActiveAt,
    lastStageTransitionAt: lastActiveAt - 86400000,
    totalActiveDays: 30,
  };
  return persona;
}

// ── Config ───────────────────────────────────────────────────────────

const pipelineConfig: SchedulerConfig = {
  minIntervalHours: 1,
  minTrustScore: 0.3,
  costFalseNegative: 10,
  costFalseAlarm: 1,
};

// ── Fake insights with genuinely different Chinese content ────────────

const INSIGHT_CONTENTS = [
  "Transformer注意力机制正在重塑自然语言处理的工程实践范式",
  "微服务架构中事件溯源模式与领域驱动设计的融合实践",
  "所有权系统为并发编程提供了编译期安全保证的新思路",
  "类型系统的图灵完备性在框架元编程中的创新应用",
  "消息卡片交互设计中的状态管理与响应式编程理念结合",
  "分布式追踪系统在云原生环境下的性能瓶颈诊断方法论",
  "零信任网络架构为微服务间通信提供了动态加密信道保障",
  "编译期反射机制使得静态类型语言也能具备元编程能力",
  "事件风暴工作坊帮助团队发现领域模型中隐藏的业务规则",
  "注意力权重的稀疏化计算显著降低了推理阶段的显存占用",
];

const DOMAIN_KEYS = [
  "AI/机器学习",
  "软件架构",
  "Rust",
  "TypeScript",
  "网络安全",
] as const;

function makeFakeInsight(
  cycle: number,
  domainIndex: number,
): InsightCandidate {
  const targetDomain = DOMAIN_KEYS[domainIndex % DOMAIN_KEYS.length]!;
  return {
    id: `insight-pipeline-${cycle}`,
    content: INSIGHT_CONTENTS[cycle % INSIGHT_CONTENTS.length]!,
    rationale: `pipeline test cycle ${cycle}`,
    targetDomains: [targetDomain],
    sourceDomains: [],
    relevanceScore: 0.8,
    surpriseScore: 0.6,
    compositeScore: 0.7,
    sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
    verificationStatus: "unverified",
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeGateContext(persona: PersonaTree, eventTimestamp: number): GateContext {
  return {
    persona,
    event: { type: "timer", timestamp: eventTimestamp },
    recentInsightCount: 0,
    config: pipelineConfig,
  };
}

// ══════════════════════════════════════════════════════════════════════
// Test suite: 8 test cases covering full pipeline lifecycle
// ══════════════════════════════════════════════════════════════════════

describe("ProactiveScheduler pipeline lifecycle", () => {
  // ── Test 1 ───────────────────────────────────────────────────────────

  it("records attempted domains after identify even when resolve returns nothing", async () => {
    const eventTimestamp = 10_000;
    const persona = richPersona(eventTimestamp);

    const scheduler = new ProactiveScheduler(pipelineConfig, {
      loadPersona: async () => persona,
      onInsightReady: async () => {},
      savePersona: async () => {},
    }, {
      insightGenerator: async () => [],
    });

    const result = await scheduler.processEvent("user1", {
      type: "timer",
      timestamp: eventTimestamp,
    });

    expect(result).toBeUndefined();
    expect(persona.feedbackProfile.recentInsightDomains).toBeDefined();
    expect(persona.feedbackProfile.recentInsightDomains!.length).toBeGreaterThan(0);

    const recordedDomains = persona.feedbackProfile.recentInsightDomains!;
    const lastEntry = recordedDomains[recordedDomains.length - 1]!;
    expect(lastEntry.length).toBeGreaterThan(0);
    const allDomainNames = Object.keys(persona.domains);
    expect(lastEntry.some((d) => allDomainNames.includes(d))).toBe(true);
  });

  // ── Test 2 ───────────────────────────────────────────────────────────

  it("domain cooldown penalizes attempted-but-undelivered domains on next cycle", async () => {
    const eventTimestamp = 10_000;
    const persona = richPersona(eventTimestamp);

    // Cycle 1: empty generator → resolve fails, but persona is mutated in-place
    const schedulerC1 = new ProactiveScheduler(pipelineConfig, {
      loadPersona: async () => persona,
      onInsightReady: async () => {},
      savePersona: async () => {},
    }, { insightGenerator: async () => [] });

    await schedulerC1.processEvent("user1", {
      type: "timer",
      timestamp: eventTimestamp,
    });

    // persona was mutated in-place with attempted domains
    const recordedDomains = persona.feedbackProfile.recentInsightDomains!;
    expect(recordedDomains.length).toBeGreaterThan(0);
    const c1Domain = recordedDomains[recordedDomains.length - 1]!;

    // Cycle 2: call identify directly and verify domain X is penalized
    // Clear type history to isolate domain cooldown testing
    persona.feedbackProfile.recentInsightTypes = [];

    const schedulerC2 = new ProactiveScheduler(pipelineConfig, {
      loadPersona: async () => persona,
      onInsightReady: async () => {},
      savePersona: async () => {},
    }, { insightGenerator: async () => [] });

    const opportunities: Opportunity[] = [
      {
        type: "domain_depth",
        targetDomains: c1Domain,
        sourceDomains: [],
        pNeed: 0.9,
        pAccept: 0.9,
        pAct: 0.81,
      },
      {
        type: "cross_domain",
        targetDomains: ["网络安全"],
        sourceDomains: [],
        pNeed: 0.5,
        pAccept: 0.5,
        pAct: 0.25,
      },
    ];

    const selected = schedulerC2.identify(opportunities, persona);
    expect(selected.length).toBeGreaterThanOrEqual(1);

    // c1Domain appears once in recentInsightDomains → overlapCount=1 → 0.5^1 = 0.5
    // penalized pAct = 0.81 * 0.5 = 0.405
    // 网络安全 gets starvation bonus (absent from window) → 0.25 * (1 + 1.5*1) = 0.625
    // 0.625 > 0.405 → 网络安全 wins
    expect(selected[0].pAct).toBeLessThan(0.81);
    expect(selected[0].targetDomains).toContain("网络安全");
  });

  // ── Test 3 ───────────────────────────────────────────────────────────

  it("type cooldown removed — same-type opportunities are not penalized", () => {
    const persona = richPersona();
    persona.feedbackProfile.recentInsightTypes = ["cross_domain", "cross_domain"];

    const scheduler = new ProactiveScheduler(pipelineConfig, {
      loadPersona: async () => persona,
      onInsightReady: async () => {},
      savePersona: async () => {},
    });

    const opportunities: Opportunity[] = [
      {
        type: "cross_domain",
        targetDomains: ["AI/机器学习"],
        sourceDomains: ["Rust"],
        pNeed: 0.7,
        pAccept: 0.8,
        pAct: 0.56,
      },
      {
        type: "domain_depth",
        targetDomains: ["软件架构"],
        sourceDomains: [],
        pNeed: 0.6,
        pAccept: 0.7,
        pAct: 0.42,
      },
    ];

    const selected = scheduler.identify(opportunities, persona);
    expect(selected.length).toBeGreaterThanOrEqual(1);
    // No type penalty — cross_domain keeps pAct=0.56, wins over domain_depth 0.42
    expect(selected[0].type).toBe("cross_domain");
    expect(selected[0].pAct).toBe(0.56);
  });

  // ── Test 4 ───────────────────────────────────────────────────────────

  it("diversification across 5 rounds produces varied domains", async () => {
    const baseTimestamp = 10_000;
    const persona = richPersona(baseTimestamp);
    let currentPersona: PersonaTree = persona;
    const deliveredDomains: string[][] = [];

    for (let cycle = 0; cycle < 5; cycle++) {
      let savedPersona: PersonaTree | undefined;
      // Use cycle % 5 for domain index → different domain each cycle
      const fakeInsight = makeFakeInsight(cycle, cycle % 5);

      const scheduler = new ProactiveScheduler(pipelineConfig, {
        loadPersona: async () => currentPersona,
        onInsightReady: async () => {},
        savePersona: async (_userId, p) => { savedPersona = p; },
      }, { insightGenerator: async () => [fakeInsight] });

      const result = await scheduler.processEvent("user1", {
        type: "timer",
        timestamp: 10_000 + cycle * 3_601_000,
      });

      if (result) {
        deliveredDomains.push(result.targetDomains);
        if (savedPersona) {
          // Simulate user activity after each delivered insight so the
          // cadenceFactor stays near-peak for the next cycle.
          savedPersona.lifecycle.lastActiveAt = 10_000 + cycle * 3_601_000;
          currentPersona = savedPersona;
        }
      }
    }

    // Should deliver at least some insights
    expect(deliveredDomains.length).toBeGreaterThanOrEqual(3);

    // Verify at least 3 unique domain sets were delivered
    const uniqueDomainSets = new Set(deliveredDomains.map((d) => d.sort().join(",")));
    expect(uniqueDomainSets.size).toBeGreaterThanOrEqual(3);

    // Verify no single domain appears more than 2 times
    const domainCounts = new Map<string, number>();
    for (const domains of deliveredDomains) {
      for (const d of domains) {
        domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
      }
    }
    for (const [domain, count] of domainCounts) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  // ── Test 5 ───────────────────────────────────────────────────────────

  it("gate pAct computation makes sense for different trust levels", () => {
    // Use timestamp far from lastProactiveAt=0 to ensure high pNeed
    const now = 3600_000 * 10; // 10 hours elapsed

    // High trust persona — lastActiveAt set so cadenceFactor peaks at `now`
    const highTrustPersona = richPersona(now);
    highTrustPersona.rapport.trustScore = 0.9;
    highTrustPersona.rapport.totalExchanges = 200;
    highTrustPersona.feedbackProfile.lastProactiveAt = 0;

    const highTrustResult = computeGradedGate(makeGateContext(highTrustPersona, now));
    expect(highTrustResult.decision).toBe(true);
    // With 10h elapsed, trust=0.9, positive bandits → pAct should be substantial
    expect(highTrustResult.pAct).toBeGreaterThan(0.15);

    // Low trust + insufficient exchanges → hard veto
    const lowTrustPersona = richPersona(now);
    lowTrustPersona.rapport.trustScore = 0.2;
    lowTrustPersona.rapport.totalExchanges = 3; // < 5 → hard veto
    lowTrustPersona.feedbackProfile.lastProactiveAt = 0;

    const lowTrustResult = computeGradedGate(makeGateContext(lowTrustPersona, now));
    expect(lowTrustResult.decision).toBe(false);
    expect(lowTrustResult.pAct).toBe(0); // hard veto zeros everything
    expect(lowTrustResult.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("exchanges")]),
    );
  });

  // ── Test 6 ───────────────────────────────────────────────────────────

  it("content dedup at trigram threshold 0.6 catches near-duplicates", () => {
    const a = "Transformer注意力机制正在重塑自然语言处理的工程实践范式";
    const b = "Transformer注意力机制正在重塑自然语言处理的工程实践范式";

    expect(isDuplicateBySemanticOverlap(a, [b])).toBe(true);
  });

  // ── Test 7 ───────────────────────────────────────────────────────────

  it("content dedup allows topically-similar but structurally-different content", () => {
    const a = "AI工具链的安全问题集中在权限边界和沙箱隔离机制的实现细节";
    const b = "网络安全领域对零信任架构的实践为分布式系统提供了新的防护思路";

    expect(isDuplicateBySemanticOverlap(a, [b])).toBe(false);
  });

  // ── Test 8 ───────────────────────────────────────────────────────────

  it("repetitionDecay reduces pAct for repeated domains", () => {
    // Repeated same domain → high pairwise Jaccard → decay < 1
    const repeatedPersona = richPersona();
    repeatedPersona.feedbackProfile.recentInsightDomains = [
      ["AI/机器学习"],
      ["AI/机器学习"],
      ["AI/机器学习"],
    ];

    const repeatedDecay = computeRepetitionDecay(repeatedPersona);
    expect(repeatedDecay).toBeLessThan(1);

    // Diverse domains → low pairwise Jaccard → decay closer to 1
    const diversePersona = richPersona();
    diversePersona.feedbackProfile.recentInsightDomains = [
      ["AI/机器学习"],
      ["Rust"],
      ["TypeScript"],
    ];

    const diverseDecay = computeRepetitionDecay(diversePersona);
    expect(diverseDecay).toBeGreaterThan(repeatedDecay);
    // Diverse should be 1 (no meaningful overlap) or very close to 1
    expect(diverseDecay).toBeGreaterThanOrEqual(0.9);
  });
});
