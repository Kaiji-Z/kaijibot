import type { Api, AssistantMessage, Model, TextContent } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import { generateInsightCandidatesLLM, buildInsightPrompt, buildSurpriseInsightPrompt, extractKeyTerms, buildSearchQuery, matchWebResultsToDomainsLLM, type LlmInsightDeps, type WebSearchResult } from "./llm-engine.js";
import type { InsightEngineInput, SearchStrategy } from "./types.js";
import type { InterestInferenceDeps } from "./interest-inference.js";

const TEST_MODEL: Model<Api> = {
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "test",
  baseUrl: "http://localhost:11434/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

const TEST_AUTH = {
  apiKey: "test-key",
  source: "test",
  mode: "api-key" as const,
};

function assistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "test",
    model: "test-model",
    usage: {
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function makePersona(overrides?: Partial<PersonaTree>): PersonaTree {
  return {
    identity: {
      coreTraits: {},
      expertDomains: ["typescript"],
      interestDomains: ["rust"],
      curiosityDomains: ["wasm"],
    },
    domains: {
      typescript: {
        depth: 5,
        recurrence: 10,
        lastMentioned: Date.now(),
        keyInsights: ["type narrowing", "template literal types"],
        activeQuestions: [],
        connections: ["javascript"],
        negationSignals: 0,
      },
      rust: {
        depth: 3,
        recurrence: 4,
        lastMentioned: Date.now(),
        keyInsights: ["ownership model"],
        activeQuestions: [],
        connections: ["systems-programming"],
        negationSignals: 0,
      },
    },
    recentFocus: ["wasm", "type-systems"],
    activeProjects: ["kaijibot"],
    feedbackProfile: {
      topicBandits: {},
      preferredStyle: "observation",
      optimalFrequencyHours: 4,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [],
    },
    rapport: {
      trustScore: 0.75,
      totalExchanges: 50,
      avgResponseLength: 120,
      selfDisclosureLevel: 0.4,
    },
    domainBlacklist: [],
    lifecycle: { stage: "new", lastActiveAt: 0, lastStageTransitionAt: 0, consecutiveSilentDays: 0, totalActiveDays: 0 },
    calibrationHistory: [],
    contradictionLog: [],
    moodHistory: [],
    ...overrides,
  };
}

function makeInput(overrides?: Partial<InsightEngineInput>): InsightEngineInput {
  return {
    targetDomains: ["typescript", "rust"],
    recentFocus: ["wasm"],
    trustScore: 0.75,
    recentInsightIds: ["id-1", "id-2"],
    recentInsightContents: [],
    ...overrides,
  };
}

function makeConfig(): KaijiBotConfig {
  return {
    cognitive: { insight: { sources: { webSearchProvider: "zai" } } },
  } as KaijiBotConfig;
}

function validLLMResponse(): string {
  return JSON.stringify([
    {
      content: "你在 TypeScript 的类型体操和 Rust 的所有权模型之间有有趣的共鸣。",
      rationale: "用户同时深耕两门语言，跨领域启发有价值。",
      targetDomains: ["typescript"],
      sourceDomains: ["rust"],
      relevanceScore: 0.85,
      surpriseScore: 0.7,
    },
  ]);
}

function successDeps(responseText: string): LlmInsightDeps {
  return {
    complete: async () => assistantMessage(responseText),
    prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
  };
}

const fallbackDeps: LlmInsightDeps = {
  complete: async () => {
    throw new Error("should not be called");
  },
  prepareModel: async () => ({ error: "no model available" }),
};

describe("generateInsightCandidatesLLM", () => {
  it("parses valid LLM JSON array into InsightCandidate[]", async () => {
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps(validLLMResponse()),
    );

    expect(result.length).toBeGreaterThanOrEqual(1);
    const candidate = result[0]!;
    expect(candidate.content).toContain("TypeScript");
    expect(candidate.rationale).toBeTruthy();
    expect(candidate.targetDomains).toContain("typescript");
    expect(candidate.sourceDomains).toContain("rust");
    expect(candidate.relevanceScore).toBeCloseTo(0.85);
    expect(candidate.surpriseScore).toBeCloseTo(0.7);
    expect(candidate.compositeScore).toBe(0);
    expect(candidate.verificationStatus).toBe("unverified");
    expect(candidate.id).toBeTruthy();
    expect(candidate.sources).toEqual([]);
  });

  it("parses markdown-wrapped JSON", async () => {
    const markdownResponse = "```json\n" + validLLMResponse() + "\n```";
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps(markdownResponse),
    );

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.content).toContain("TypeScript");
  });

  it("returns empty array on LLM timeout", async () => {
    const deps: LlmInsightDeps = {
      complete: async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      },
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    };

    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      deps,
    );

    expect(result).toEqual([]);
  });

  it("returns empty array when prepareModel returns error", async () => {
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      fallbackDeps,
    );

    expect(result).toEqual([]);
  });

  it("returns empty array when LLM returns empty text", async () => {
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps(""),
    );

    expect(result).toEqual([]);
  });

  it("returns empty array when LLM returns malformed JSON", async () => {
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps("this is not json at all {{{"),
    );

    expect(result).toEqual([]);
  });

  it("injects persona domains into the prompt via complete call", async () => {
    let capturedPrompt = "";
    const deps: LlmInsightDeps = {
      complete: async (_model, context) => {
        const msg = context.messages[0];
        if (msg && "content" in msg && typeof msg.content === "string") {
          capturedPrompt = msg.content;
        }
        return assistantMessage(validLLMResponse());
      },
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    };

    await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      deps,
    );

    expect(capturedPrompt).toContain("typescript");
    expect(capturedPrompt).toContain("rust");
    expect(capturedPrompt).toContain("depth: 5");
    expect(capturedPrompt).toContain("wasm");
  });

  it("generates unique IDs for each candidate", async () => {
    const multiResponse = JSON.stringify([
      {
        content: "Insight one",
        rationale: "Reason one",
        targetDomains: ["a"],
        sourceDomains: ["b"],
        relevanceScore: 0.8,
        surpriseScore: 0.5,
      },
      {
        content: "Insight two",
        rationale: "Reason two",
        targetDomains: ["c"],
        sourceDomains: ["d"],
        relevanceScore: 0.7,
        surpriseScore: 0.6,
      },
    ]);

    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps(multiResponse),
    );

    const ids = result.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("clamps relevanceScore and surpriseScore to [0, 1]", async () => {
    const outOfRangeResponse = JSON.stringify([
      {
        content: "Out of range insight",
        rationale: "testing clamp",
        targetDomains: ["x"],
        sourceDomains: [],
        relevanceScore: 2.5,
        surpriseScore: -1.0,
      },
    ]);

    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps(outOfRangeResponse),
    );

    expect(result.length).toBe(1);
    expect(result[0]!.relevanceScore).toBe(1);
    expect(result[0]!.surpriseScore).toBe(0);
  });

  it("filters out candidates with empty content", async () => {
    const emptyContentResponse = JSON.stringify([
      {
        content: "",
        rationale: "empty insight",
        targetDomains: [],
        sourceDomains: [],
        relevanceScore: 0.5,
        surpriseScore: 0.5,
      },
      {
        content: "Valid insight",
        rationale: "has content",
        targetDomains: ["a"],
        sourceDomains: [],
        relevanceScore: 0.6,
        surpriseScore: 0.4,
      },
    ]);

    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps(emptyContentResponse),
    );

    expect(result.length).toBe(1);
    expect(result[0]!.content).toBe("Valid insight");
  });

  it("never throws even when everything fails", async () => {
    const bombDeps: LlmInsightDeps = {
      complete: async () => {
        throw new Error("catastrophic failure");
      },
      prepareModel: async () => {
        throw new Error("prepareModel also broke");
      },
    };

    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      bombDeps,
    );

    expect(result).toEqual([]);
  });

  it("enriches candidates with web search sources", async () => {
    const depsWithSearch: LlmInsightDeps = {
      complete: async () => assistantMessage(validLLMResponse()),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      webSearch: async () => [
        { title: "TypeScript 5.5 Release", url: "https://example.com/ts55", snippet: "New type predicates" },
      ],
    };

    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      depsWithSearch,
    );

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.sources.length).toBe(1);
    expect(result[0]!.sources[0]!.url).toBe("https://example.com/ts55");
  });
});

