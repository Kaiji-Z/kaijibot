import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetNoResponseStreak } from "../feedback/collector.js";
import { FragmentStore } from "../insight/fragment-store.js";
import type { InsightCandidate } from "../insight/types.js";
import { createDefaultPersona } from "../persona/store.js";
import type { PersonaTree } from "../types.js";
import { computeGradedGate } from "./gate.js";
import { ProactiveScheduler } from "./proactive-scheduler.js";
import type { SchedulerConfig } from "./types.js";

/**
 * Human-cadence simulation suite — goal「洞察投放人化重构」(.goal/SPEC.md §5).
 *
 * Round-1 purpose: run against PRE-refactor code and archive the RED evidence
 * (.goal/evidence/). The decisive reds on old code:
 *   - Invariant M (non-revival): pAct must not RISE as silence-since-my-last-send
 *     grows — old code rises via recoveryFactor + compensatorySignal.
 *   - ignore-all convergence: ≤3 messages then silence — old code delivers
 *     indefinitely via the reEngageSignal floor.
 *   - responsive recovery window: reply → next delivery within one eligible
 *     tick — old gaussian peaks ~14h after activity, missing the window.
 *
 * `simulateUserReply` models the production "user message arrived" wiring
 * (curator path): lifecycle.lastActiveAt update + ledger clear to U=0.
 * Until Phase 1 wires it, the helper mirrors the target semantics explicitly;
 * Phase 1 adds a unit test covering the real production call site.
 */

// T0 ≡ 5000 (mod 10000): every 2h-grid timestamp keeps mode-selection roll
// ((seed % 10000)/10000) at 0.5 — inside surprise's band for the modeBandits
// below — so resolve() deterministically takes the knowledge path instead of
// dying on empty fragment clusters in pattern mode.
const T0 = 1_700_000_005_000;
const HR = 3_600_000;
const DAY = 24 * HR;

const simConfig: SchedulerConfig = {
  minIntervalHours: 4,
  minTrustScore: 0.3,
};

/** Deterministic clock: Date.now() follows sim time; Math.random pinned. */
function useSimClock(): { set: (t: number) => void; restore: () => void } {
  let now = T0;
  const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
  const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
  return {
    set: (t: number) => {
      now = t;
    },
    restore: () => {
      dateSpy.mockRestore();
      randomSpy.mockRestore();
    },
  };
}

function mkDomain(lastMentioned: number, depth: number): PersonaTree["domains"][string] {
  return {
    depth,
    recurrence: 5,
    lastMentioned,
    keyInsights: [],
    activeQuestions: [],
    negationSignals: 0,
  };
}

function makeSimPersona(): PersonaTree {
  const persona = createDefaultPersona();
  persona.identity.userId = "sim-user";
  persona.rapport.trustScore = 0.8;
  persona.rapport.totalExchanges = 50;
  // 10 domains: the fatigue/dedup window (last 5 attempted domain sets)
  // must never exhaust the domain pool, or every candidate goes "stale"
  // forever — real users have dozens of domains; 3 would starve the sim.
  persona.domains = {
    "AI/机器学习": mkDomain(T0 - 2 * HR, 5),
    Rust: mkDomain(T0 - 3 * HR, 4),
    Design: mkDomain(T0 - 5 * HR, 3),
    哲学写作: mkDomain(T0 - 7 * HR, 4),
    健康管理: mkDomain(T0 - 9 * HR, 3),
    摄影后期: mkDomain(T0 - 11 * HR, 3),
    烹饪: mkDomain(T0 - 13 * HR, 4),
    电影叙事: mkDomain(T0 - 15 * HR, 3),
    量化投资: mkDomain(T0 - 17 * HR, 5),
    心理学: mkDomain(T0 - 19 * HR, 3),
  };
  const bandits: PersonaTree["feedbackProfile"]["topicBandits"] = {};
  for (const name of Object.keys(persona.domains)) {
    bandits[name] = { alpha: 4, beta: 1 };
  }
  persona.feedbackProfile.topicBandits = bandits;
  // Deterministic mode routing: with Math.random pinned, Thompson samples
  // collapse to posterior means — surprise dominates, so resolve() takes the
  // knowledge path (generator mock) instead of dying on empty fragment
  // clusters in pattern mode.
  persona.feedbackProfile.modeBandits = {
    pattern: { alpha: 2, beta: 8 },
    surprise: { alpha: 9, beta: 1 },
    extend: { alpha: 2, beta: 8 },
  };
  persona.feedbackProfile.optimalFrequencyHours = 24;
  persona.feedbackProfile.lastProactiveAt = T0 - 8 * HR;
  persona.lifecycle = {
    ...persona.lifecycle,
    stage: "active",
    lastActiveAt: T0 - 2 * HR,
    totalActiveDays: 15,
  };
  return persona;
}

type ScenarioName = "responsive" | "sometimes" | "ignoreAll" | "dormant";

type SimResult = {
  deliveries: number[];
  replies: number[];
};

