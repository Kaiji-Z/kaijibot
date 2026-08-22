/**
 * Live insight quality test — real LLM + real web search.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 pnpm test src/cognitive/insight/insight-live-quality.test.ts
 */

import { describe, it, expect } from "vitest";
import { createSupervisor, type SupervisionResult } from "../../../test/helpers/eval/supervisor.js";
import type { PersonaTree } from "../types.js";
import type { Fragment, FragmentCluster } from "./fragment-types.js";
import {
  buildInsightPrompt,
  buildPatternInsightPrompt,
  isSubstantiveContent,
  GENERIC_INSIGHT_PATTERNS,
} from "./llm-engine.js";
import type { WebSearchResult } from "./llm-engine.js";
import type { InsightEngineInput } from "./types.js";

// §3.2 clean-context judge wiring (VERIFICATION.md Layer 2). The judge sees ONLY
// the frozen acceptance text below + the generated insight — never the code,
// persona fixture, or prompt. Expected text frozen from docs/ACCEPTANCE.md §1.
const EXPECTED_INSIGHT = [
  "The system proactively pushes an insight to the user.",
  "It references at least one real domain from the user's actual interests",
  "(e.g. cognitive-system design, TypeScript, MCP, Rust, Feishu integration).",
  "It reads like a friend sharing a thought in natural conversational Chinese,",
  "not a formal report or notification.",
  "It is semantically distinct from prior insights already delivered.",
  "Web-search evidence, if cited, appears as supporting context (e.g. 根据 [0]),",
  "never as an imperative instruction to the user.",
  "It MUST NOT: invent domains the user never expressed interest in, contain",
  "citation-index leaks like [12], or include commands directed at the user",
  "(click / download / transfer money / share API key).",
].join(" ");

const EXPECTED_PATTERN_INSIGHT = [
  "The system shares a behavioral observation about the user's own thinking pattern,",
  "grounded in these observed fragments: a methodological habit of reaching for a",
  "default solution (caching) before analyzing the bottleneck; a gap between stated",
  "priority (ship fast) and actual choices (optimize for completeness); a hidden",
  "assumption that every problem has an elegant abstraction.",
  "It is phrased as a personal, tentative observation about the user in natural",
  "conversational Chinese — not a generic productivity tip, not a command, and not",
  "a restatement of one fragment as a bullet point.",
].join(" ");

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";

function makePersona(): PersonaTree {
  const now = Date.now();
  return {
    identity: {
      displayName: "凯机",
      coreTraits: {
        technical: {
          value: "高",
          confidence: 0.9,
          evidenceCount: 10,
          lastUpdated: now,
          source: "inferred",
        },
        style: {
          value: "务实",
          confidence: 0.8,
          evidenceCount: 5,
          lastUpdated: now,
          source: "observed",
        },
      },
      expertDomains: ["AI/机器学习", "软件架构"],
      interestDomains: ["认知架构", "产品思维"],
      curiosityDomains: [],
    },
    domains: {
      认知系统设计: {
        depth: 5,
        recurrence: 12,
        lastMentioned: now - 1000 * 60 * 30,
        keyInsights: ["PRISM门控", "SIRI循环", "Persona双通道提取"],
        activeQuestions: [],
        negationSignals: 0,
      },
      TypeScript: {
        depth: 5,
        recurrence: 20,
        lastMentioned: now - 1000 * 60 * 10,
        keyInsights: ["decorator pattern", "Zod schema validation"],
        activeQuestions: [],
        negationSignals: 0,
      },
      MCP: {
        depth: 3,
        recurrence: 5,
        lastMentioned: now - 1000 * 60 * 60,
        keyInsights: ["Model Context Protocol", "tool schema design"],
        activeQuestions: [],
        negationSignals: 0,
      },
      Rust: {
        depth: 4,
        recurrence: 8,
        lastMentioned: now - 1000 * 60 * 45,
        keyInsights: ["borrow checker", "zero-cost abstractions"],
        activeQuestions: [],
        negationSignals: 0,
      },
      飞书集成: {
        depth: 4,
        recurrence: 8,
        lastMentioned: now - 1000 * 60 * 60,
        keyInsights: ["WebSocket长连接", "消息卡片"],
        activeQuestions: [],
        negationSignals: 0,
      },
    },
    recentFocus: ["认知层洞察质量优化", "Web UI 精简", "LLM prompt调试"],
    feedbackProfile: {
      topicBandits: {},
      optimalFrequencyHours: 2,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [
        "Python的GIL被人骂了这么多年，但换个角度看它其实做对了一件事...",
        "Rust的借用检查器被骂学习曲线陡，但它其实在做一件很罕见的事...",
      ],
      recentInsightDomains: [],
      recentInsightTypes: [],
    },
    rapport: {
      trustScore: 0.85,
      totalExchanges: 428,
      avgResponseLength: 235,
      selfDisclosureLevel: 1,
    },
    moodHistory: [],
    domainBlacklist: [],
    lifecycle: {
      stage: "active",
      lastActiveAt: now,
      lastStageTransitionAt: now,
      totalActiveDays: 30,
    },
    calibrationHistory: [],
  };
}