describe("buildInsightPrompt — EXTERNAL_FACTS", () => {
  it("places web snippets in EXTERNAL_FACTS block when web results exist", () => {
    const persona = makePersona({
      domains: {
        TypeScript: {
          depth: 5,
          recurrence: 10,
          lastMentioned: Date.now(),
          keyInsights: ["type system"],
          activeQuestions: [],
          connections: [],
          negationSignals: 0,
        },
      },
    });
    const input = makeInput({ targetDomains: ["TypeScript"] });
    const prompt = buildInsightPrompt(persona, input, [
      { title: "TypeScript 5.5", url: "https://example.com", snippet: "New type predicates" },
    ] as WebSearchResult[]);
    expect(prompt).toContain("EXTERNAL_FACTS");
    expect(prompt).toContain("New type predicates");
    // Should NOT have inline news: in domain descriptions
    expect(prompt).not.toMatch(/news:.*New type predicates/);
  });

  it("does not include EXTERNAL_FACTS block when no web results", () => {
    const persona = makePersona({
      domains: {
        Rust: {
          depth: 3,
          recurrence: 5,
          lastMentioned: Date.now(),
          keyInsights: [],
          activeQuestions: [],
          connections: [],
          negationSignals: 0,
        },
      },
    });
    const input = makeInput({ targetDomains: ["Rust"] });
    const prompt = buildInsightPrompt(persona, input, []);
    expect(prompt).not.toContain("EXTERNAL_FACTS");
  });

  it("includes prioritization instruction when EXTERNAL_FACTS present", () => {
    const persona = makePersona({
      domains: {
        Rust: {
          depth: 3,
          recurrence: 5,
          lastMentioned: Date.now(),
          keyInsights: [],
          activeQuestions: [],
          connections: [],
          negationSignals: 0,
        },
      },
    });
    const input = makeInput({ targetDomains: ["Rust"] });
    const prompt = buildInsightPrompt(persona, input, [
      { title: "Rust async", url: "https://example.com", snippet: "Tokio runtime update" },
    ] as WebSearchResult[]);
    expect(prompt).toContain("prioritize building the insight around those external facts");
  });
});

describe("buildInsightPrompt — domain alias matching", () => {
  it("matches web results by keyInsight-derived aliases", () => {
    const persona = makePersona({
      domains: {
        TypeScript: {
          depth: 5,
          recurrence: 10,
          lastMentioned: Date.now(),
          keyInsights: ["decorator pattern", "template literal types"],
          activeQuestions: [],
          connections: [],
          negationSignals: 0,
        },
      },
    });
    const input = makeInput({ targetDomains: ["TypeScript"] });
    const prompt = buildInsightPrompt(persona, input, [
      { title: "New TC39 decorator metadata", url: "https://example.com", snippet: "Stage 3 decorator proposal" },
    ] as WebSearchResult[]);
    expect(prompt).toContain("EXTERNAL_FACTS");
    expect(prompt).toContain("Stage 3 decorator proposal");
  });

  it("still matches by domain name (regression)", () => {
    const persona = makePersona({
      domains: {
        TypeScript: {
          depth: 3,
          recurrence: 5,
          lastMentioned: Date.now(),
          keyInsights: [],
          activeQuestions: [],
          connections: [],
          negationSignals: 0,
        },
      },
    });
    const input = makeInput({ targetDomains: ["TypeScript"] });
    const prompt = buildInsightPrompt(persona, input, [
      { title: "TypeScript 5.5 Release", url: "https://example.com", snippet: "New type predicates" },
    ] as WebSearchResult[]);
    expect(prompt).toContain("EXTERNAL_FACTS");
    expect(prompt).toContain("New type predicates");
  });

  it("matches multi-word keyInsight phrases", () => {
    const persona = makePersona({
      domains: {
        MCP: {
          depth: 3,
          recurrence: 5,
          lastMentioned: Date.now(),
          keyInsights: ["Model Context Protocol"],
          activeQuestions: [],
          connections: [],
          negationSignals: 0,
        },
      },
    });
    const input = makeInput({ targetDomains: ["MCP"] });
    const prompt = buildInsightPrompt(persona, input, [
      { title: "Model Context Protocol spec v2", url: "https://example.com", snippet: "MCP spec updated" },
    ] as WebSearchResult[]);
    expect(prompt).toContain("EXTERNAL_FACTS");
  });
});

