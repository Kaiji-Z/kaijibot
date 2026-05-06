/**
 * Insight quality integration test.
 *
 * Tests the full insight generation pipeline by calling the production
 * buildInsightPrompt and evaluating output quality.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 pnpm test src/cognitive/insight/insight-quality.test.ts
 *
 * Requires ZAI_API_KEY in environment (loaded from .env or process env).
 */

import { describe, it, expect } from "vitest";
import { buildInsightPrompt, isSubstantiveContent, GENERIC_INSIGHT_PATTERNS } from "./llm-engine.js";
import type { PersonaTree } from "../types.js";
import type { InsightEngineInput } from "./types.js";

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const API_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";

// ─── Persona Factories ─────────────────────────────────────────────────

function makeFullStackDevPersona(): PersonaTree {
  const now = Date.now();
  return {
    identity: {
      displayName: "凯机",
      coreTraits: {
        technical: { value: "高", confidence: 0.9, evidenceCount: 10, lastUpdated: now, source: "inferred" },
        style: { value: "务实", confidence: 0.8, evidenceCount: 5, lastUpdated: now, source: "observed" },
      },
      expertDomains: ["AI/机器学习", "软件架构"],
      interestDomains: ["认知架构", "产品思维"],
      curiosityDomains: [],
    },
    domains: {
      "认知系统设计": { depth: 5, recurrence: 12, lastMentioned: now - 1000 * 60 * 30, keyInsights: ["PRISM门控", "SIRI循环", "Persona双通道提取"], activeQuestions: [], connections: ["Prompt工程"], negationSignals: 0 },
      "飞书集成": { depth: 4, recurrence: 8, lastMentioned: now - 1000 * 60 * 60, keyInsights: ["WebSocket长连接", "消息卡片"], activeQuestions: [], connections: [], negationSignals: 0 },
      "TypeScript": { depth: 5, recurrence: 20, lastMentioned: now - 1000 * 60 * 10, keyInsights: ["Zod验证", "插件SDK类型设计"], activeQuestions: [], connections: [], negationSignals: 0 },
      "Prompt工程": { depth: 3, recurrence: 5, lastMentioned: now - 1000 * 60 * 60 * 2, keyInsights: ["JSON mode", "anti-repetition"], activeQuestions: [], connections: ["认知系统设计"], negationSignals: 0 },
    },
    recentFocus: ["认知层洞察质量优化", "Persona提取过滤器", "LLM prompt调试"],
    activeProjects: [],
    feedbackProfile: {
      topicBandits: {},
      preferredStyle: "observation",
      optimalFrequencyHours: 2,
      lastProactiveAt: now - 1000 * 60 * 60,
      recentInsightIds: ["id1", "id2"],
      recentInsightContents: [
        "Python的GIL被人骂了这么多年，但换个角度看它其实做对了一件事...",
        "Rust的借用检查器被骂学习曲线陡，但它其实在做一件很罕见的事...",
        "Go的error处理被人吐槽写起来啰嗦，但它和Rust的Result其实做了同一件事...",
      ],
    },
    rapport: { trustScore: 0.85, totalExchanges: 362, avgResponseLength: 235, selfDisclosureLevel: 1 },
    domainGraph: {
      nodes: ["认知系统设计", "Prompt工程", "飞书集成", "TypeScript"],
      edges: [
        { source: "认知系统设计", target: "Prompt工程", weight: 0.8, lastObserved: now, observations: 8 },
        { source: "认知系统设计", target: "飞书集成", weight: 0.6, lastObserved: now, observations: 5 },
      ],
      totalObservations: 13,
    },
    moodHistory: [],
    domainBlacklist: [],
    lifecycle: { stage: "active", lastActiveAt: now, lastStageTransitionAt: now, consecutiveSilentDays: 0, totalActiveDays: 30 },
    calibrationHistory: [],
    contradictionLog: [],
  };
}

function makeInput(targetDomains: string[]): InsightEngineInput {
  return {
    targetDomains,
    recentFocus: ["认知层洞察质量优化", "Persona提取过滤器", "LLM prompt调试"],
    trustScore: 0.85,
    recentInsightIds: ["id1", "id2"],
    recentInsightContents: [
      "Python的GIL被人骂了这么多年，但换个角度看它其实做对了一件事...",
      "Rust的借用检查器被骂学习曲线陡，但它其实在做一件很罕见的事...",
    ],
  };
}