function makeInput(targetDomains: string[]): InsightEngineInput {
  return {
    targetDomains,
    recentFocus: ["认知层洞察质量优化", "Web UI 精简"],
    trustScore: 0.85,
    recentInsightIds: [],
    recentInsightContents: [
      "Python的GIL被人骂了这么多年，但换个角度看它其实做对了一件事...",
      "Rust的借用检查器被骂学习曲线陡，但它其实在做一件很罕见的事...",
    ],
  };
}

async function tavilySearch(query: string): Promise<WebSearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      max_results: 5,
      include_answer: false,
    }),
  });
  const data = (await res.json()) as {
    results?: Array<{ title: string; url: string; content: string }>;
  };
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content.slice(0, 200),
  }));
}

async function callLLM(prompt: string): Promise<string> {
  const res = await fetch(ZAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.85,
      max_tokens: 2000,
    }),
  });
  const data = (await res.json()) as {
    error?: { message: string };
    choices?: Array<{ message: { content: string } }>;
  };
  if (data.error) {
    throw new Error(data.error.message);
  }
  return data.choices?.[0]?.message?.content ?? "";
}

function parseInsights(text: string): Array<{
  content: string;
  rationale?: string;
  targetDomains?: string[];
  surpriseScore?: number;
}> {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr.map((item: { content?: string }) => ({
      ...item,
      content: (item.content ?? "").replace(/\[\d+\]/g, ""),
    }));
  } catch {
    return [];
  }
}

type QualityReport = {
  content: string;
  hasKeyInsight: boolean;
  isNatural: boolean;
  isSpecific: boolean;
  hasFirstPerson: boolean;
  hasUncertainty: boolean;
  hasConversationalMarker: boolean;
  hasQuestion: boolean;
  hasIndexLeak: boolean;
  hasEmDash: boolean;
  bannedPatterns: string[];
  length: number;
  score: number;
};

function evaluateInsight(content: string, persona: PersonaTree): QualityReport {
  const allKeyInsights = Object.values(persona.domains).flatMap((d) => d.keyInsights);
  const bannedHits = GENERIC_INSIGHT_PATTERNS.filter((p) => p.test(content));

  const hasKeyInsight = allKeyInsights.some((k) => content.includes(k));
  const isNatural = bannedHits.length === 0;
  const isSpecific = content.length > 20 && !/泛泛|方向|值得|关注/.test(content);
  const hasFirstPerson = /我|I /.test(content);
  const hasUncertainty = /不太确定|可能|会不会|也许|大概|说不好|牵强/.test(content);
  const hasConversationalMarker =
    /刚看到|刚想到|突然觉得|说真的|老实说|你猜|信不信| honestly|actually/.test(content);
  const hasQuestion = /[？?]/.test(content);
  const hasIndexLeak = /\[\d+\]/.test(content);
  const hasEmDash = content.includes("——");

  let score = 0;
  if (hasKeyInsight) {
    score += 2;
  }
  if (isNatural) {
    score += 2;
  }
  if (isSpecific) {
    score += 2;
  }
  if (hasFirstPerson) {
    score += 1;
  }
  if (hasUncertainty || hasConversationalMarker) {
    score += 1;
  }
  if (content.length >= 30 && content.length <= 300) {
    score += 1;
  }
  if (!hasIndexLeak) {
    score += 1;
  }

  return {
    content,
    hasKeyInsight,
    isNatural,
    isSpecific,
    hasFirstPerson,
    hasUncertainty,
    hasConversationalMarker,
    hasQuestion,
    hasIndexLeak,
    hasEmDash,
    bannedPatterns: bannedHits.map((p) => p.source),
    length: content.length,
    score,
  };
}

