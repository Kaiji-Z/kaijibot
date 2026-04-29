import type { Api, AssistantMessage, Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import { buildInterestInferencePrompt, inferSearchStrategy, type InterestInferenceDeps } from "./interest-inference.js";
import type { InsightEngineInput, SearchStrategy } from "./types.js";

// ---------------------------------------------------------------------------
// Test helpers (local copies — not imported from other test files)
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
      curiosityDomains: ["wasm", "eBPF"],
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
    domainGraph: {
      nodes: ["typescript", "rust", "wasm"],
      edges: [
        { source: "typescript", target: "rust", weight: 0.8, lastObserved: Date.now(), observations: 7 },
        { source: "rust", target: "wasm", weight: 0.6, lastObserved: Date.now(), observations: 3 },
      ],
      totalObservations: 10,
    },
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

function makeConfig(overrides?: Partial<KaijiBotConfig>): KaijiBotConfig {
  return {
    cognitive: {
      insight: { sources: { webSearchProvider: "zai" } },
    },
    ...overrides,
  } as KaijiBotConfig;
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

function successDeps(responseText: string): InterestInferenceDeps {
  return {
    complete: async () => assistantMessage(responseText),
    prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
  };
}

// ---------------------------------------------------------------------------
// buildInterestInferencePrompt
// ---------------------------------------------------------------------------

describe("buildInterestInferencePrompt", () => {
  it("includes USER'S KNOWN KNOWLEDGE section with domain depths and key insights", () => {
    const prompt = buildInterestInferencePrompt(makePersona(), makeInput());

    expect(prompt).toContain("USER'S KNOWN KNOWLEDGE");
    expect(prompt).toContain("typescript");
    expect(prompt).toContain("depth: 5");
    expect(prompt).toContain("type narrowing");
    expect(prompt).toContain("rust");
    expect(prompt).toContain("depth: 3");
    expect(prompt).toContain("ownership model");
  });

  it("includes EXPLICIT INTERESTS with expert/interest/curiosity tags", () => {
    const prompt = buildInterestInferencePrompt(makePersona(), makeInput());

    expect(prompt).toContain("EXPLICIT INTERESTS");
    expect(prompt).toContain("[expert] typescript");
    expect(prompt).toContain("[interest] rust");
    expect(prompt).toContain("[curiosity] wasm");
    expect(prompt).toContain("[curiosity] eBPF");
  });

  it("includes KNOWLEDGE GAPS for curiosity domains not in persona.domains", () => {
    const prompt = buildInterestInferencePrompt(makePersona(), makeInput());

    expect(prompt).toContain("KNOWLEDGE GAPS");
    // "eBPF" is in curiosityDomains but NOT in persona.domains keys
    expect(prompt).toContain("- eBPF");
    // "wasm" is in curiosityDomains but NOT in persona.domains keys
    expect(prompt).toContain("- wasm");
  });

  it("includes DOMAIN CONNECTIONS from domainGraph edges", () => {
    const prompt = buildInterestInferencePrompt(makePersona(), makeInput());

    expect(prompt).toContain("DOMAIN CONNECTIONS");
    expect(prompt).toContain("typescript ↔ rust");
    expect(prompt).toContain("7 co-occurrences");
    expect(prompt).toContain("rust ↔ wasm");
    expect(prompt).toContain("3 co-occurrences");
  });

  it("includes RECENT FOCUS section", () => {
    const prompt = buildInterestInferencePrompt(makePersona(), makeInput());

    expect(prompt).toContain("RECENT FOCUS");
    expect(prompt).toContain("- wasm");
    expect(prompt).toContain("- type-systems");
    expect(prompt).not.toContain("PENDING QUESTIONS");
  });

  it("includes avoidTopics with top recurrent domains", () => {
    const prompt = buildInterestInferencePrompt(makePersona(), makeInput());

    // avoidTopics are the top 3 domains sorted by recurrence
    // typescript has recurrence 10, rust has recurrence 4
    expect(prompt).toContain("avoidTopics");
    expect(prompt).toContain("typescript");
    expect(prompt).toContain("rust");
  });

  it("handles persona with empty domains gracefully", () => {
    const persona = makePersona({
      domains: {},
      domainGraph: undefined,
    });
    const prompt = buildInterestInferencePrompt(persona, makeInput());

    expect(prompt).toContain("(no domains established yet)");
    expect(prompt).toContain("(no domain connections yet)");
  });

  it("handles persona with no domainGraph gracefully", () => {
    const persona = makePersona({ domainGraph: undefined });
    const prompt = buildInterestInferencePrompt(persona, makeInput());

    expect(prompt).toContain("(no domain connections yet)");
  });
});

// ---------------------------------------------------------------------------
// inferSearchStrategy
// ---------------------------------------------------------------------------

describe("inferSearchStrategy", () => {
  it("returns ok:true with valid SearchStrategy on successful LLM response", async () => {
    const result = await inferSearchStrategy(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps(validStrategyJSON()),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return; // type guard
    const strategy: SearchStrategy = result.strategy;
    expect(strategy.inferredInterest).toBe("eBPF distributed tracing");
    expect(strategy.searchQuery).toBe("eBPF distributed tracing observability");
    expect(strategy.bridgeReasoning).toBe("User knows Rust and observability, eBPF bridges both");
    expect(strategy.avoidTopics).toEqual(["rust", "typescript"]);
    expect(strategy.estimatedSurprise).toBeCloseTo(0.8);
  });

  it("returns ok:false when LLM returns empty text", async () => {
    const result = await inferSearchStrategy(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps(""),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("empty response");
    }
  });

  it("returns ok:false when LLM returns malformed JSON", async () => {
    const result = await inferSearchStrategy(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps("this is not json {{{"),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid JSON");
    }
  });

  it("returns ok:false when prepareModel returns error", async () => {
    const deps: InterestInferenceDeps = {
      complete: async () => assistantMessage("unused"),
      prepareModel: async () => ({ error: "no model available" }),
    };

    const result = await inferSearchStrategy(
      makePersona(),
      makeInput(),
      makeConfig(),
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Model preparation failed");
    }
  });

  it("returns ok:false on LLM timeout", async () => {
    const deps: InterestInferenceDeps = {
      complete: async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      },
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    };

    const result = await inferSearchStrategy(
      makePersona(),
      makeInput(),
      makeConfig(),
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Interest inference failed");
    }
  });

  it("includes recency instruction in prompt for surprise mode", () => {
    const persona = makePersona();
    const input: InsightEngineInput = {
      targetDomains: ["typescript"],
      recentFocus: [],
      trustScore: 0.8,
      recentInsightIds: [],
      recentInsightContents: [],
      recentQueryHistory: [],
    };
    const prompt = buildInterestInferencePrompt(persona, input, "surprise");
    expect(prompt).toContain("recent developments");
    expect(prompt).toContain("current year");
  });

  it("includes recency instruction in prompt for extend mode", () => {
    const persona = makePersona();
    const input: InsightEngineInput = {
      targetDomains: ["typescript"],
      recentFocus: [],
      trustScore: 0.8,
      recentInsightIds: [],
      recentInsightContents: [],
      recentQueryHistory: [],
    };
    const prompt = buildInterestInferencePrompt(persona, input, "extend");
    expect(prompt).toContain("current year");
  });

  it("returns ok:false on missing required fields in response", async () => {
    const incompleteJSON = JSON.stringify({
      inferredInterest: "something",
      // missing searchQuery, bridgeReasoning, avoidTopics, estimatedSurprise
    });

    const result = await inferSearchStrategy(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps(incompleteJSON),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Missing required fields");
    }
  });

  it("clamps estimatedSurprise to [0, 1]", async () => {
    const outOfRangeJSON = JSON.stringify({
      inferredInterest: "test interest",
      searchQuery: "test query",
      bridgeReasoning: "test reasoning",
      avoidTopics: ["a"],
      estimatedSurprise: 2.5,
    });

    const result = await inferSearchStrategy(
      makePersona(),
      makeInput(),
      makeConfig(),
      successDeps(outOfRangeJSON),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy.estimatedSurprise).toBe(1);
  });

  it("uses inferenceModel from config when set", async () => {
    let capturedModelRef: string | undefined;
    const deps: InterestInferenceDeps = {
      complete: async () => assistantMessage(validStrategyJSON()),
      prepareModel: async (_cfg, modelRef) => {
        capturedModelRef = modelRef;
        return { model: TEST_MODEL, auth: TEST_AUTH };
      },
    };

    const config = makeConfig({
      cognitive: {
        insight: {
          sources: { webSearchProvider: "zai" },
          inferenceModel: "custom/inference-model",
        },
      },
    } as Partial<KaijiBotConfig>);

    await inferSearchStrategy(makePersona(), makeInput(), config, deps);

    expect(capturedModelRef).toBe("custom/inference-model");
  });

  it("falls back to extractionModel when inferenceModel not set", async () => {
    let capturedModelRef: string | undefined;
    const deps: InterestInferenceDeps = {
      complete: async () => assistantMessage(validStrategyJSON()),
      prepareModel: async (_cfg, modelRef) => {
        capturedModelRef = modelRef;
        return { model: TEST_MODEL, auth: TEST_AUTH };
      },
    };

    const config = makeConfig({
      cognitive: {
        insight: { sources: { webSearchProvider: "zai" } },
        persona: { extractionModel: "fallback/extraction-model" },
      },
    } as Partial<KaijiBotConfig>);

    await inferSearchStrategy(makePersona(), makeInput(), config, deps);

    expect(capturedModelRef).toBe("fallback/extraction-model");
  });

  it("falls back to zai/glm-5-turbo when neither model config is set", async () => {
    let capturedModelRef: string | undefined;
    const deps: InterestInferenceDeps = {
      complete: async () => assistantMessage(validStrategyJSON()),
      prepareModel: async (_cfg, modelRef) => {
        capturedModelRef = modelRef;
        return { model: TEST_MODEL, auth: TEST_AUTH };
      },
    };

    // makeConfig with no inferenceModel or extractionModel
    const config = makeConfig();

    await inferSearchStrategy(makePersona(), makeInput(), config, deps);

    expect(capturedModelRef).toBe("zai/glm-5-turbo");
  });
});