// ─── Quality Evaluation ────────────────────────────────────────────────

function evaluateQuality(content: string, persona: PersonaTree): {
  score: number;
  issues: string[];
  scores: Record<string, number>;
} {
  const issues: string[] = [];
  const scores: Record<string, number> = {};
  const domainNames = Object.keys(persona.domains);
  const allKeyInsights = Object.values(persona.domains).flatMap(d => d.keyInsights);

  // Relevance: mentions user's domains or recent focus
  const mentionedDomain = domainNames.some(d => content.includes(d));
  const mentionedFocus = persona.recentFocus.some(f => content.includes(f));
  scores.relevance = (mentionedDomain || mentionedFocus) ? 8 : 3;
  if (!mentionedDomain && !mentionedFocus) issues.push("未提及用户领域或近期关注");

  // Natural: no banned patterns (use production filter list)
  const bannedHits = GENERIC_INSIGHT_PATTERNS.filter(p => p.test(content)).length;
  scores.natural = Math.max(2, 10 - bannedHits * 3);
  if (bannedHits > 0) issues.push(`检测到 ${bannedHits} 个模板句式`);

  // Specific: concrete details or keyInsights referenced
  const usesKeyInsight = allKeyInsights.some(k => content.includes(k));
  scores.specific = usesKeyInsight ? 9 : (content.length > 30 ? 5 : 2);
  if (!usesKeyInsight) issues.push("未引用用户的具体 keyInsight");

  // Personalized
  scores.personalized = usesKeyInsight ? 9 : 3;
  if (!usesKeyInsight) issues.push("不够个性化");

  // Inspiring: depth of thought
  const hasJudgment = /其实|本质上|关键|核心|真正/.test(content);
  scores.inspiring = hasJudgment ? 8 : (content.length > 40 ? 6 : 3);

  // Non-template: unique structure
  scores.non_template = bannedHits === 0 ? 8 : Math.max(2, 8 - bannedHits * 2);

  const avg = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;
  return { score: Math.round(avg * 10) / 10, issues, scores };
}

// ─── LLM Call Helper ───────────────────────────────────────────────────

async function callLLM(prompt: string): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.85,
        max_tokens: 2000,
      }),
  });
  const data = await res.json() as { error?: { message: string }; choices?: Array<{ message: { content: string } }> };
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content ?? "";
}