// ═════════════════════════════════════════════════════════════════════════

describe.skipIf(!isLive || !ZAI_API_KEY || !TAVILY_API_KEY)(
  "live insight quality — real LLM + real web search",
  () => {
    const ROUNDS = 3;
    const TARGET_DOMAINS = ["认知系统设计", "TypeScript", "MCP", "Rust"];
    const { supervise } = createSupervisor({ generateText: callLLM });
    const supervisions: SupervisionResult[] = [];

    it(`generates ${ROUNDS} rounds of insights and evaluates quality`, async () => {
      const persona = makePersona();
      const reports: QualityReport[] = [];
      const rawInsights: string[] = [];

      for (let round = 1; round <= ROUNDS; round++) {
        const targetDomain = TARGET_DOMAINS[(round - 1) % TARGET_DOMAINS.length]!;
        const input = makeInput([targetDomain]);

        const searchQuery = `${targetDomain} 最新进展 2026`;
        const webResults = await tavilySearch(searchQuery);

        const { prompt } = buildInsightPrompt(
          persona,
          input,
          webResults,
          persona.feedbackProfile.recentInsightContents,
        );
        const raw = await callLLM(prompt);
        const insights = parseInsights(raw);

        if (insights.length === 0) {
          console.log(
            `\n  [Round ${round}] LLM returned no parseable insights. Raw: ${raw.slice(0, 200)}`,
          );
          continue;
        }

        for (const insight of insights) {
          const content = insight.content ?? "";
          if (content.length < 10) {
            continue;
          }

          const report = evaluateInsight(content, persona);
          reports.push(report);
          rawInsights.push(content);

          console.log(`\n  [Round ${round} | ${targetDomain}]`);
          console.log(`  洞察: ${content}`);
          console.log(
            `  质量: ${report.score}/10 | keyInsight: ${report.hasKeyInsight} | 第一人称: ${report.hasFirstPerson} | 不确定: ${report.hasUncertainty} | 口语: ${report.hasConversationalMarker} | 问号: ${report.hasQuestion} | [N]泄漏: ${report.hasIndexLeak} | 长度: ${report.length}`,
          );
          if (report.bannedPatterns.length > 0) {
            console.log(`  ⚠ 模板句式: ${report.bannedPatterns.join(", ")}`);
          }
          console.log(`  Web搜索: ${webResults.length} results for "${searchQuery}"`);
          if (webResults.length > 0) {
            console.log(`  搜索样例: ${webResults[0]!.title}`);
          }
        }

        const supervision = await supervise({
          expected: EXPECTED_INSIGHT,
          actual: insights[0]!.content ?? "",
          artifactKind: "proactive insight (knowledge mode)",
        });
        supervisions.push(supervision);
        console.log(
          `  Supervisor: ${supervision.passed ? "PASS" : "FAIL"} (mean ${supervision.mean.toFixed(2)}) ` +
            Object.entries(supervision.scores)
              .map(([d, s]) => `${d}=${s.toFixed(2)}`)
              .join(" "),
        );
        if (supervision.deductions.length > 0) {
          console.log(`  Supervisor deductions: ${supervision.deductions.join("; ")}`);
        }

        if (insights[0]) {
          persona.feedbackProfile.recentInsightContents.push(insights[0].content);
          if (persona.feedbackProfile.recentInsightContents.length > 5) {
            persona.feedbackProfile.recentInsightContents =
              persona.feedbackProfile.recentInsightContents.slice(-5);
          }
        }
      }

      console.log(`\n  ═════════════════════════════════════════`);
      console.log(`  总计 ${reports.length} 条洞察, ${ROUNDS} 轮`);

      const avgScore = reports.reduce((sum, r) => sum + r.score, 0) / reports.length;
      console.log(`  平均质量分: ${avgScore.toFixed(1)}/10`);

      const keyInsightRate = reports.filter((r) => r.hasKeyInsight).length / reports.length;
      console.log(`  引用 keyInsight 比率: ${(keyInsightRate * 100).toFixed(0)}%`);

      const naturalRate = reports.filter((r) => r.isNatural).length / reports.length;
      console.log(`  无模板句式比率: ${(naturalRate * 100).toFixed(0)}%`);

      const firstPersonRate = reports.filter((r) => r.hasFirstPerson).length / reports.length;
      console.log(`  第一人称使用率: ${(firstPersonRate * 100).toFixed(0)}%`);

      const uncertaintyRate = reports.filter((r) => r.hasUncertainty).length / reports.length;
      console.log(`  不确定性表达率: ${(uncertaintyRate * 100).toFixed(0)}%`);

      const conversationalRate =
        reports.filter((r) => r.hasConversationalMarker).length / reports.length;
      console.log(`  对话标记率: ${(conversationalRate * 100).toFixed(0)}%`);

      const questionRate = reports.filter((r) => r.hasQuestion).length / reports.length;
      console.log(`  问号使用率: ${(questionRate * 100).toFixed(0)}%`);

      const indexLeakRate = reports.filter((r) => r.hasIndexLeak).length / reports.length;
      console.log(`  [N]泄漏率: ${(indexLeakRate * 100).toFixed(0)}%`);

      const emDashRate = reports.filter((r) => r.hasEmDash).length / reports.length;
      console.log(`  破折号(——)率: ${(emDashRate * 100).toFixed(0)}%`);
      console.log(`  ═════════════════════════════════════════\n`);

      expect(reports.length).toBeGreaterThanOrEqual(ROUNDS);
      expect(avgScore).toBeGreaterThanOrEqual(6.0);
      expect(keyInsightRate).toBeGreaterThanOrEqual(0.5);
      expect(naturalRate).toBeGreaterThanOrEqual(0.7);
      expect(indexLeakRate).toBe(0);

      for (const s of supervisions) {
        expect(s.passed, `supervisor rejected insight: ${s.deductions.join("; ")}`).toBe(true);
      }

      const openings = rawInsights.map((c) => c.slice(0, 8));
      const uniqueOpenings = new Set(openings);
      expect(uniqueOpenings.size).toBeGreaterThanOrEqual(Math.ceil(rawInsights.length * 0.5));
    }, 300_000);
  },
);