/**
 * Discrete-event simulation over `days` days.
 * Event grid: timer every 2h, info_scan every 6h, persona_change daily.
 * User policy decides whether/when the user replies to each delivery.
 */
async function runScenario(name: ScenarioName, days = 30): Promise<SimResult> {
  const clock = useSimClock();
  let persona = makeSimPersona();
  if (name === "dormant") {
    persona.lifecycle.stage = "dormant";
    persona.lifecycle.lastActiveAt = T0 - 20 * DAY;
  }

  const deliveries: number[] = [];
  const replies: number[] = [];
  const pendingReplies: number[] = [];
  let genCounter = 0;

  const SIM_TOPICS = [
    "注意力机制与认知负荷",
    "红烧肉的焦糖化反应",
    "维特根斯坦的语言游戏",
    "富士山的摄影构图",
    "复利效应与心理账户",
    "格式塔心理学的闭合原则",
    "Rust 所有权与借用的权衡",
    "电影非线性叙事结构",
    "间歇训练与乳酸阈值",
    "宋瓷釉色的极简美学",
    "贝叶斯先验的选择",
    "城市步行性与社区活力",
    "睡眠周期与记忆巩固",
    "版式设计中的留白",
    "开源协议的传染性",
    "希腊悲剧的命运观",
    "咖啡烘焙的一爆曲线",
    "动效设计的缓动函数",
    "亲密关系中的依恋类型",
    "分布式一致性的边界",
    "围棋劫材的价值计算",
    "科普写作的类比陷阱",
    "爵士即兴的和声替代",
    "徒步装备的重量取舍",
    "谈判中的锚定效应",
    "古典建筑的柱式演化",
    "数据可视化的色觉无障碍",
    "机器学习的归纳偏置",
    "散文节奏的长短句配比",
    "静观冥想与默认模式网络",
  ];

  const makeCandidate = (targetDomains: string[]): InsightCandidate => {
    genCounter += 1;
    const topic = SIM_TOPICS[(genCounter - 1) % SIM_TOPICS.length]!;
    const domains = targetDomains.length > 0 ? targetDomains : [Object.keys(persona.domains)[0]!];
    return {
      id: `sim-${genCounter}`,
      content: `关于${topic}的洞察:这里是与该主题相关的具体展开内容,序号 ${genCounter},主题各异以保证语义去重通过。`,
      rationale: "sim rationale",
      targetDomains: domains,
      sourceDomains: ["Rust"],
      relevanceScore: 0.8,
      surpriseScore: 0.5,
      compositeScore: 0.7,
      sources: [
        { title: "src1", url: "https://example.com/a", credibility: 0.8 },
        { title: "src2", url: "https://example.com/b", credibility: 0.8 },
      ],
      verificationStatus: "verified",
    };
  };

  const scheduler = new ProactiveScheduler(
    simConfig,
    {
      loadPersona: async () => persona,
      onInsightReady: async () => true,
      savePersona: async (_agentId, _userId, p) => {
        persona = p;
      },
    },
    {
      insightGenerator: async (_persona, input) => [makeCandidate(input.targetDomains)],
      // Empty temp store: pattern mode finds no clusters and defers to
      // knowledge-mode candidates; never touches real ~/.kaijibot data.
      fragmentStore: new FragmentStore("/tmp/opencode/kaiji-sim-fragments"),
    },
  );

  try {
    const end = T0 + days * DAY;
    for (let t = T0; t < end; t += 2 * HR) {
      clock.set(t);

      // Drain due user replies (30min after the triggering delivery).
      while (pendingReplies.length > 0 && pendingReplies[0]! <= t) {
        const replyTs = pendingReplies.shift()!;
        persona.lifecycle.lastActiveAt = replyTs;
        persona = resetNoResponseStreak(persona); // models Phase-1 wiring
        replies.push(replyTs);
      }

      const events: SchedulerEventAt[] = [{ type: "timer", timestamp: t }];
      if ((t - T0) % (6 * HR) === 0) {
        events.push({ type: "info_scan", timestamp: t });
      }
      if ((t - T0) % DAY === 4 * HR) {
        events.push({ type: "persona_change", timestamp: t });
      }

      for (const event of events) {
        const result = await scheduler.processEvent("sim-user", event, "main");
        if (!result) {
          continue;
        }

        // Emulate the gateway delivery-outcome handler (server.impl.ts
        // delivered:true path): finalize + clear awaiting. This is the real
        // ledger increment path (finalizeDelivery → processNoResponse).
        const awaiting = persona.feedbackProfile.awaitingDeliveryConfirmation;
        if (awaiting?.candidate.id === result.id) {
          persona = ProactiveScheduler.finalizeDelivery(
            persona,
            awaiting.eventTimestamp,
            awaiting.candidate,
            awaiting.opportunityType,
          );
          persona.feedbackProfile.awaitingDeliveryConfirmation = null;
        }
        deliveries.push(t);

        const idx = deliveries.length;
        const repliesNow = name === "responsive" || (name === "sometimes" && idx % 2 === 1);
        if (repliesNow) {
          pendingReplies.push(t + 0.5 * HR);
        }
      }
    }
  } finally {
    clock.restore();
  }

  return { deliveries, replies };
}

