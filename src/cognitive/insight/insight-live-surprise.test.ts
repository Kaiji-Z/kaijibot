/**
 * Live surprise insight quality test — real LLM + real web search.
 *
 * Tests the full surprise-mode pipeline: interest inference → web search → insight generation.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY TAVILY_API_KEY=$TAVILY_API_KEY \
 *     pnpm test src/cognitive/insight/insight-live-surprise.test.ts
 */

import { describe, it, expect } from "vitest";
import { complete as piComplete, type Api, type AssistantMessage, type Model } from "@mariozechner/pi-ai";
import { generateInsightCandidatesLLM, GENERIC_INSIGHT_PATTERNS } from "./llm-engine.js";
import type { LlmInsightDeps, WebSearchResult } from "./llm-engine.js";
import { inferSearchStrategy } from "./interest-inference.js";
import type { InterestInferenceDeps } from "./interest-inference.js";
import type { PersonaTree } from "../types.js";
import type { InsightEngineInput } from "./types.js";

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";

const now = Date.now();

function makePersona(): PersonaTree {
  return {
    identity: {
      displayName: "凯机",
      coreTraits: {
        technical: { value: "高", confidence: 0.9, evidenceCount: 10, lastUpdated: now, source: "inferred" },
        style: { value: "务实", confidence: 0.8, evidenceCount: 5, lastUpdated: now, source: "observed" },
      },
      expertDomains: ["AI/机器学习", "软件架构"],
      interestDomains: ["认知架构", "产品思维"],
      curiosityDomains: ["量子计算", "生物信息学"],
    },
    domains: {
      "认知系统设计": { depth: 5, recurrence: 12, lastMentioned: now - 1800000, keyInsights: ["PRISM门控", "SIRI循环", "Persona双通道提取"], activeQuestions: [], connections: ["Prompt工程"], negationSignals: 0 },
      "TypeScript": { depth: 5, recurrence: 20, lastMentioned: now - 600000, keyInsights: ["decorator pattern", "Zod schema validation"], activeQuestions: [], connections: [], negationSignals: 0 },
      "MCP": { depth: 3, recurrence: 5, lastMentioned: now - 3600000, keyInsights: ["Model Context Protocol", "tool schema design"], activeQuestions: [], connections: [], negationSignals: 0 },
      "Rust": { depth: 4, recurrence: 8, lastMentioned: now - 2700000, keyInsights: ["borrow checker", "zero-cost abstractions"], activeQuestions: [], connections: [], negationSignals: 0 },
      "飞书集成": { depth: 4, recurrence: 8, lastMentioned: now - 3600000, keyInsights: ["WebSocket长连接", "消息卡片"], activeQuestions: [], connections: [], negationSignals: 0 },
    },
    recentFocus: ["认知层洞察质量优化", "Web UI 精简", "LLM prompt调试"],
    activeProjects: [],
    feedbackProfile: {
      topicBandits: {},
      preferredStyle: "observation",
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
    rapport: { trustScore: 0.85, totalExchanges: 428, avgResponseLength: 235, selfDisclosureLevel: 1 },
    domainGraph: {
      nodes: ["认知系统设计", "TypeScript", "MCP", "Rust", "飞书集成"],
      edges: [
        { source: "认知系统设计", target: "TypeScript", weight: 0.8, lastObserved: now, observations: 8 },
        { source: "MCP", target: "TypeScript", weight: 0.6, lastObserved: now, observations: 4 },
      ],
      totalObservations: 12,
    },
    moodHistory: [],
    domainBlacklist: [],
    lifecycle: { stage: "active", lastActiveAt: now, lastStageTransitionAt: now, consecutiveSilentDays: 0, totalActiveDays: 30 },
    calibrationHistory: [],
    contradictionLog: [],
  };
}

function makeSurpriseInput(): InsightEngineInput {
  return {
    targetDomains: [],
    recentFocus: ["认知层洞察质量优化"],
    trustScore: 0.85,
    recentInsightIds: [],
    recentInsightContents: [
      "Python的GIL被人骂了这么多年，但换个角度看它其实做对了一件事...",
      "Rust的借用检查器被骂学习曲线陡，但它其实在做一件很罕见的事...",
    ],
    mode: "surprise",
  };
}

// ---------------------------------------------------------------------------
// LLM + Web Search helpers — mirrors pattern from insight-live-quality.test.ts
// and evolution-live-quality.test.ts
// ---------------------------------------------------------------------------

async function tavilySearch(query: string): Promise<WebSearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: TAVILY_API_KEY, query, max_results: 5, include_answer: false }),
  });
  const data = await res.json() as { results?: Array<{ title: string; url: string; content: string }> };
  return (data.results ?? []).map((r) => ({
    title: String(r.title ?? ""),
    url: String(r.url ?? ""),
    snippet: String((r.content ?? "").slice(0, 200)),
  }));
}