function parseInsights(text: string): Array<{ content: string; rationale?: string }> {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe("insight quality (prompt structure)", () => {
  it("buildInsightPrompt includes SPECIFIC FACTS anchor block", () => {
    const persona = makeFullStackDevPersona();
    const input = makeInput(["认知系统设计"]);
    const { prompt } = buildInsightPrompt(persona, input, [], []);

    expect(prompt).toContain("SPECIFIC FACTS");
    expect(prompt).toContain("PRISM门控");
    expect(prompt).toContain("SIRI循环");
    expect(prompt).toContain("Zod验证");
  });

  it("buildInsightPrompt includes STRUCTURE CONSTRAINT", () => {
    const persona = makeFullStackDevPersona();
    const input = makeInput(["认知系统设计"]);
    const { prompt } = buildInsightPrompt(persona, input, [], []);

    expect(prompt).toContain("STRUCTURE CONSTRAINT");
  });

  it("buildInsightPrompt sorts domains by recency (most active first)", () => {
    const persona = makeFullStackDevPersona();
    const input = makeInput(["认知系统设计"]);
    const { prompt } = buildInsightPrompt(persona, input, [], []);

    const tsIdx = prompt.indexOf("TypeScript");
    const feishuIdx = prompt.indexOf("飞书集成");
    expect(tsIdx).toBeLessThan(feishuIdx);
  });

  it("buildInsightPrompt includes banned patterns list", () => {
    const persona = makeFullStackDevPersona();
    const input = makeInput(["认知系统设计"]);
    const { prompt } = buildInsightPrompt(persona, input, [], []);

    expect(prompt).toContain("值得关注");
    expect(prompt).toContain("你有没有想过");
    expect(prompt).toContain("有趣的是");
  });

  it("buildInsightPrompt includes past insights for anti-repetition", () => {
    const persona = makeFullStackDevPersona();
    const input = makeInput(["认知系统设计"]);
    const pastInsights = ["Python的GIL被人骂了这么多年，但换个角度看..."];
    const { prompt } = buildInsightPrompt(persona, input, [], pastInsights);

    expect(prompt).toContain("PAST INSIGHTS");
    expect(prompt).toContain("Python");
  });

  it("buildInsightPrompt includes dynamic opening bans from past insights", () => {
    const persona = makeFullStackDevPersona();
    const input = makeInput(["认知系统设计"]);
    const pastInsights = ["Rust的借用检查器被骂学习曲线陡"];
    const { prompt } = buildInsightPrompt(persona, input, [], pastInsights);

    expect(prompt).toContain("不要以");
  });

  it("isSubstantiveContent rejects known template patterns", () => {
    expect(isSubstantiveContent("值得关注")).toBe(false);
    expect(isSubstantiveContent("挺有意思的")).toBe(false);
    expect(isSubstantiveContent("被人骂了但换个角度看")).toBe(false);
    expect(isSubstantiveContent("你有没有想过这个问题")).toBe(false);
    expect(isSubstantiveContent("最近在关注这个方向")).toBe(false);
    expect(isSubstantiveContent("有趣的是")).toBe(false);
  });

  it("isSubstantiveContent accepts substantive content", () => {
    expect(isSubstantiveContent("PRISM门控的成本敏感设计让你可以用false alarm rate来控制推送频率")).toBe(true);
    expect(isSubstantiveContent("Zod验证在插件SDK里解决了类型和运行时不一致的问题")).toBe(true);
  });

  it("buildInsightPrompt includes domain depth in recency tags", () => {
    const persona = makeFullStackDevPersona();
    const input = makeInput(["认知系统设计"]);
    const { prompt } = buildInsightPrompt(persona, input, [], []);

    expect(prompt).toContain("depth: 5");
    expect(prompt).toContain("depth: 3");
  });
});

describe.skipIf(!isLive || !ZAI_API_KEY)("insight quality (live LLM)", () => {
  const ROUNDS = 3;

  it(`generates non-template personalized insights across ${ROUNDS} rounds`, async () => {
    const persona = makeFullStackDevPersona();
    const results: Array<{ round: number; content: string; score: number; issues: string[] }> = [];

    for (let round = 1; round <= ROUNDS; round++) {
      const input = makeInput(["认知系统设计"]);
      const { prompt } = buildInsightPrompt(persona, input, [], persona.feedbackProfile.recentInsightContents);
      const raw = await callLLM(prompt);
      const insights = parseInsights(raw);

      expect(insights.length).toBeGreaterThan(0);

      for (const insight of insights) {
        const content = insight.content ?? "";
        expect(content.length).toBeGreaterThan(10);
        expect(isSubstantiveContent(content)).toBe(true);
        expect(content).not.toMatch(/[？?]$/);

        const eval_ = evaluateQuality(content, persona);
        results.push({ round, content, score: eval_.score, issues: eval_.issues });
      }
    }

    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
    console.log(`\n  Average quality score: ${avgScore.toFixed(1)}/10 across ${results.length} insights`);

    const allIssues = results.flatMap(r => r.issues);
    const uniqueIssues = [...new Set(allIssues)];
    if (uniqueIssues.length > 0) {
      console.log("  Issues found:", uniqueIssues.join("; "));
    }

    // Quality gate: average must be ≥ 7.0
    expect(avgScore).toBeGreaterThanOrEqual(7.0);

    // Non-template check: no two insights should share the same first 10 chars
    const openings = results.map(r => r.content.slice(0, 10));
    const uniqueOpenings = new Set(openings);
    expect(uniqueOpenings.size).toBeGreaterThan(results.length * 0.5);
  }, 300_000);
});

describe("insight pipeline validation (mock LLM)", () => {
  const persona = makeFullStackDevPersona();
  const input = makeInput(["认知系统设计"]);

  const BAD_INSIGHTS = [
    {
      label: "被人X但换个角度 template",
      content: "Python的GIL被人骂了这么多年，但换个角度看它其实做对了一件事——它让单线程的心智模型就能写出正确的并发代码。",
      shouldFilter: true,
    },
    {
      label: "值得关注 template",
      content: "最近出现一些值得关注的新方向，结合你在这个领域的深度理解，可能会影响你的技术决策。",
      shouldFilter: true,
    },
    {
      label: "你有没有想过 template",
      content: "你有没有想过，TypeScript的类型系统其实在很多方面已经超越了Java？挺有意思的。",
      shouldFilter: true,
    },
    {
      label: "换个角度来看 template",
      content: "换个角度来看，Rust的借用检查器其实就是在做轻量级形式化验证，这是大多数语言不敢做的事。",
      shouldFilter: true,
    },
    {
      label: "generic '关于X' opener",
      content: "关于认知系统设计，最近在关注一些新的方向，有趣的是PRISM门控和SIRI循环的结合。",
      shouldFilter: true,
    },
    {
      label: "generic '在X领域' opener",
      content: "在认知系统设计领域，结合你在这个领域的深度理解，不得不说跨域洞察是最值得关注的方向。",
      shouldFilter: true,
    },
  ];

  const GOOD_INSIGHTS = [
    {
      label: "specific persona-anchored insight with keyInsight",
      content: "PRISM门控的成本敏感设计让你可以用false alarm rate来控制推送频率——如果你把cFa降到0.2，洞察几乎不会被打扰，但sensitivity也会掉到0.4，这意味着你每10次SIRI循环只能抓到4个真正有价值的洞察。",
      minScore: 7,
    },
    {
      label: "cross-domain with concrete connection",
      content: "Zod验证在插件SDK里解决的问题和你PRISM门控里的cost function是同一类问题——两者都是在做trust boundary的validation，只不过一个在类型层一个在决策层。",
      minScore: 7,
    },
    {
      label: "practical action tied to recentFocus",
      content: "你最近在调Persona提取过滤器，可以试试把keyInsight的置信度阈值从0.5降到0.3——SIRI循环的resolve阶段会因为拿到更多锚点而生成更具体的洞察，代价是偶尔会有噪声。",
      minScore: 7,
    },
  ];

  for (const bad of BAD_INSIGHTS) {
    it(`isSubstantiveContent filters out: ${bad.label}`, () => {
      const result = isSubstantiveContent(bad.content);
      expect(result).toBe(!bad.shouldFilter);
    });
  }

  for (const good of GOOD_INSIGHTS) {
    it(`evaluates "${good.label}" at ≥ ${good.minScore}/10`, () => {
      const eval_ = evaluateQuality(good.content, persona);
      expect(eval_.score).toBeGreaterThanOrEqual(good.minScore);
    });
  }

  it("all GOOD insights pass isSubstantiveContent", () => {
    for (const good of GOOD_INSIGHTS) {
      expect(isSubstantiveContent(good.content)).toBe(true);
    }
  });

  it("prompt contains enough context for the LLM to produce GOOD-style insights", () => {
    const { prompt } = buildInsightPrompt(persona, input, [], persona.feedbackProfile.recentInsightContents);

    // Must include specific facts that GOOD insights reference
    expect(prompt).toContain("PRISM门控");
    expect(prompt).toContain("SIRI循环");
    expect(prompt).toContain("Zod验证");
    expect(prompt).toContain("Persona双通道提取");
    expect(prompt).toContain("认知层洞察质量优化");
    expect(prompt).not.toContain("如何让洞察更个性化而非模板化");

    // Must include anti-patterns
    expect(prompt).toContain("值得关注");

    // Must include structure constraint
    expect(prompt).toContain("STRUCTURE CONSTRAINT");
  });

  it("generates different prompt frames across multiple calls (structural variety)", () => {
    const frames = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { prompt } = buildInsightPrompt(persona, input, [], []);
      const taskMatch = prompt.match(/TASK:\n([\s\S]*?)\n\n ?STRUCTURE/);
      if (taskMatch) frames.add(taskMatch[1]!.trim());
    }
    // With 8 frames × random pick × random keyInsight, we should see variety
    expect(frames.size).toBeGreaterThanOrEqual(4);
  });

  it("generates different structure seeds across multiple calls", () => {
    const seeds = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { prompt } = buildInsightPrompt(persona, input, [], []);
      const seedMatch = prompt.match(/STRUCTURE CONSTRAINT:\n(.*)/);
      if (seedMatch) seeds.add(seedMatch[1]!.trim());
    }
    expect(seeds.size).toBeGreaterThanOrEqual(4);
  });

  it("banned patterns list covers all known template patterns from past insights", () => {
    const pastTemplates = [
      "Python的GIL被人骂了这么多年，但换个角度看",
      "Rust的借用检查器被骂学习曲线陡，但它其实在做",
      "Go的error处理被人吐槽写起来啰嗦，但它和Rust",
    ];
    for (const template of pastTemplates) {
      expect(isSubstantiveContent(template)).toBe(false);
    }
  });
});
