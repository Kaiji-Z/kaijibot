import type { Api, AssistantMessage, Model, TextContent } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import { generateInsightCandidatesLLM, buildInsightPrompt, buildSurpriseInsightPrompt, extractKeyTerms, buildSearchQuery, type LlmInsightDeps, type WebSearchResult } from "./llm-engine.js";
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
    pendingQuestions: ["How to combine Rust and TypeScript via wasm?"],
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

  it("falls back to targetDomains when recentFocus is empty", () => {
    const input = makeInput({
      targetDomains: ["kubernetes"],
      recentFocus: [],
    });
    const query = buildSearchQuery(input);
    expect(query).toBe("kubernetes");
  });

  it("does not prepend domain name as prefix", () => {
    const input = makeInput({
      targetDomains: ["编程语言"],
      recentFocus: ["需要我重启Gateway才能识别这个Chromium？"],
    });
    const query = buildSearchQuery(input);
    expect(query).not.toContain("编程语言");
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
    const parts = query.split(" ");
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

  it("does not include domain name in query when concepts are available", () => {
    const input = makeInput({
      targetDomains: ["TypeScript"],
      recentFocus: ["TypeScript的高级类型"],
    });
    const query = buildSearchQuery(input);
    const matches = query.match(/typescript/gi);
    expect(matches).toHaveLength(1);
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
});

describe("buildInsightPrompt — pendingQuestions removal", () => {
  it("does not contain Pending questions section", () => {
    const prompt = buildInsightPrompt(makePersona(), makeInput(), [], []);
    expect(prompt).not.toContain("Pending questions");
    expect(prompt).not.toContain("pendingQuestions");
  });

  it("does not contain 解答悬问 trait", () => {
    const prompt = buildInsightPrompt(makePersona(), makeInput(), [], []);
    expect(prompt).not.toContain("解答悬问");
  });
});