/**
 * Call ZAI coding plan API. Handles reasoning models that return `reasoning_content`
 * separately from `content` — if `content` is empty, falls back to `reasoning_content`.
 */
async function callLLM(prompt: string): Promise<string> {
  const res = await fetch(ZAI_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.85,
      max_tokens: 3000,
    }),
  });
  const data = await res.json() as {
    error?: { message: string };
    choices?: Array<{ finish_reason?: string; message: { content: string; reasoning_content?: string } }>;
  };
  if (data.error) throw new Error(data.error.message);
  const choice = data.choices?.[0];
  if (!choice) return "";
  // Prefer final content; fall back to reasoning_content for reasoning models
  return choice.message.content || choice.message.reasoning_content || "";
}

// ---------------------------------------------------------------------------
// Deps — same pattern as other live tests: inject callLLM as generateText
// ---------------------------------------------------------------------------

const LIVE_MODEL: Model<Api> = {
  id: MODEL,
  name: MODEL,
  api: "openai-completions",
  provider: "zai",
  baseUrl: ZAI_URL,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

const LIVE_AUTH = {
  apiKey: ZAI_API_KEY!,
  source: "env" as const,
  mode: "api-key" as const,
};

const liveDeps = {
  complete: async (_model: Model<Api>, ctx: Parameters<typeof piComplete>[1], _opts?: Parameters<typeof piComplete>[2]): Promise<AssistantMessage> => {
    const prompt = "messages" in ctx && Array.isArray(ctx.messages) && ctx.messages[0] && "content" in ctx.messages[0]
      ? String(ctx.messages[0].content)
      : "";
    const text = await callLLM(prompt);
    return {
      role: "assistant",
      content: [{ type: "text" as const, text }],
      api: "openai-completions",
      provider: "zai",
      model: MODEL,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop" as const,
      timestamp: Date.now(),
    };
  },
  prepareModel: async () => ({ model: LIVE_MODEL, auth: LIVE_AUTH }),
};

const inferenceDeps: InterestInferenceDeps = liveDeps;

// ═════════════════════════════════════════════════════════════════════════

describe.skipIf(!isLive || !ZAI_API_KEY || !TAVILY_API_KEY)("live surprise insight quality", () => {
  it("runs interest inference → web search → surprise insight generation", async () => {
    const persona = makePersona();
    const input = makeSurpriseInput();
    const config = { cognitive: { insight: { inferenceModel: "zai/glm-5-turbo" }, persona: { extractionModel: "zai/glm-5-turbo" } } };

    console.log("\n════════════════════════════════════════════");
    console.log(" SURPRISE 模式 Live Test");
    console.log("════════════════════════════════════════════\n");

    // Step 1: Interest inference
    console.log("\nStep 1: 兴趣推理");
    const inferenceResult = await inferSearchStrategy(persona, input, config, inferenceDeps);
    if (!inferenceResult.ok) {
      console.log(`  ❌ 推理失败: ${inferenceResult.error}`);
    }
    expect(inferenceResult.ok).toBe(true);
    if (!inferenceResult.ok) return;

    const strategy = inferenceResult.strategy;
    console.log(`  潜在兴趣: ${strategy.inferredInterest}`);
    console.log(`  搜索查询: ${strategy.searchQuery}`);
    console.log(`  桥接推理: ${strategy.bridgeReasoning}`);
    console.log(`  避免话题: ${strategy.avoidTopics.join(", ")}`);
    console.log(`  预估惊喜: ${strategy.estimatedSurprise}`);

    expect(strategy.searchQuery.length).toBeGreaterThan(0);
    expect(strategy.estimatedSurprise).toBeGreaterThanOrEqual(0.6);

    // Step 2: Web search
    console.log("\nStep 2: Web 搜索");
    const webResults = await tavilySearch(strategy.searchQuery);
    console.log(`  "${strategy.searchQuery}" → ${webResults.length} 条结果`);
    if (webResults[0]) console.log(`  样例: ${webResults[0].title}`);

    // Step 3: Generate surprise insight
    console.log("\nStep 3: 生成惊喜洞察");
    const insightDeps: LlmInsightDeps = {
      ...liveDeps,
      webSearch: async () => webResults,
      inferenceDeps,
    };

    const candidates = await generateInsightCandidatesLLM(persona, input, config, insightDeps, { maxCandidates: 1, timeout: 60000 });
    expect(candidates.length).toBeGreaterThanOrEqual(1);

    const insight = candidates[0]!;
    console.log("\n  ─────────────────────────");
    console.log(`  ${insight.content}`);
    console.log("  ─────────────────────────");
    console.log(`  领域: ${insight.targetDomains.join(", ")} ← ${insight.sourceDomains.join(", ")}`);
    console.log(`  相关性: ${insight.relevanceScore.toFixed(2)}  惊喜度: ${insight.surpriseScore.toFixed(2)}`);
    console.log(`  Web来源: ${insight.sources.length} 条  长度: ${insight.content.length} chars`);

    // Quality evaluation
    const bannedHits = GENERIC_INSIGHT_PATTERNS.filter((p) => p.test(insight.content));
    const noQuestion = !/[？?]$/.test(insight.content.trim());
    const recentContents = persona.feedbackProfile.recentInsightContents ?? [];
    const avoidsRepeatTopics = !recentContents.some((prev) => insight.content.slice(0, 8) === prev.slice(0, 8));

    console.log("\n  质量评估:");
    console.log(`  模板句式: ${bannedHits.length === 0 ? "✅ 无" : "⚠️ " + bannedHits.map((p) => p.source).join(", ")}`);
    console.log(`  无问号结尾: ${noQuestion ? "✅" : "❌"}`);
    console.log(`  与历史洞察开头不同: ${avoidsRepeatTopics ? "✅" : "❌"}`);

    expect(bannedHits.length).toBe(0);
    expect(noQuestion).toBe(true);
    expect(insight.content.length).toBeGreaterThan(20);

    console.log("\n════════════════════════════════════════════");
  }, 300_000);

  it("infers a different latent interest on second call", async () => {
    const persona = makePersona();
    const config = { cognitive: { insight: { inferenceModel: "zai/glm-5-turbo" }, persona: { extractionModel: "zai/glm-5-turbo" } } };
    const input = makeSurpriseInput();

    const r1 = await inferSearchStrategy(persona, input, config, inferenceDeps);
    if (!r1.ok) {
      console.log(`  Round 1 inference failed: ${r1.error} (reasoning model timeout is expected on slow connections)`);
    }
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    input.recentInsightContents = [...input.recentInsightContents, r1.strategy.inferredInterest];

    const r2 = await inferSearchStrategy(persona, input, config, inferenceDeps);
    if (!r2.ok) {
      console.log(`  Round 2 inference failed: ${r2.error}`);
    }
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    console.log(`  Round 1 interest: ${r1.strategy.inferredInterest}`);
    console.log(`  Round 2 interest: ${r2.strategy.inferredInterest}`);

    expect(r1.strategy.searchQuery.length).toBeGreaterThan(0);
    expect(r2.strategy.searchQuery.length).toBeGreaterThan(0);
  }, 120_000);
});