type SchedulerEventAt = { type: "timer" | "info_scan" | "persona_change"; timestamp: number };

// ── Scenarios ─────────────────────────────────────────────────────────

describe("human-cadence simulation: scenarios (30-day)", () => {
  it("responsive user: steady contact, recovers within one eligible tick after each reply", async () => {
    const { deliveries, replies } = await runScenario("responsive");

    // Trust present: contact continues at roughly learned-frequency pace.
    expect(deliveries.length).toBeGreaterThanOrEqual(12);

    // Recovery invariant (goal criterion 2, iteration 2): after every reply,
    // the next delivery arrives promptly — where "promptly" for a friend with
    // daily self-restraint means within ~a day (daily cap 2 + stochastic
    // hazard worst case 1h floor + 24h target + 2h grid), not within 8h.
    // Replies inside the final window have no room for a next delivery.
    const simEnd = T0 + 30 * DAY;
    for (const replyTs of replies) {
      if (simEnd - replyTs < 28 * HR) {
        continue;
      }
      const next = deliveries.find((d) => d > replyTs);
      expect(next).toBeDefined();
      expect(next! - replyTs).toBeLessThanOrEqual(28 * HR);
    }
  }, 120_000);

  it("sometimes user: contact strictly between ignore-all and responsive", async () => {
    const sometimes = await runScenario("sometimes");
    const ignoreAll = await runScenario("ignoreAll");
    const responsive = await runScenario("responsive");

    expect(sometimes.deliveries.length).toBeGreaterThan(ignoreAll.deliveries.length);
    expect(sometimes.deliveries.length).toBeLessThan(responsive.deliveries.length);
  }, 300_000);

  it("ignore-all user: ≤3 messages then silence; ≤2 re-approaches in 30 days", async () => {
    const { deliveries } = await runScenario("ignoreAll");

    expect(deliveries.length).toBeLessThanOrEqual(3);

    const reApproaches = deliveries.filter((d) => d > T0 + 3 * DAY);
    expect(reApproaches.length).toBeLessThanOrEqual(2);
  }, 120_000);

  it("dormant user: low-rate check-ins, strictly fewer contacts than active user", async () => {
    const dormant = await runScenario("dormant");
    const responsive = await runScenario("responsive");

    expect(dormant.deliveries.length).toBeGreaterThanOrEqual(1);
    expect(dormant.deliveries.length).toBeLessThanOrEqual(3);
    expect(dormant.deliveries.length).toBeLessThan(responsive.deliveries.length);
  }, 240_000);
});

// ── Math invariants (gate-level) ──────────────────────────────────────

describe("human-cadence simulation: gate invariants", () => {
  let clock: ReturnType<typeof useSimClock>;
  beforeEach(() => {
    clock = useSimClock();
  });
  afterEach(() => {
    clock.restore();
  });

  function basePersona(): PersonaTree {
    const p = makeSimPersona();
    // User active 8h ago (momentum path live), ledger at 2 unanswered sends.
    p.lifecycle.lastActiveAt = T0 - 8 * HR;
    p.feedbackProfile.consecutiveNoResponses = 2;
    p.feedbackProfile.lastProactiveAt = T0;
    return p;
  }

  it("M — non-revival: pAct never rises as silence since my last send grows (U≥1)", () => {
    const persona = basePersona();
    const silences = [2, 6, 12, 24, 30, 48, 100, 200].map((h) => h * HR);

    const pActs = silences.map((silence) => {
      const result = computeGradedGate({
        persona,
        event: { type: "timer", timestamp: T0 + silence },
        recentInsightCount: 0,
        config: simConfig,
      });
      return result.pAct;
    });

    for (let i = 1; i < pActs.length; i++) {
      expect(pActs[i]).toBeLessThanOrEqual(pActs[i - 1]! + 1e-9);
    }
  });

  it("M2 — pAct non-increasing in ledger U at a fixed timestamp", () => {
    for (const u of [0, 1, 2, 4, 8]) {
      const persona = basePersona();
      persona.feedbackProfile.consecutiveNoResponses = u;
      const silence = 30 * HR;
      const result = computeGradedGate({
        persona,
        event: { type: "timer", timestamp: T0 + silence },
        recentInsightCount: 0,
        config: simConfig,
      });
      if (u === 0) {
        continue;
      }
      const prev = (() => {
        const p = basePersona();
        p.feedbackProfile.consecutiveNoResponses = [0, 1, 2, 4, 8][[0, 1, 2, 4, 8].indexOf(u) - 1]!;
        return computeGradedGate({
          persona: p,
          event: { type: "timer", timestamp: T0 + silence },
          recentInsightCount: 0,
          config: simConfig,
        }).pAct;
      })();
      expect(result.pAct).toBeLessThanOrEqual(prev + 1e-9);
    }
  });
});