// ═════════════════════════════════════════════════════════════════════════

describe.skipIf(!isLive || !ZAI_API_KEY)("pattern mode", () => {
  const { supervise } = createSupervisor({ generateText: callLLM });

  function makeFragments(): Fragment[] {
    const now = Date.now();
    return [
      {
        id: "f1",
        userId: "u1",
        createdAt: now - 3600000,
        expiresAt: now + 86400000,
        kind: "methodological_habit" as const,
        evidence: "每次遇到性能问题都先加缓存而不是分析瓶颈",
        domains: ["TypeScript", "认知系统设计"],
        structuralTag: "default_solution",
        strength: 0.7,
      },
      {
        id: "f2",
        userId: "u1",
        createdAt: now - 7200000,
        expiresAt: now + 86400000,
        kind: "implicit_priority" as const,
        evidence: "嘴上说想快速上线，但架构选择都优化完备性",
        domains: ["软件架构"],
        structuralTag: "stated_vs_actual",
        strength: 0.8,
      },
      {
        id: "f3",
        userId: "u1",
        createdAt: now - 10800000,
        expiresAt: now + 86400000,
        kind: "assumption" as const,
        evidence: "默认认为所有问题都有优雅的抽象解法",
        domains: ["Rust", "TypeScript"],
        structuralTag: "hidden_assumption",
        strength: 0.6,
      },
    ];
  }

  function makeFragmentClusters(): FragmentCluster[] {
    const now = Date.now();
    return [
      {
        id: "c1",
        fragmentIds: ["f1", "f3"],
        domains: ["TypeScript", "Rust"],
        structuralPattern: "over_engineering_tendency",
        averageStrength: 0.65,
        createdAt: now,
      },
    ];
  }

  function makePatternInput(): InsightEngineInput {
    return {
      targetDomains: ["认知系统设计", "TypeScript"],
      recentFocus: ["认知层洞察质量优化"],
      trustScore: 0.85,
      recentInsightIds: [],
      recentInsightContents: ["Python的GIL被人骂了这么多年，但换个角度看它其实做对了一件事..."],
      mode: "pattern",
      fragments: makeFragments(),
      fragmentClusters: makeFragmentClusters(),
    };
  }

  it("generates behavioral insight from fragments", async () => {
    const persona = makePersona();
    const input = makePatternInput();

    const { prompt } = buildPatternInsightPrompt(
      persona,
      input,
      persona.feedbackProfile.recentInsightContents,
    );
    const raw = await callLLM(prompt);
    const insights = parseInsights(raw);

    console.log(`\n  [pattern mode] LLM returned ${insights.length} insight(s)`);
    for (const ins of insights) {
      console.log(`  洞察: ${ins.content}`);
    }

    expect(insights.length).toBeGreaterThanOrEqual(1);

    const content = insights[0]!.content ?? "";
    expect(content.length).toBeGreaterThan(20);
    expect(isSubstantiveContent(content)).toBe(true);

    const supervision = await supervise({
      expected: EXPECTED_PATTERN_INSIGHT,
      actual: content,
      artifactKind: "proactive insight (pattern mode)",
    });
    console.log(
      `  Supervisor: ${supervision.passed ? "PASS" : "FAIL"} (mean ${supervision.mean.toFixed(2)})`,
    );
    if (supervision.deductions.length > 0) {
      console.log(`  Supervisor deductions: ${supervision.deductions.join("; ")}`);
    }
    expect(
      supervision.passed,
      `supervisor rejected pattern insight: ${supervision.deductions.join("; ")}`,
    ).toBe(true);

    const bannedHits = GENERIC_INSIGHT_PATTERNS.filter((p) => p.test(content));
    expect(bannedHits.length).toBe(0);
  }, 120_000);

  it("buildPatternInsightPrompt includes fragment observations", () => {
    const persona = makePersona();
    const input = makePatternInput();

    const { prompt } = buildPatternInsightPrompt(persona, input, []);

    expect(prompt).toContain("OBSERVED THINKING PATTERNS");
    expect(prompt).toContain("methodological_habit");
    expect(prompt).toContain("default_solution");
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("behavioral observation");
  });

  it("pattern prompt avoids formulaic structure across rounds", async () => {
    const persona = makePersona();
    const openings: string[] = [];

    for (let round = 0; round < 3; round++) {
      const input = makePatternInput();
      const { prompt } = buildPatternInsightPrompt(
        persona,
        input,
        persona.feedbackProfile.recentInsightContents,
      );
      const raw = await callLLM(prompt);
      const insights = parseInsights(raw);

      if (insights.length > 0 && insights[0]!.content) {
        openings.push(insights[0]!.content.trim().slice(0, 10));
        console.log(
          `  [pattern round ${round + 1}] 开头: ${insights[0]!.content.trim().slice(0, 20)}...`,
        );
      }
    }

    expect(openings.length).toBeGreaterThanOrEqual(2);

    const uniqueOpenings = new Set(openings);
    expect(uniqueOpenings.size).toBeGreaterThanOrEqual(2);
  }, 360_000);
});
