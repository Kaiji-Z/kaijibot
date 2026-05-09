/**
 * Live fragment collector test — real LLM, measures extraction rate.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY pnpm test src/cognitive/insight/fragment-collector-live.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  collectFragments,
  buildFragmentPrompt,
  createDefaultFragmentCollectorDeps,
} from "./fragment-collector.js";
import type { PersonaTree } from "../types.js";
import type { KaijiBotConfig } from "../../config/config.js";

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;

function makePersona(): PersonaTree {
  const now = Date.now();
  return {
    identity: {
      displayName: "凯机",
      coreTraits: {},
      expertDomains: ["AI/机器学习", "软件架构"],
      interestDomains: ["哲学", "分布式系统"],
      curiosityDomains: [],
    },
    domains: {
      "AI/机器学习": { depth: 5, recurrence: 15, lastMentioned: now - 1000 * 60 * 10, keyInsights: ["LLM推理循环", "prompt engineering"], activeQuestions: [], negationSignals: 0 },
      "软件架构": { depth: 4, recurrence: 10, lastMentioned: now - 1000 * 60 * 30, keyInsights: ["plugin系统", "事件驱动"], activeQuestions: [], negationSignals: 0 },
      "哲学/认识论": { depth: 3, recurrence: 5, lastMentioned: now - 1000 * 60 * 60, keyInsights: ["认识论基础主义", "Münchhausen三难"], activeQuestions: [], negationSignals: 0 },
      "分布式系统": { depth: 3, recurrence: 4, lastMentioned: now - 1000 * 60 * 120, keyInsights: ["DDIA数据流"], activeQuestions: [], negationSignals: 0 },
      "飞书API开发": { depth: 3, recurrence: 6, lastMentioned: now - 1000 * 60 * 60, keyInsights: ["飞书文档API", "消息卡片"], activeQuestions: [], negationSignals: 0 },
      "开发环境管理": { depth: 2, recurrence: 3, lastMentioned: now - 1000 * 60 * 180, keyInsights: ["workspace整理"], activeQuestions: [], negationSignals: 0 },
      "编程语言": { depth: 2, recurrence: 3, lastMentioned: now - 1000 * 60 * 200, keyInsights: ["Haskell类型系统"], activeQuestions: [], negationSignals: 0 },
    },
    recentFocus: ["洞察系统调试", "fragment收集", "飞书文档整理"],
    feedbackProfile: {
      topicBandits: {},
      optimalFrequencyHours: 2,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [],
      recentInsightDomains: [],
      recentInsightTypes: [],
      recentInsightQueryHistory: [],
    },
    rapport: { trustScore: 1, totalExchanges: 1400, avgResponseLength: 200, selfDisclosureLevel: 0.6 },
    domainBlacklist: [],
    lifecycle: { stage: "active", lastActiveAt: now, lastStageTransitionAt: now, totalActiveDays: 30 },
    calibrationHistory: [],
    moodHistory: [],
  };
}

function makeConfig(): KaijiBotConfig {
  return {
    cognitive: {
      persona: {
        extractionModel: "zai/glm-5-turbo",
      },
    },
  } as KaijiBotConfig;
}

// ─── Test turns ───

const DEPTH_TURNS: Array<{ label: string; user: string; assistant: string; expectFragment: boolean }> = [
  {
    label: "philosophical opinion",
    user: "我觉得所谓的原创性其实是个伪命题。生为原创，死为拷贝——每个人都被前人塑造，所谓的创新不过是把已有的碎片重新排列。每次被拷贝到一定程度，创作者就跑了，去寻找新的表达方式，然后又被模仿。这个循环本身才是创作的本质。",
    assistant: "你提到的'生为原创，死为拷贝'这个框架很有意思。它暗示了创作不是一种状态而是一个过程——你不是'原创的'或'模仿的'，你是在原创和模仿之间的某个位置不断移动。这个观点跟Walter Benjamin的《机械复制时代的艺术作品》有呼应，但你的版本更极端：你把模仿不是看作退化的拷贝，而是看作创作循环的驱动力。",
    expectFragment: true,
  },
  {
    label: "cross-domain reasoning",
    user: "我刚才在看共享单车的数据，突然想到这跟公地悲剧的模型完全不一样。公地悲剧假设资源是公共的、没人管的，但共享单车是私有化+算法分配的。Hardin的模型在这里根本不适用，但大家还是一直在套用。",
    assistant: "你抓住了一个很重要的框架错配问题。公地悲剧的前提是无管理的公共资源，每个理性个体都有动机过度使用。但共享单车是平台统一调度的——算法决定了哪些车投放在哪里、调度频率是多少。这更接近的是一个'算法治理的准公共品'问题，不是经典的公地悲剧。",
    expectFragment: true,
  },
  {
    label: "evaluative judgment on AI",
    user: "你给我的书单里那本Hands-On LLMs我之前看过一部分。说实话里面的连接太牵强了，把注意力机制类比为人类注意力这种类比没有信息量，不如直接讲数学。",
    assistant: "明白了，Hands-On LLMs 里的注意力机制类比确实偏表层。我重新推荐更数学化的入门材料。",
    expectFragment: true,
  },
  {
    label: "operational instruction",
    user: "帮我看一下fragment collector为什么没有在收集fragment了，日志里完全没有cognitive/fragment-collector的子系统日志",
    assistant: "让我检查一下代码和日志...",
    expectFragment: false,
  },
  {
    label: "short confirmation",
    user: "好的，你加上诊断日志吧",
    assistant: "已经在 attempt.ts 的 collectFragments try 块前后加了3条诊断日志...",
    expectFragment: false,
  },
  {
    label: "debug discussion",
    user: "我发了几条消息了，你去看日志",
    assistant: "让我看看诊断日志...",
    expectFragment: false,
  },
  {
    label: "technical explanation",
    user: "你介绍一下fragment的代码逻辑吧，我想了解整个流程",
    assistant: "Fragment 系统的核心目的是从对话中提取用户的思维模式。它有三个组件：收集器、存储、聚类。收集器在每次agent turn后异步执行，用LLM从对话中提取structural thinking patterns...",
    expectFragment: false,
  },
  {
    label: "deep technical reflection",
    user: "我觉得我们做这个认知系统的思路有个隐含假设——我们假设用户的思维模式是可以通过单轮对话提取的。但实际上，真正的思维模式应该是跨多轮对话才能看到的。一次对话里用户可能只是在调试bug，不涉及任何深层思考。",
    assistant: "你这个反思指向了fragment collector的一个根本性局限。单轮提取确实容易产生两类错误：false positive（把一次性的表述当作模式）和false negative（忽略了需要多轮才能显现的真正模式）。也许我们需要一个两阶段设计——先做单轮快速提取作为候选，再用跨轮聚类来验证和强化。",
    expectFragment: true,
  },
];

// ─── Tests ───

describe.skipIf(!isLive || !ZAI_API_KEY)("fragment-collector live", () => {
  const persona = makePersona();
  const config = makeConfig();
  const deps = createDefaultFragmentCollectorDeps();

  it("should return [] for short confirmations", async () => {
    const turn = DEPTH_TURNS[4]!;
    const fragments = await collectFragments(turn.user, turn.assistant, persona, config, deps);
    console.log(`[${turn.label}] extracted: ${fragments.length}`, fragments.map(f => ({ kind: f.kind, tag: f.structuralTag, domains: f.domains })));
    expect(fragments.length).toBe(0);
  }, 60_000);

  it("should return [] for debug discussions", async () => {
    const turn = DEPTH_TURNS[5]!;
    const fragments = await collectFragments(turn.user, turn.assistant, persona, config, deps);
    console.log(`[${turn.label}] extracted: ${fragments.length}`, fragments.map(f => ({ kind: f.kind, tag: f.structuralTag, domains: f.domains })));
    expect(fragments.length).toBe(0);
  }, 30_000);

  it("should extract fragments from cross-domain reasoning", async () => {
    const turn = DEPTH_TURNS[1]!;
    const fragments = await collectFragments(turn.user, turn.assistant, persona, config, deps);
    console.log(`[${turn.label}] extracted: ${fragments.length}`, fragments.map(f => ({ kind: f.kind, tag: f.structuralTag, domains: f.domains })));
    expect(fragments.length).toBeGreaterThan(0);
  }, 30_000);

  it("should extract fragments from evaluative judgment", async () => {
    const turn = DEPTH_TURNS[2]!;
    const fragments = await collectFragments(turn.user, turn.assistant, persona, config, deps);
    console.log(`[${turn.label}] extracted: ${fragments.length}`, fragments.map(f => ({ kind: f.kind, tag: f.structuralTag, domains: f.domains })));
    expect(fragments.length).toBeGreaterThan(0);
  }, 30_000);

  it("should return [] for operational instructions", async () => {
    const turn = DEPTH_TURNS[3]!;
    const fragments = await collectFragments(turn.user, turn.assistant, persona, config, deps);
    console.log(`[${turn.label}] extracted: ${fragments.length}`, fragments.map(f => ({ kind: f.kind, tag: f.structuralTag, domains: f.domains })));
    expect(fragments.length).toBe(0);
  }, 30_000);

  it("should return [] for technical explanations", async () => {
    const turn = DEPTH_TURNS[6]!;
    const fragments = await collectFragments(turn.user, turn.assistant, persona, config, deps);
    console.log(`[${turn.label}] extracted: ${fragments.length}`, fragments.map(f => ({ kind: f.kind, tag: f.structuralTag, domains: f.domains })));
    expect(fragments.length).toBe(0);
  }, 30_000);

  it("should extract fragments from deep technical reflection", async () => {
    const turn = DEPTH_TURNS[7]!;
    const fragments = await collectFragments(turn.user, turn.assistant, persona, config, deps);
    console.log(`[${turn.label}] extracted: ${fragments.length}`, fragments.map(f => ({ kind: f.kind, tag: f.structuralTag, domains: f.domains })));
    expect(fragments.length).toBeGreaterThan(0);
  }, 30_000);

  it("should extract fragments from philosophical turns", async () => {
    const turn = DEPTH_TURNS[0]!;
    const fragments = await collectFragments(turn.user, turn.assistant, persona, config, deps);
    console.log(`[${turn.label}] extracted: ${fragments.length}`, fragments.map(f => ({ kind: f.kind, tag: f.structuralTag, domains: f.domains })));
    expect(fragments.length).toBeGreaterThan(0);
  }, 60_000);

  it("measures overall extraction rate", async () => {
    const results: Array<{ label: string; expected: boolean; actual: number }> = [];

    for (const turn of DEPTH_TURNS) {
      const fragments = await collectFragments(turn.user, turn.assistant, persona, config, deps);
      results.push({ label: turn.label, expected: turn.expectFragment, actual: fragments.length });
      console.log(`  [${turn.label}] expected=${turn.expectFragment}, got=${fragments.length}`);

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 1000));
    }

    const depthTurns = results.filter(r => r.expected);
    const operationalTurns = results.filter(r => !r.expected);

    const depthExtractionRate = depthTurns.filter(r => r.actual > 0).length / depthTurns.length;
    const operationalCorrectRate = operationalTurns.filter(r => r.actual === 0).length / operationalTurns.length;

    console.log("\n=== Extraction Rate Summary ===");
    console.log(`Depth turns (should extract): ${depthTurns.filter(r => r.actual > 0).length}/${depthTurns.length} = ${(depthExtractionRate * 100).toFixed(0)}%`);
    console.log(`Operational turns (should skip): ${operationalTurns.filter(r => r.actual === 0).length}/${operationalTurns.length} = ${(operationalCorrectRate * 100).toFixed(0)}%`);

    // We expect at least 50% extraction rate on depth turns
    expect(depthExtractionRate).toBeGreaterThanOrEqual(0.5);
    // We expect at least 80% correct skip rate on operational turns
    expect(operationalCorrectRate).toBeGreaterThanOrEqual(0.8);
  }, 120_000);
});