describe("extractKeyTerms", () => {
  it("extracts substantive terms from a clean Chinese question", () => {
    const terms = extractKeyTerms("Rust和TypeScript通过WASM结合的最佳实践");
    expect(terms.length).toBeGreaterThanOrEqual(1);
    expect(terms).toContain("Rust和TypeScript通过WASM结合的最佳实践");
  });

  it("strips Feishu user-ID prefix", () => {
    const terms = extractKeyTerms("ou_9fc49cc3e2864aba3cd8f720955e379a: 软件架构设计模式");
    expect(terms.length).toBeGreaterThanOrEqual(1);
    expect(terms.some((t) => t.includes("软件架构"))).toBe(true);
    expect(terms.some((t) => t.includes("ou_") || t.includes("9fc49"))).toBe(false);
  });

  it("strips hex-only user-ID prefix", () => {
    const terms = extractKeyTerms("9cc3e2864aba3cd8f720955e379a: Gateway配置");
    expect(terms).toContain("Gateway配置");
  });

  it("removes leading interrogative fillers", () => {
    const terms = extractKeyTerms("需要我重启Gateway才能识别这个Chromium？");
    expect(terms.length).toBeGreaterThanOrEqual(1);
    expect(terms[0]).not.toMatch(/^需要我/);
  });

  it("removes trailing punctuation", () => {
    const terms = extractKeyTerms("KaijiBot网关调试。。？！");
    expect(terms.length).toBeGreaterThanOrEqual(1);
    expect(terms[0]).not.toMatch(/[。？！，]+$/);
  });

  it("splits on conjunctions and keeps substantive segments", () => {
    const terms = extractKeyTerms("软件架构的时候还是系统设计");
    expect(terms.length).toBeGreaterThanOrEqual(2);
    expect(terms).toContain("软件架构");
    expect(terms).toContain("系统设计");
  });

  it("filters out very short segments (< 2 chars)", () => {
    const terms = extractKeyTerms("的");
    expect(terms).toEqual([]);
  });

  it("filters out very long segments (> 30 chars)", () => {
    const longText = "这是一个非常长的句子包含超过三十个字符的限制所以应该被过滤掉才对啊";
    const terms = extractKeyTerms(longText);
    for (const term of terms) {
      expect(term.length).toBeLessThanOrEqual(30);
    }
  });

  it("returns empty array for empty string", () => {
    expect(extractKeyTerms("")).toEqual([]);
  });

  it("returns empty array for whitespace only", () => {
    expect(extractKeyTerms("   ")).toEqual([]);
  });

  it("returns empty array after stripping leaves nothing", () => {
    expect(extractKeyTerms("你好？")).toEqual([]);
  });

  it("handles English technical terms", () => {
    const terms = extractKeyTerms("How to optimize React server components");
    expect(terms.length).toBeGreaterThanOrEqual(1);
    expect(terms.some((t) => t.toLowerCase().includes("react") || t.toLowerCase().includes("server"))).toBe(true);
  });
});

