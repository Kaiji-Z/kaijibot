import type { Api, AssistantMessage, Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import { generateInsightCandidatesLLM, type LlmInsightDeps, type WebSearchResult } from "./llm-engine.js";
import { ProactiveScheduler, type InsightGeneratorFn } from "../scheduler/proactive-scheduler.js";
import type { InsightCandidate, InsightEngineInput, InsightMode } from "./types.js";
import type { Opportunity, SchedulerConfig, SchedulerEvent } from "../scheduler/types.js";

// ---------------------------------------------------------------------------
// Test infrastructure (local copies, no imports from other test files)
// ---------------------------------------------------------------------------

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
    content: [{ type: "text" as const, text }],
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
    lifecycle: { stage: "active", lastActiveAt: Date.now(), lastStageTransitionAt: Date.now() - 86400000, consecutiveSilentDays: 0, totalActiveDays: 10 },
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

function makeSchedulerConfig(overrides?: Partial<SchedulerConfig>): SchedulerConfig {
  return {
    minIntervalHours: 1,
    minTrustScore: 0,
    costFalseNegative: 100,
    costFalseAlarm: 1,
    ...overrides,
  };
}

const TEST_SOURCES: Array<{ url: string; title: string; credibility: number }> = [
  { url: "https://test.com", title: "Test", credibility: 0.8 },
];

function validInsightJSON(): string {
  return JSON.stringify([
    {
      content: "Rust的ownership模型和TypeScript的type narrowing在思维模式上有深层共通之处。",
      rationale: "用户同时深耕两门语言，跨领域启发有价值。",
      targetDomains: ["typescript"],
      sourceDomains: ["rust"],
      relevanceScore: 0.85,
      surpriseScore: 0.7,
      verificationStatus: "verified",
      sources: [{ url: "https://test.com", title: "Test", credibility: 0.8 }],
    },
  ]);
}

function validInferenceJSON(): string {
  return JSON.stringify({
    inferredInterest: "WebAssembly memory safety patterns",
    searchQuery: "wasm memory safety rust typescript",
    bridgeReasoning: "User knows Rust ownership and TypeScript types — WASM sits at their intersection",
    avoidTopics: ["typescript", "rust"],
    estimatedSurprise: 0.8,
  });
}

function makeWebSearchResults(query: string): WebSearchResult[] {
  return [
    { title: `${query} — latest research`, url: "https://example.com/research", snippet: `New findings about ${query} show promising results` },
    { title: `${query} best practices`, url: "https://example.com/guide", snippet: "Practical guide to implementation" },
  ];
}

function explorationOpportunity(mode: InsightMode): Opportunity {
  return {
    type: "exploration",
    targetDomains: [],
    sourceDomains: [],
    pNeed: 0.55,
    pAccept: 0.5,
    pAct: 0.275,
    metadata: { mode },
  };
}

// Realistic timestamp: enough elapsed time for the gate, with last digit controlling mode.
// 10 hours in ms = 36_000_000; +7 ensures timestamp % 10 < 8 (surprise).
function surpriseTimestamp(): number {
  return 36_000_000 + 7;
}

function extendTimestamp(): number {
  return 36_000_000 + 9;
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("insight pipeline integration", () => {
  it("surprise mode: scheduler → inference → LLM produces insight candidate", async () => {
    const persona = makePersona();
    const config = makeConfig();

    const mockDeps: LlmInsightDeps = {
      complete: async () => assistantMessage(validInsightJSON()),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      inferenceDeps: {
        complete: async () => assistantMessage(validInferenceJSON()),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
    };

    const generator: InsightGeneratorFn = (p, input, options) => {
      return generateInsightCandidatesLLM(p, input, config, mockDeps, {
        maxCandidates: options?.maxCandidates,
      }).then((candidates) =>
        candidates.map((c) => ({ ...c, sources: [...TEST_SOURCES] })),
      );
    };

    const insights: InsightCandidate[] = [];
    const scheduler = new ProactiveScheduler(
      makeSchedulerConfig(),
      {
        loadPersona: async () => persona,
        onInsightReady: async (_userId, candidate) => { insights.push(candidate); },
        savePersona: async () => {},
      },
      { insightGenerator: generator },
    );

    const result = await scheduler.resolve(persona, explorationOpportunity("surprise"));

    expect(result).not.toBeNull();
    expect(result!.content).toBeTruthy();
    expect(result!.content.length).toBeGreaterThan(10);
    expect(insights).toHaveLength(0);

    await scheduler.callbacks.onInsightReady("user-1", result!);
    expect(insights).toHaveLength(1);
    expect(insights[0]!.id).toBe(result!.id);
  });

  it("extend mode: scheduler → search → LLM produces insight candidate", async () => {
    const persona = makePersona();
    const config = makeConfig();

    const mockDeps: LlmInsightDeps = {
      complete: async () => assistantMessage(validInsightJSON()),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      webSearch: async () => makeWebSearchResults("wasm typescript"),
    };

    const generator: InsightGeneratorFn = (p, input, options) => {
      return generateInsightCandidatesLLM(p, input, config, mockDeps, {
        maxCandidates: options?.maxCandidates,
      });
    };

    const scheduler = new ProactiveScheduler(
      makeSchedulerConfig(),
      {
        loadPersona: async () => persona,
        onInsightReady: async () => {},
        savePersona: async () => {},
      },
      { insightGenerator: generator },
    );

    const result = await scheduler.resolve(persona, explorationOpportunity("extend"));

    expect(result).not.toBeNull();
    expect(result!.content).toBeTruthy();
    expect(result!.sources.length).toBeGreaterThan(0);
  });

  it("surprise mode falls back to extend when inference fails", async () => {
    const persona = makePersona();
    const config = makeConfig();
    const inferenceCallCount = { value: 0 };
    const mainLLMCallCount = { value: 0 };

    const mockDeps: LlmInsightDeps = {
      complete: async () => {
        mainLLMCallCount.value++;
        return assistantMessage(validInsightJSON());
      },
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      inferenceDeps: {
        complete: async () => {
          inferenceCallCount.value++;
          return assistantMessage("not valid json {{{");
        },
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
    };

    const generator: InsightGeneratorFn = (p, input, options) => {
      return generateInsightCandidatesLLM(p, input, config, mockDeps, {
        maxCandidates: options?.maxCandidates,
      }).then((candidates) =>
        candidates.map((c) => ({ ...c, sources: [...TEST_SOURCES] })),
      );
    };

    const scheduler = new ProactiveScheduler(
      makeSchedulerConfig(),
      {
        loadPersona: async () => persona,
        onInsightReady: async () => {},
        savePersona: async () => {},
      },
      { insightGenerator: generator },
    );

    const result = await scheduler.resolve(persona, explorationOpportunity("surprise"));

    expect(result).not.toBeNull();
    expect(result!.content).toBeTruthy();
    expect(inferenceCallCount.value).toBe(1);
    expect(mainLLMCallCount.value).toBeGreaterThanOrEqual(1);
  });

  it("scheduler resolve passes mode from opportunity metadata", async () => {
    const persona = makePersona();
    let receivedMode: InsightMode | undefined;

    const generator: InsightGeneratorFn = async (_persona, input, _options) => {
      receivedMode = input.mode;
      return [{
        id: "test-insight-id",
        content: "Test insight content about domains.",
        rationale: "Test rationale",
        targetDomains: ["typescript"],
        sourceDomains: [],
        relevanceScore: 0.8,
        surpriseScore: 0.6,
        compositeScore: 0.7,
        sources: [{ url: "https://test.com", title: "Test", credibility: 0.8 }],
        verificationStatus: "verified",
      }];
    };

    const scheduler = new ProactiveScheduler(
      makeSchedulerConfig(),
      {
        loadPersona: async () => persona,
        onInsightReady: async () => {},
        savePersona: async () => {},
      },
      { insightGenerator: generator },
    );

    const opportunity: Opportunity = {
      type: "exploration",
      targetDomains: ["typescript"],
      sourceDomains: [],
      pNeed: 0.6,
      pAccept: 0.8,
      pAct: 0.48,
      metadata: { mode: "surprise" as const },
    };

    const candidate = await scheduler.resolve(persona, opportunity);

    expect(candidate).not.toBeNull();
    expect(candidate!.content).toBeTruthy();
    expect(receivedMode).toBe("surprise");
  });

  it("end-to-end: surprise mode with web search", async () => {
    const persona = makePersona();
    const config = makeConfig();
    const capturedSearchQueries: string[] = [];
    const inferenceStrategyQuery = "wasm memory safety rust typescript";

    const mockDeps: LlmInsightDeps = {
      complete: async () => assistantMessage(validInsightJSON()),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      webSearch: async (query) => {
        capturedSearchQueries.push(query);
        return makeWebSearchResults(query);
      },
      inferenceDeps: {
        complete: async () => assistantMessage(validInferenceJSON()),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
    };

    const generator: InsightGeneratorFn = (p, input, options) => {
      return generateInsightCandidatesLLM(p, input, config, mockDeps, {
        maxCandidates: options?.maxCandidates,
      });
    };

    const scheduler = new ProactiveScheduler(
      makeSchedulerConfig(),
      {
        loadPersona: async () => persona,
        onInsightReady: async () => {},
        savePersona: async () => {},
      },
      { insightGenerator: generator },
    );

    const result = await scheduler.resolve(persona, explorationOpportunity("surprise"));

    expect(result).not.toBeNull();
    expect(result!.content).toBeTruthy();

    expect(capturedSearchQueries.length).toBeGreaterThanOrEqual(1);
    expect(capturedSearchQueries[0]).toBe(inferenceStrategyQuery);

    expect(result!.sources.length).toBeGreaterThan(0);
    expect(result!.sources.some((s) => s.url.includes("example.com"))).toBe(true);
  });

  it("processEvent: gate passes → search → identify → resolve delivers insight", async () => {
    const persona = makePersona();
    const config = makeConfig();

    const mockDeps: LlmInsightDeps = {
      complete: async () => assistantMessage(validInsightJSON()),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    };

    const generator: InsightGeneratorFn = (p, input, options) => {
      return generateInsightCandidatesLLM(p, input, config, mockDeps, {
        maxCandidates: options?.maxCandidates,
      }).then((candidates) =>
        candidates.map((c) => ({ ...c, sources: [...TEST_SOURCES] })),
      );
    };

    const delivered: InsightCandidate[] = [];
    const scheduler = new ProactiveScheduler(
      makeSchedulerConfig(),
      {
        loadPersona: async () => persona,
        onInsightReady: async (_userId, candidate) => { delivered.push(candidate); },
        savePersona: async () => {},
      },
      { insightGenerator: generator },
    );

    const event: SchedulerEvent = { type: "timer", timestamp: surpriseTimestamp() };
    const result = await scheduler.processEvent("user-1", event);

    expect(result).toBeDefined();
    expect(result!.content).toBeTruthy();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.id).toBe(result!.id);
  });

  it("search produces exploration opportunity with correct mode based on timestamp", () => {
    const persona = makePersona();
    const scheduler = new ProactiveScheduler(
      makeSchedulerConfig(),
      {
        loadPersona: async () => persona,
        onInsightReady: async () => {},
        savePersona: async () => {},
      },
    );

    const surpriseEvent: SchedulerEvent = { type: "timer", timestamp: surpriseTimestamp() };
    const surpriseOpps = scheduler.search(persona, surpriseEvent);
    const explorationSurprise = surpriseOpps.find((o) => o.type === "exploration");
    expect(explorationSurprise).toBeDefined();
    expect((explorationSurprise!.metadata as Record<string, unknown>)?.mode).toBe("surprise");

    const extendEvent: SchedulerEvent = { type: "timer", timestamp: extendTimestamp() };
    const extendOpps = scheduler.search(persona, extendEvent);
    const explorationExtend = extendOpps.find((o) => o.type === "exploration");
    expect(explorationExtend).toBeDefined();
    expect((explorationExtend!.metadata as Record<string, unknown>)?.mode).toBe("extend");
  });
});
