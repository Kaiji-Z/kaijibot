import type { Api, AssistantMessage, Model, TextContent } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import { generateInsightCandidatesLLM, type LlmInsightDeps } from "./llm-engine.js";
import type { InsightEngineInput } from "./types.js";

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
    pendingQuestions: ["How to combine Rust and TypeScript via wasm?"],
    trustScore: 0.75,
    recentInsightIds: ["id-1", "id-2"],
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

  it("falls back to template engine on LLM timeout", async () => {
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

    expect(Array.isArray(result)).toBe(true);
  });

  it("falls back when prepareModel returns error", async () => {
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      fallbackDeps,
    );

    expect(Array.isArray(result)).toBe(true);
  });

  it("falls back when LLM returns empty text", async () => {
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps(""),
    );

    expect(Array.isArray(result)).toBe(true);
  });

  it("falls back when LLM returns malformed JSON", async () => {
    const result = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps("this is not json at all {{{"),
    );

    expect(Array.isArray(result)).toBe(true);
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

    expect(Array.isArray(result)).toBe(true);
  });

  it("LLM insight content differs from template fallback content", async () => {
    const llmResult = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps(JSON.stringify([
        {
          content: "TypeScript 的类型体操与 Rust 所有权模型共享'编译期保证运行时安全'的哲学，但实现路径截然不同。",
          rationale: "Cross-domain insight",
          targetDomains: ["typescript"],
          sourceDomains: ["rust"],
          relevanceScore: 0.9,
          surpriseScore: 0.8,
        },
      ])),
    );

    expect(llmResult.length).toBeGreaterThanOrEqual(1);
    const llmContent = llmResult[0]!.content;

    const templateResult = await generateInsightCandidatesLLM(
      makePersona(),
      makeInput(),
      makeConfig(),
      fallbackDeps,
    );
    const templateContent = templateResult[0]!.content;

    expect(llmContent).not.toBe(templateContent);
    expect(llmContent).toContain("TypeScript");
    expect(llmContent).toContain("Rust");
    expect(llmContent).toContain("编译期");
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