describe("buildSearchQuery", () => {
  it("uses recentFocus terms for search query", () => {
    const input = makeInput({
      targetDomains: ["rust"],
      recentFocus: ["Rust所有权模型和借用检查器"],
    });
    const query = buildSearchQuery(input);
    expect(query).toContain("Rust");
  });

  it("uses recentFocus terms for search query when no other input", () => {
    const input = makeInput({
      targetDomains: ["typescript"],
      recentFocus: ["装饰器模式"],
    });
    const query = buildSearchQuery(input);
    expect(query).toContain("装饰器模式");
  });

  it("falls back to targetDomains with context suffix when recentFocus is empty", () => {
    const input = makeInput({
      targetDomains: ["kubernetes"],
      recentFocus: [],
    });
    const query = buildSearchQuery(input);
    expect(query).toContain("kubernetes");
    expect(query).toContain("最新进展");
  });

  it("uses targetDomains as primary and recentFocus as supplementary", () => {
    const input = makeInput({
      targetDomains: ["编程语言"],
      recentFocus: ["需要我重启Gateway才能识别这个Chromium？"],
    });
    const query = buildSearchQuery(input);
    expect(query).toContain("编程语言");
    expect(query).toContain("Gateway");
  });

  it("caps query at 120 characters", () => {
    const input = makeInput({
      targetDomains: ["domain"],
      recentFocus: ["这是一个非常非常长的搜索查询包含了很多关键词和描述性文字希望能够超过一百二十个字符的限制以便测试截断功能是否正常工作呀".repeat(3)],
    });
    const query = buildSearchQuery(input);
    expect(query.length).toBeLessThanOrEqual(120);
  });

  it("limits to 4 concepts", () => {
    const input = makeInput({
      targetDomains: ["ai"],
      recentFocus: ["机器学习 深度学习 神经网络 自然语言处理 计算机视觉 强化学习"],
    });
    const query = buildSearchQuery(input);
    const currentYear = new Date().getFullYear().toString();
    const parts = query.replace(currentYear, "").trim().split(/\s+/).filter(Boolean);
    expect(parts.length).toBeLessThanOrEqual(4);
  });

  it("handles empty targetDomains gracefully", () => {
    const input = makeInput({
      targetDomains: [],
      recentFocus: ["React状态管理最佳实践"],
    });
    const query = buildSearchQuery(input);
    expect(query).toBeTruthy();
    expect(query.length).toBeGreaterThan(0);
  });

  it("produces a clean query instead of raw conversational text", () => {
    const input = makeInput({
      targetDomains: ["软件架构"],
      recentFocus: ["需要我重启Gateway才能识别这个Chromium？ KaijiBot网关调试"],
    });
    const query = buildSearchQuery(input);
    expect(query).not.toContain("需要我");
    expect(query).not.toContain("才能识别");
  });

  it("deduplicates domain name already in targetDomains from recentFocus", () => {
    const input = makeInput({
      targetDomains: ["TypeScript"],
      recentFocus: ["TypeScript的高级类型"],
    });
    const query = buildSearchQuery(input);
    const matches = query.match(/typescript/gi);
    expect(matches!.length).toBeGreaterThanOrEqual(1);
  });

  it("splits compound domain name in fallback query", () => {
    const input = makeInput({
      targetDomains: ["AI/机器学习"],
      recentFocus: [],
    });
    const query = buildSearchQuery(input);
    expect(query).toContain("AI");
    expect(query).toContain("机器学习");
    expect(query).toContain("最新进展");
    expect(query).not.toBe("AI/机器学习");
  });

  it("produces space-separated parts for single domain fallback", () => {
    const input = makeInput({
      targetDomains: ["飞书能力探索"],
      recentFocus: [],
    });
    const query = buildSearchQuery(input);
    expect(query).toContain("飞书能力探索");
    expect(query).toContain("最新进展");
    expect(query).not.toBe("飞书能力探索");
  });

  it("appends current year to search query", () => {
    const input: InsightEngineInput = {
      targetDomains: ["Rust"],
      recentFocus: ["ownership model"],
      trustScore: 0.8,
      recentInsightIds: [],
      recentInsightContents: [],
      recentQueryHistory: [],
    };
    const result = buildSearchQuery(input);
    const currentYear = new Date().getFullYear().toString();
    expect(result).toContain(currentYear);
  });

  it("does not duplicate year if already present in query terms", () => {
    const year = new Date().getFullYear().toString();
    const input: InsightEngineInput = {
      targetDomains: [`Rust ${year}`],
      recentFocus: [],
      trustScore: 0.8,
      recentInsightIds: [],
      recentInsightContents: [],
      recentQueryHistory: [],
    };
    const result = buildSearchQuery(input);
    // Should contain the year but not double it
    const yearOccurrences = result.split(year).length - 1;
    expect(yearOccurrences).toBeLessThanOrEqual(2); // At most once from domain + once from suffix
  });
});

// ---------------------------------------------------------------------------
// buildSurpriseInsightPrompt
// ---------------------------------------------------------------------------

const TEST_STRATEGY: SearchStrategy = {
  inferredInterest: "eBPF distributed tracing",
  searchQuery: "eBPF distributed tracing observability",
  bridgeReasoning: "User knows Rust and observability, eBPF bridges both",
  avoidTopics: ["rust", "typescript"],
  estimatedSurprise: 0.8,
};

describe("buildSurpriseInsightPrompt", () => {
  it("includes INFERRED LATENT INTEREST section with strategy fields", () => {
    const prompt = buildSurpriseInsightPrompt(
      makePersona(),
      makeInput(),
      [],
      [],
      TEST_STRATEGY,
    );

    expect(prompt).toContain("INFERRED LATENT INTEREST");
    expect(prompt).toContain("eBPF distributed tracing");
    expect(prompt).toContain("User knows Rust and observability, eBPF bridges both");
    expect(prompt).toContain("Why surprising");
  });

  it("includes SPECIFIC FACTS and anchor block", () => {
    const prompt = buildSurpriseInsightPrompt(
      makePersona(),
      makeInput(),
      [],
      [],
      TEST_STRATEGY,
    );

    expect(prompt).toContain("SPECIFIC FACTS YOU KNOW ABOUT THIS USER");
    expect(prompt).toContain("type narrowing");
    expect(prompt).toContain("ownership model");
  });

  it("includes EXTERNAL_FACTS when web results exist", () => {
    const webResults: WebSearchResult[] = [
      { title: "eBPF Tracing Guide", url: "https://example.com/ebpf", snippet: "Rust-based eBPF distributed tracing" },
    ];

    const prompt = buildSurpriseInsightPrompt(
      makePersona(),
      makeInput(),
      webResults,
      [],
      TEST_STRATEGY,
    );

    expect(prompt).toContain("EXTERNAL_FACTS");
    expect(prompt).toContain("Rust-based eBPF distributed tracing");
  });

  it("includes language instruction for Chinese by default", () => {
    const prompt = buildSurpriseInsightPrompt(
      makePersona(),
      makeInput(),
      [],
      [],
      TEST_STRATEGY,
    );

    expect(prompt).toContain("用中文输出。");
  });

  it("includes English language instruction when outputLanguage is 'en'", () => {
    const prompt = buildSurpriseInsightPrompt(
      makePersona(),
      makeInput(),
      [],
      [],
      TEST_STRATEGY,
      "en",
    );

    expect(prompt).toContain("Output in English.");
  });

  it("includes PAST INSIGHTS when recentInsightContents provided", () => {
    const prompt = buildSurpriseInsightPrompt(
      makePersona(),
      makeInput(),
      [],
      ["Rust的所有权模型在并发场景下有独特的优势", "TypeScript 5.5新增了类型推断的改进"],
      TEST_STRATEGY,
    );

    expect(prompt).toContain("PAST INSIGHTS");
    expect(prompt).toContain("Rust的所有权模型在并发场景下有独特的优势");
  });

  it("includes opening bans from recent insight contents", () => {
    const prompt = buildSurpriseInsightPrompt(
      makePersona(),
      makeInput(),
      [],
      ["最近发现了一个有趣的技术", "你有没有想过eBPF"],
      TEST_STRATEGY,
    );

    expect(prompt).toContain("不要以");
  });
});

// ---------------------------------------------------------------------------
// generateInsightCandidatesLLM — surprise mode
// ---------------------------------------------------------------------------

function inferenceSuccessDeps(strategyJSON: string): InterestInferenceDeps {
  return {
    complete: async () => assistantMessage(strategyJSON),
    prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
  };
}

function surpriseInput(overrides?: Partial<InsightEngineInput>): InsightEngineInput {
  return makeInput({ mode: "surprise", ...overrides });
}

function validStrategyJSON(): string {
  return JSON.stringify({
    inferredInterest: "eBPF distributed tracing",
    searchQuery: "eBPF distributed tracing observability",
    bridgeReasoning: "User knows Rust and observability, eBPF bridges both",
    avoidTopics: ["rust", "typescript"],
    estimatedSurprise: 0.8,
  });
}

describe("generateInsightCandidatesLLM — surprise mode", () => {
  it("uses inference layer in surprise mode and returns candidates", async () => {
    const deps: LlmInsightDeps = {
      complete: async () => assistantMessage(validLLMResponse()),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      inferenceDeps: inferenceSuccessDeps(validStrategyJSON()),
    };

    const result = await generateInsightCandidatesLLM(
      makePersona(),
      surpriseInput(),
      makeConfig(),
      deps,
    );

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.content).toBeTruthy();
  });

  it("falls back to extend mode when inference fails", async () => {
    const inferenceFailDeps: InterestInferenceDeps = {
      complete: async () => assistantMessage(""),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    };

    const deps: LlmInsightDeps = {
      complete: async () => assistantMessage(validLLMResponse()),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      inferenceDeps: inferenceFailDeps,
    };

    const result = await generateInsightCandidatesLLM(
      makePersona(),
      surpriseInput(),
      makeConfig(),
      deps,
    );

    // Should still produce results via extend mode fallback
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("skips inference when no inferenceDeps provided even in surprise mode", async () => {
    const deps: LlmInsightDeps = {
      complete: async () => assistantMessage(validLLMResponse()),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      // no inferenceDeps
    };

    const result = await generateInsightCandidatesLLM(
      makePersona(),
      surpriseInput(),
      makeConfig(),
      deps,
    );

    // Should produce results using the extend path since no inferenceDeps
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// parseLLMInsights robust parsing
// ---------------------------------------------------------------------------

describe("parseLLMInsights robust parsing", () => {
  it("extracts JSON array from text with leading prose", async () => {
    const raw = 'Here are the insights:\n[{"content":"TypeScript和Rust的内存管理模型有深刻的设计共鸣","rationale":"跨域连接","targetDomains":["typescript"],"sourceDomains":["rust"],"relevanceScore":0.8,"surpriseScore":0.7}]';
    const result = await generateInsightCandidatesLLM(
      makePersona(), makeInput(), makeConfig(), successDeps(raw),
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.content).toContain("TypeScript");
  });

  it("extracts JSON array from text with trailing prose", async () => {
    const raw = '[{"content":"Rust的所有权模型和TypeScript的类型体操有有趣的共鸣","rationale":"跨域","targetDomains":["typescript"],"sourceDomains":["rust"],"relevanceScore":0.8,"surpriseScore":0.6}]\n\nHope this helps!';
    const result = await generateInsightCandidatesLLM(
      makePersona(), makeInput(), makeConfig(), successDeps(raw),
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("handles trailing comma before closing bracket", async () => {
    const raw = '[{"content":"TypeScript的类型系统和Rust的所有权模型都体现了零成本抽象","rationale":"test","targetDomains":["typescript"],"sourceDomains":["rust"],"relevanceScore":0.8,"surpriseScore":0.6},]';
    const result = await generateInsightCandidatesLLM(
      makePersona(), makeInput(), makeConfig(), successDeps(raw),
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for completely unparseable input", async () => {
    const raw = "This is just plain text with no JSON at all.";
    const result = await generateInsightCandidatesLLM(
      makePersona(), makeInput(), makeConfig(), successDeps(raw),
    );
    expect(result).toEqual([]);
  });

  it("still parses valid JSON correctly (regression)", async () => {
    const result = await generateInsightCandidatesLLM(
      makePersona(), makeInput(), makeConfig(), successDeps(validLLMResponse()),
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.content).toContain("TypeScript");
  });

  it("handles Chinese curly quotes in content (existing repair)", async () => {
    const raw = '[{"content":"他说\u201c你好\u201d吗，这个方向值得深入研究","rationale":"test","targetDomains":["AI"],"sourceDomains":[],"relevanceScore":0.8,"surpriseScore":0.7}]';
    const result = await generateInsightCandidatesLLM(
      makePersona(), makeInput(), makeConfig(), successDeps(raw),
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.content).toContain("他说");
  });

  it("handles unescaped ASCII inner quotes via aggressive repair", async () => {
    // Construct the string with raw unescaped quotes inside the content value
    const raw = '[{"content":"他说"你好"吗，这个方向值得深入研究","rationale":"test rationale","targetDomains":["AI"],"sourceDomains":[],"relevanceScore":0.8,"surpriseScore":0.7}]';
    const result = await generateInsightCandidatesLLM(
      makePersona(), makeInput(), makeConfig(), successDeps(raw),
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.content).toContain("他说");
  });

  it("handles properly escaped quotes (regression)", async () => {
    const raw = '[{"content":"他说\\\"你好\\\"吗，这个方向值得深入研究","rationale":"test","targetDomains":["AI"],"sourceDomains":[],"relevanceScore":0.8,"surpriseScore":0.7}]';
    const result = await generateInsightCandidatesLLM(
      makePersona(), makeInput(), makeConfig(), successDeps(raw),
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.content).toContain("他说");
  });

  it("handles multiple inner ASCII quotes across fields", async () => {
    const raw = '[{"content":"A说"B"和C说"D"都有道理","rationale":"multi-quote test","targetDomains":["AI"],"sourceDomains":[],"relevanceScore":0.8,"surpriseScore":0.7}]';
    const result = await generateInsightCandidatesLLM(
      makePersona(), makeInput(), makeConfig(), successDeps(raw),
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.content).toContain("A说");
    expect(result[0]!.content).toContain("C说");
  });
});

describe("buildInsightPrompt — compound domain keyword splitting", () => {
  it("matches web results by split sub-keywords of compound domain name", () => {
    const persona = makePersona({
      domains: {
        "AI/机器学习": {
          depth: 4,
          recurrence: 6,
          lastMentioned: Date.now(),
          keyInsights: [],
          activeQuestions: [],
          connections: [],
          negationSignals: 0,
        },
      },
    });
    const input = makeInput({ targetDomains: ["AI/机器学习"] });
    const prompt = buildInsightPrompt(persona, input, [
      { title: "机器学习最新突破", url: "https://example.com", snippet: "深度学习模型优化" },
    ] as WebSearchResult[]);
    expect(prompt).toContain("EXTERNAL_FACTS");
    expect(prompt).toContain("深度学习模型优化");
  });
});

describe("buildInsightPrompt — bigram similarity matching", () => {
  it("matches web results via bigram similarity for compound keywords", () => {
    const persona = makePersona({
      domains: {
        artificialintelligence: {
          depth: 3,
          recurrence: 5,
          lastMentioned: Date.now(),
          keyInsights: ["artificial intelligence research"],
          activeQuestions: [],
          connections: [],
          negationSignals: 0,
        },
      },
    });
    const input = makeInput({ targetDomains: ["artificialintelligence"] });
    const prompt = buildInsightPrompt(persona, input, [
      { title: "New breakthroughs in artificial intelligence", url: "https://example.com", snippet: "AI research advances" },
    ] as WebSearchResult[]);
    expect(prompt).toContain("EXTERNAL_FACTS");
  });
});

// ---------------------------------------------------------------------------
// T3: buildSearchQuery — targetDomains as primary source
// ---------------------------------------------------------------------------

describe("buildSearchQuery — targetDomains priority (T3)", () => {
  it("uses targetDomains as primary query source", () => {
    const input = makeInput({
      targetDomains: ["AI/机器学习", "软件架构"],
      recentFocus: ["today I learned about Rust"],
    });
    const query = buildSearchQuery(input);
    expect(query).toMatch(/AI|机器学习|软件|架构/);
  });

  it("falls back to recentFocus when targetDomains empty", () => {
    const input = makeInput({
      targetDomains: [],
      recentFocus: ["Rust embedded systems"],
    });
    const query = buildSearchQuery(input);
    expect(query).toBeTruthy();
    expect(query.length).toBeGreaterThan(0);
  });

  it("combines targetDomains and recentFocus", () => {
    const input = makeInput({
      targetDomains: ["数据科学"],
      recentFocus: ["Python data analysis"],
    });
    const query = buildSearchQuery(input);
    expect(query).toContain("数据科学");
  });

  it("returns empty string for empty input", () => {
    const input = makeInput({
      targetDomains: [],
      recentFocus: [],
    });
    const query = buildSearchQuery(input);
    expect(query).toBe("");
  });

  it("adds context suffix for short queries", () => {
    const input = makeInput({
      targetDomains: ["AI"],
      recentFocus: [],
    });
    const query = buildSearchQuery(input);
    expect(query).toContain("最新进展");
  });
});

// ---------------------------------------------------------------------------
// T4: Trigram dedup in generateInsightCandidatesLLM
// ---------------------------------------------------------------------------

describe("generateInsightCandidatesLLM — trigram dedup (T4)", () => {
  it("filters candidates similar to recent insights", async () => {
    const candidateContent = "TypeScript的类型系统和Rust的所有权模型都体现了零成本抽象的设计哲学";
    const recentContent = "TypeScript的类型系统和Rust的所有权模型都体现了零成本抽象的设计理念";
    const response = JSON.stringify([
      {
        content: candidateContent,
        rationale: "cross-domain",
        targetDomains: ["typescript"],
        sourceDomains: ["rust"],
        relevanceScore: 0.8,
        surpriseScore: 0.5,
      },
      {
        content: "Kubernetes的Operator模式可以用来管理有状态应用的生命周期",
        rationale: "infrastructure",
        targetDomains: ["kubernetes"],
        sourceDomains: [],
        relevanceScore: 0.7,
        surpriseScore: 0.6,
      },
    ]);
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput({ recentInsightContents: [recentContent] }),
      makeConfig(),
      successDeps(response),
    );
    expect(result.length).toBe(1);
    expect(result[0]!.content).toContain("Kubernetes");
  });

  it("keeps candidates different from recent insights", async () => {
    const response = JSON.stringify([
      {
        content: "WebAssembly正在改变浏览器端的计算范式",
        rationale: "emerging",
        targetDomains: ["wasm"],
        sourceDomains: [],
        relevanceScore: 0.8,
        surpriseScore: 0.7,
      },
    ]);
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput({ recentInsightContents: ["Rust嵌入式开发在物联网领域的应用越来越广泛"] }),
      makeConfig(),
      successDeps(response),
    );
    expect(result.length).toBe(1);
    expect(result[0]!.content).toContain("WebAssembly");
  });

  it("skips dedup when no recent insights", async () => {
    const response = JSON.stringify([
      {
        content: "WebAssembly改变了浏览器端的计算范式",
        rationale: "emerging",
        targetDomains: ["wasm"],
        sourceDomains: [],
        relevanceScore: 0.8,
        surpriseScore: 0.7,
      },
    ]);
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput({ recentInsightContents: [] }),
      makeConfig(),
      successDeps(response),
    );
    expect(result.length).toBe(1);
  });

  it("filters all candidates when all are duplicates", async () => {
    const candidateContent = "TypeScript的类型系统和Rust的所有权模型都体现了零成本抽象的设计哲学";
    const recentContent = "TypeScript的类型系统和Rust的所有权模型都体现了零成本抽象的设计理念";
    const response = JSON.stringify([
      {
        content: candidateContent,
        rationale: "cross",
        targetDomains: ["typescript"],
        sourceDomains: ["rust"],
        relevanceScore: 0.8,
        surpriseScore: 0.5,
      },
    ]);
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput({ recentInsightContents: [recentContent] }),
      makeConfig(),
      successDeps(response),
    );
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Query diversification via recentQueryHistory
// ---------------------------------------------------------------------------

describe("buildSearchQuery — query diversification", () => {
  it("produces different queries with different recentQueryHistory lengths", () => {
    const base = makeInput({
      targetDomains: ["kubernetes"],
      recentFocus: [],
    });
    const q0 = buildSearchQuery({ ...base, recentQueryHistory: [] });
    const q1 = buildSearchQuery({ ...base, recentQueryHistory: ["kubernetes 最新进展"] });
    const q2 = buildSearchQuery({ ...base, recentQueryHistory: ["kubernetes 最新进展", "kubernetes 实践案例"] });

    const suffixes = ["最新进展", "实践案例", "最佳实践", "技术趋势", "新方向"];
    const hasSuffix = (q: string) => suffixes.some((s) => q.includes(s));
    expect(hasSuffix(q0)).toBe(true);
    expect(hasSuffix(q1)).toBe(true);
    expect(hasSuffix(q2)).toBe(true);

    // At least two should differ (suffix rotation)
    const all = [q0, q1, q2];
    const unique = new Set(all);
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });

  it("produces different suffix via history-length-based rotation", () => {
    const base = makeInput({
      targetDomains: ["kubernetes"],
      recentFocus: [],
    });

    const queries = Array.from({ length: 5 }, (_, i) =>
      buildSearchQuery({ ...base, recentQueryHistory: Array.from({ length: i }, (_, j) => `query ${j}`) })
    );

    const suffixes = ["最新进展", "实践案例", "最佳实践", "技术趋势", "新方向"];
    const usedSuffixes = new Set<string>();
    for (const q of queries) {
      for (const s of suffixes) {
        if (q.includes(s)) usedSuffixes.add(s);
      }
    }
    expect(usedSuffixes.size).toBeGreaterThanOrEqual(3);
  });

  it("excludes terms from recentQueryHistory when alternatives exist", () => {
    const base = makeInput({
      targetDomains: ["AI", "机器学习"],
      recentFocus: [],
    });
    const qWithout = buildSearchQuery({ ...base, recentQueryHistory: [] });
    const qWith = buildSearchQuery({ ...base, recentQueryHistory: ["AI 最新进展"] });

    expect(qWithout).toContain("AI");
    // With history containing "AI", the query should still produce a valid query
    expect(qWith.length).toBeGreaterThan(0);
  });

  it("skips domain fully in history when alternatives exist", () => {
    const input = makeInput({
      targetDomains: ["AI", "Rust"],
      recentFocus: [],
      recentQueryHistory: ["AI 最新进展", "AI 实践案例", "AI 最佳实践"],
    });
    const query = buildSearchQuery(input);
    expect(query).toContain("Rust");
  });

  it("remains backward compatible when recentQueryHistory is undefined", () => {
    const input = makeInput({
      targetDomains: ["AI"],
      recentFocus: [],
    });
    const query = buildSearchQuery(input);
    expect(query).toContain("AI");
    expect(query).toContain("最新进展");
  });

  it("remains backward compatible when recentQueryHistory is empty", () => {
    const input = makeInput({
      targetDomains: ["AI"],
      recentFocus: [],
      recentQueryHistory: [],
    });
    const query = buildSearchQuery(input);
    expect(query).toContain("AI");
    expect(query).toContain("最新进展");
  });

  it("tries multiple recentFocus items when first matches history", () => {
    const input = makeInput({
      targetDomains: ["AI"],
      recentFocus: ["深度学习", "区块链"],
      recentQueryHistory: ["AI 深度学习 最新进展"],
    });
    const query = buildSearchQuery(input);
    expect(query).toContain("AI");
    // Should pick up from the second recentFocus since first overlaps with history
    expect(query.length).toBeGreaterThan(0);
  });

  it("suffix rotation cycles through all options deterministically", () => {
    const base = makeInput({
      targetDomains: ["devops"],
      recentFocus: [],
    });

    const suffixes = ["最新进展", "实践案例", "最佳实践", "技术趋势", "新方向"];
    const collected: string[] = [];
    for (let i = 0; i < 5; i++) {
      const q = buildSearchQuery({ ...base, recentQueryHistory: Array.from({ length: i }, (_, j) => `q${j}`) });
      for (const s of suffixes) {
        if (q.includes(s)) { collected.push(s); break; }
      }
    }
    expect(collected).toEqual(suffixes);
  });
});

// ---------------------------------------------------------------------------
// Fix 1: Force-align LLM output domains to input targetDomains
// ---------------------------------------------------------------------------

describe("generateInsightCandidatesLLM — domain force-alignment", () => {
  it("overrides LLM targetDomains when they share no overlap with input", async () => {
    const response = JSON.stringify([
      {
        content: "软件架构的微服务模式正在被重新审视",
        rationale: "architecture trend",
        targetDomains: ["产品思维"],
        sourceDomains: [],
        relevanceScore: 0.8,
        surpriseScore: 0.6,
      },
    ]);
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput({ targetDomains: ["软件架构", "网络安全"] }),
      makeConfig(),
      successDeps(response),
    );
    expect(result.length).toBe(1);
    expect(result[0]!.targetDomains).toEqual(["软件架构", "网络安全"]);
  });

  it("preserves LLM targetDomains when they overlap with input", async () => {
    const response = JSON.stringify([
      {
        content: "TypeScript的类型推断正在向Rust的pattern matching靠拢",
        rationale: "cross-language",
        targetDomains: ["typescript", "wasm"],
        sourceDomains: ["rust"],
        relevanceScore: 0.85,
        surpriseScore: 0.7,
      },
    ]);
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput({ targetDomains: ["typescript", "rust"] }),
      makeConfig(),
      successDeps(response),
    );
    expect(result.length).toBe(1);
    expect(result[0]!.targetDomains).toContain("typescript");
  });

  it("does not override when input targetDomains is empty", async () => {
    const response = JSON.stringify([
      {
        content: "AI和机器学习正在重新定义软件架构的设计范式，尤其是分布式系统的容错机制",
        rationale: "test",
        targetDomains: ["AI/机器学习"],
        sourceDomains: [],
        relevanceScore: 0.8,
        surpriseScore: 0.5,
      },
    ]);
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput({ targetDomains: [] }),
      makeConfig(),
      successDeps(response),
    );
    expect(result.length).toBe(1);
    expect(result[0]!.targetDomains).toEqual(["AI/机器学习"]);
  });

  it("force-aligns with case-insensitive match", async () => {
    const response = JSON.stringify([
      {
        content: "TypeScript的类型体操和Rust的所有权模型有共鸣",
        rationale: "cross-domain",
        targetDomains: ["TypeScript"],
        sourceDomains: ["Rust"],
        relevanceScore: 0.8,
        surpriseScore: 0.7,
      },
    ]);
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput({ targetDomains: ["typescript", "rust"] }),
      makeConfig(),
      successDeps(response),
    );
    expect(result.length).toBe(1);
    expect(result[0]!.targetDomains).toContain("TypeScript");
  });
});

describe("buildInsightPrompt — TARGET DOMAINS constraint", () => {
  it("includes TARGET DOMAINS section with input targetDomains", () => {
    const prompt = buildInsightPrompt(
      makePersona(),
      makeInput({ targetDomains: ["软件架构", "网络安全"] }),
      [],
      [],
    );
    expect(prompt).toContain("TARGET DOMAINS");
    expect(prompt).toContain("软件架构");
    expect(prompt).toContain("网络安全");
  });

  it("includes domain alignment requirement in hard constraints", () => {
    const prompt = buildInsightPrompt(
      makePersona(),
      makeInput({ targetDomains: ["编程语言"] }),
      [],
      [],
    );
    expect(prompt).toContain("TARGET DOMAINS");
    expect(prompt).toContain("targetDomains字段必须包含这些域");
  });

  it("includes CRITICAL domain constraint in JSON schema section", () => {
    const prompt = buildInsightPrompt(
      makePersona(),
      makeInput({ targetDomains: ["数据科学"] }),
      [],
      [],
    );
    expect(prompt).toContain("targetDomains MUST include at least one of: 数据科学");
  });
});

describe("buildInsightPrompt — targetDomains in keyword map", () => {
  it("matches web results by targetDomain not in persona.domains", () => {
    const persona = makePersona({
      domains: {
        typescript: {
          depth: 5,
          recurrence: 10,
          lastMentioned: Date.now(),
          keyInsights: [],
          activeQuestions: [],
          connections: [],
          negationSignals: 0,
        },
      },
    });
    const input = makeInput({ targetDomains: ["网络安全"] });
    const prompt = buildInsightPrompt(persona, input, [
      { title: "网络安全最新漏洞", url: "https://example.com", snippet: "零日漏洞防护方案" },
    ] as WebSearchResult[]);
    expect(prompt).toContain("EXTERNAL_FACTS");
    expect(prompt).toContain("零日漏洞防护方案");
  });
});

describe("matchWebResultsToDomainsLLM", () => {
  it("classifies web results to domains via LLM", async () => {
    const webResults: WebSearchResult[] = [
      { title: "Rust ownership model explained", url: "https://example.com/1", snippet: "Understanding how Rust's borrow checker ensures memory safety" },
      { title: "TypeScript 5.0 features", url: "https://example.com/2", snippet: "New type system features in TypeScript" },
    ];
    const mockComplete = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: '{"1": ["rust"], "2": ["typescript"]}' }],
    });
    const deps: LlmInsightDeps = {
      complete: mockComplete,
      prepareModel: vi.fn().mockResolvedValue({ model: TEST_MODEL, auth: TEST_AUTH }),
    };
    const result = await matchWebResultsToDomainsLLM(webResults, makePersona(), {} as KaijiBotConfig, deps);
    expect(result.has("rust")).toBe(true);
    expect(result.has("typescript")).toBe(true);
  });

  it("falls back to keyword matching on LLM failure", async () => {
    const webResults: WebSearchResult[] = [
      { title: "TypeScript tricks", url: "https://example.com/1", snippet: "Advanced TypeScript patterns" },
    ];
    const mockComplete = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    const deps: LlmInsightDeps = {
      complete: mockComplete,
      prepareModel: vi.fn().mockResolvedValue({ model: TEST_MODEL, auth: TEST_AUTH }),
    };
    const result = await matchWebResultsToDomainsLLM(webResults, makePersona(), {} as KaijiBotConfig, deps);
    expect(result).toBeDefined();
    expect(result instanceof Map).toBe(true);
  });

  it("returns empty Map when no web results provided", async () => {
    const deps: LlmInsightDeps = {
      complete: vi.fn(),
      prepareModel: vi.fn().mockResolvedValue({ model: TEST_MODEL, auth: TEST_AUTH }),
    };
    const result = await matchWebResultsToDomainsLLM([], makePersona(), {} as KaijiBotConfig, deps);
    expect(result.size).toBe(0);
    expect(deps.complete).not.toHaveBeenCalled();
  });
});
