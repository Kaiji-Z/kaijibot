import type { Api, AssistantMessage, Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import type { InsightCandidate, LlmCritiqueResult } from "./types.js";
import {
  buildCritiquePrompt,
  buildRefinePrompt,
  buildVerificationPrompt,
  critiqueInsightWithLLM,
  refineInsightWithLLM,
  verifyInsightWithLLM,
  type LlmInsightDeps,
} from "./llm-engine.js";

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
      displayName: "TestUser",
    },
    domains: {
      typescript: {
        depth: 5,
        recurrence: 10,
        lastMentioned: Date.now(),
        keyInsights: ["type narrowing", "template literal types"],
        activeQuestions: [],
        negationSignals: 0,
      },
      rust: {
        depth: 3,
        recurrence: 4,
        lastMentioned: Date.now(),
        keyInsights: ["ownership model"],
        activeQuestions: [],
        negationSignals: 0,
      },
    },
    recentFocus: ["wasm", "type-systems"],
    feedbackProfile: {
      topicBandits: {},
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
    lifecycle: { stage: "new", lastActiveAt: 0, lastStageTransitionAt: 0, totalActiveDays: 0 },
    calibrationHistory: [],
    moodHistory: [],
    ...overrides,
  };
}

function makeCandidate(overrides?: Partial<InsightCandidate>): InsightCandidate {
  return {
    id: "test-candidate-id",
    content: "Rust编译到WASM的性能实测比JS快3-10倍，结合你对TypeScript的关注，embassy框架的async/await模型可能更适合你的场景。",
    rationale: "Cross-domain bridge between user's Rust and TypeScript interests",
    targetDomains: ["rust", "typescript"],
    sourceDomains: ["wasm"],
    relevanceScore: 0.85,
    surpriseScore: 0.7,
    compositeScore: 0.775,
    sources: [{ url: "https://example.com/rust-wasm", title: "Rust WASM Benchmarks", credibility: 0.8 }],
    verificationStatus: "unverified",
    promptVariant: { fewShotSet: 0, frameIndex: 2, structureSeed: 1 },
    ...overrides,
  };
}

function makeConfig(): KaijiBotConfig {
  return {
    cognitive: { insight: { sources: { webSearchProvider: "zai" } } },
  } as KaijiBotConfig;
}

function successDeps(responseText: string): LlmInsightDeps {
  return {
    complete: async () => assistantMessage(responseText),
    prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
  };
}

const errorDeps: LlmInsightDeps = {
  complete: async () => { throw new Error("LLM error"); },
  prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
};

const prepareErrorDeps: LlmInsightDeps = {
  complete: async () => assistantMessage("unused"),
  prepareModel: async () => ({ error: "no model" }),
};

function validCritiqueJSON(): string {
  return JSON.stringify({
    specificity: 0.8,
    personaRelevance: 0.75,
    actionability: 0.6,
    surprise: 0.7,
    voiceMatch: 0.85,
    overallScore: 0.74,
    critique: "Good specificity and persona relevance. Could be more actionable.",
    improvementSuggestions: ["Add a concrete next step", "Reference specific TypeScript features"],
  });
}

function validRefineJSON(): string {
  return JSON.stringify([{
    content: "Rust编译到WASM在计算密集场景下比JS快3-10倍——embassy框架的async/await模型跟你写TypeScript的思维完全一致，你可以试试用它替代tokio做嵌入式并发。",
    rationale: "Added concrete action and specific TS parallel",
    targetDomains: ["rust", "typescript"],
    sourceDomains: ["wasm"],
    relevanceScore: 0.9,
    surpriseScore: 0.75,
  }]);
}

// ---------------------------------------------------------------------------
// buildCritiquePrompt
// ---------------------------------------------------------------------------

describe("buildCritiquePrompt", () => {
  it("contains candidate content", () => {
    const prompt = buildCritiquePrompt(makeCandidate(), makePersona());
    expect(prompt).toContain("Rust编译到WASM");
  });

  it("contains evaluation criteria for all 5 dimensions", () => {
    const prompt = buildCritiquePrompt(makeCandidate(), makePersona());
    expect(prompt).toContain("SPECIFICITY");
    expect(prompt).toContain("PERSONA RELEVANCE");
    expect(prompt).toContain("ACTIONABILITY");
    expect(prompt).toContain("SURPRISE");
    expect(prompt).toContain("VOICE MATCH");
  });

  it("includes persona context", () => {
    const prompt = buildCritiquePrompt(makeCandidate(), makePersona());
    expect(prompt).toContain("TestUser");
    expect(prompt).toContain("typescript");
    expect(prompt).toContain("type narrowing");
  });

  it("includes candidate targetDomains and rationale", () => {
    const candidate = makeCandidate();
    const prompt = buildCritiquePrompt(candidate, makePersona());
    expect(prompt).toContain(candidate.targetDomains.join(", "));
    expect(prompt).toContain(candidate.rationale);
  });

  it("requests JSON output with required fields", () => {
    const prompt = buildCritiquePrompt(makeCandidate(), makePersona());
    expect(prompt).toContain("overallScore");
    expect(prompt).toContain("critique");
    expect(prompt).toContain("improvementSuggestions");
  });
});

// ---------------------------------------------------------------------------
// buildRefinePrompt
// ---------------------------------------------------------------------------

describe("buildRefinePrompt", () => {
  const critique: LlmCritiqueResult = {
    specificity: 0.6,
    personaRelevance: 0.7,
    actionability: 0.4,
    surprise: 0.8,
    voiceMatch: 0.9,
    overallScore: 0.68,
    critique: "Needs more actionable content",
    improvementSuggestions: ["Add a concrete next step", "Reference specific tools"],
  };

  it("contains original prompt", () => {
    const prompt = buildRefinePrompt("original generation prompt text", makeCandidate(), critique, makePersona());
    expect(prompt).toContain("original generation prompt text");
  });

  it("contains candidate content", () => {
    const prompt = buildRefinePrompt("prompt", makeCandidate(), critique, makePersona());
    expect(prompt).toContain("Rust编译到WASM");
  });

  it("contains critique suggestions", () => {
    const prompt = buildRefinePrompt("prompt", makeCandidate(), critique, makePersona());
    expect(prompt).toContain("Add a concrete next step");
    expect(prompt).toContain("Reference specific tools");
  });

  it("contains overall score", () => {
    const prompt = buildRefinePrompt("prompt", makeCandidate(), critique, makePersona());
    expect(prompt).toContain("0.68");
  });

  it("contains critique text", () => {
    const prompt = buildRefinePrompt("prompt", makeCandidate(), critique, makePersona());
    expect(prompt).toContain("Needs more actionable content");
  });

  it("includes REVISED instruction", () => {
    const prompt = buildRefinePrompt("prompt", makeCandidate(), critique, makePersona());
    expect(prompt).toContain("REVISED");
  });
});

// ---------------------------------------------------------------------------
// critiqueInsightWithLLM
// ---------------------------------------------------------------------------

describe("critiqueInsightWithLLM", () => {
  it("returns LlmCritiqueResult with valid JSON response", async () => {
    const result = await critiqueInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), successDeps(validCritiqueJSON()),
    );
    expect(result).not.toBeNull();
    expect(result!.specificity).toBeCloseTo(0.8);
    expect(result!.personaRelevance).toBeCloseTo(0.75);
    expect(result!.actionability).toBeCloseTo(0.6);
    expect(result!.surprise).toBeCloseTo(0.7);
    expect(result!.voiceMatch).toBeCloseTo(0.85);
    expect(result!.overallScore).toBeCloseTo(0.74);
    expect(result!.critique).toContain("Good specificity");
    expect(result!.improvementSuggestions).toHaveLength(2);
  });

  it("returns null on LLM error", async () => {
    const result = await critiqueInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), errorDeps,
    );
    expect(result).toBeNull();
  });

  it("returns null on prepareModel error", async () => {
    const result = await critiqueInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), prepareErrorDeps,
    );
    expect(result).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    const result = await critiqueInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), successDeps("this is not json {{{"),
    );
    expect(result).toBeNull();
  });

  it("returns null when required fields are missing", async () => {
    const incomplete = JSON.stringify({ specificity: 0.5, critique: "missing fields" });
    const result = await critiqueInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), successDeps(incomplete),
    );
    expect(result).toBeNull();
  });

  it("returns null when improvementSuggestions is not an array", async () => {
    const bad = JSON.stringify({
      specificity: 0.5, personaRelevance: 0.5, actionability: 0.5,
      surprise: 0.5, voiceMatch: 0.5, overallScore: 0.5,
      critique: "ok", improvementSuggestions: "not an array",
    });
    const result = await critiqueInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), successDeps(bad),
    );
    expect(result).toBeNull();
  });

  it("clamps out-of-range scores to 0-1", async () => {
    const outOfRange = JSON.stringify({
      specificity: 2.5, personaRelevance: -0.5, actionability: 0.5,
      surprise: 0.5, voiceMatch: 1.5, overallScore: 0.5,
      critique: "out of range", improvementSuggestions: ["fix"],
    });
    const result = await critiqueInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), successDeps(outOfRange),
    );
    expect(result).not.toBeNull();
    expect(result!.specificity).toBe(1);
    expect(result!.personaRelevance).toBe(0);
    expect(result!.voiceMatch).toBe(1);
  });

  it("returns null on empty LLM response", async () => {
    const result = await critiqueInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), successDeps(""),
    );
    expect(result).toBeNull();
  });

  it("never throws even when everything fails", async () => {
    const bombDeps: LlmInsightDeps = {
      complete: async () => { throw new Error("catastrophic"); },
      prepareModel: async () => { throw new Error("also broke"); },
    };
    const result = await critiqueInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), bombDeps,
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// refineInsightWithLLM
// ---------------------------------------------------------------------------

describe("refineInsightWithLLM", () => {
  const critique: LlmCritiqueResult = {
    specificity: 0.6, personaRelevance: 0.7, actionability: 0.4,
    surprise: 0.8, voiceMatch: 0.9, overallScore: 0.68,
    critique: "Needs more actionable content",
    improvementSuggestions: ["Add a concrete next step"],
  };

  it("returns refined InsightCandidate with valid LLM response", async () => {
    const result = await refineInsightWithLLM(
      "original prompt", makeCandidate(), critique, makePersona(), makeConfig(), successDeps(validRefineJSON()),
    );
    expect(result).not.toBeNull();
    expect(result!.content).toContain("embassy");
  });

  it("preserves original id", async () => {
    const candidate = makeCandidate({ id: "my-special-id" });
    const result = await refineInsightWithLLM(
      "prompt", candidate, critique, makePersona(), makeConfig(), successDeps(validRefineJSON()),
    );
    expect(result).not.toBeNull();
    expect(result!.id).toBe("my-special-id");
  });

  it("preserves original targetDomains", async () => {
    const candidate = makeCandidate({ targetDomains: ["rust", "typescript"] });
    const result = await refineInsightWithLLM(
      "prompt", candidate, critique, makePersona(), makeConfig(), successDeps(validRefineJSON()),
    );
    expect(result).not.toBeNull();
    expect(result!.targetDomains).toEqual(["rust", "typescript"]);
  });

  it("preserves original sources", async () => {
    const candidate = makeCandidate();
    const result = await refineInsightWithLLM(
      "prompt", candidate, critique, makePersona(), makeConfig(), successDeps(validRefineJSON()),
    );
    expect(result).not.toBeNull();
    expect(result!.sources).toEqual(candidate.sources);
  });

  it("preserves original promptVariant", async () => {
    const candidate = makeCandidate({ promptVariant: { fewShotSet: 2, frameIndex: 1 } });
    const result = await refineInsightWithLLM(
      "prompt", candidate, critique, makePersona(), makeConfig(), successDeps(validRefineJSON()),
    );
    expect(result).not.toBeNull();
    expect(result!.promptVariant).toEqual({ fewShotSet: 2, frameIndex: 1 });
  });

  it("returns null on LLM error", async () => {
    const result = await refineInsightWithLLM(
      "prompt", makeCandidate(), critique, makePersona(), makeConfig(), errorDeps,
    );
    expect(result).toBeNull();
  });

  it("returns null on prepareModel error", async () => {
    const result = await refineInsightWithLLM(
      "prompt", makeCandidate(), critique, makePersona(), makeConfig(), prepareErrorDeps,
    );
    expect(result).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    const result = await refineInsightWithLLM(
      "prompt", makeCandidate(), critique, makePersona(), makeConfig(), successDeps("not json"),
    );
    expect(result).toBeNull();
  });

  it("returns null on empty LLM response", async () => {
    const result = await refineInsightWithLLM(
      "prompt", makeCandidate(), critique, makePersona(), makeConfig(), successDeps(""),
    );
    expect(result).toBeNull();
  });

  it("never throws even when everything fails", async () => {
    const bombDeps: LlmInsightDeps = {
      complete: async () => { throw new Error("catastrophic"); },
      prepareModel: async () => { throw new Error("also broke"); },
    };
    const result = await refineInsightWithLLM(
      "prompt", makeCandidate(), critique, makePersona(), makeConfig(), bombDeps,
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildVerificationPrompt
// ---------------------------------------------------------------------------

describe("buildVerificationPrompt", () => {
  it("contains candidate content", () => {
    const prompt = buildVerificationPrompt(makeCandidate(), makePersona());
    expect(prompt).toContain("Rust编译到WASM");
  });

  it("contains evaluation criteria", () => {
    const prompt = buildVerificationPrompt(makeCandidate(), makePersona());
    expect(prompt).toContain("verified");
    expect(prompt).toContain("partial");
    expect(prompt).toContain("unverified");
    expect(prompt).toContain("contradicted");
  });

  it("contains persona context", () => {
    const prompt = buildVerificationPrompt(makeCandidate(), makePersona());
    expect(prompt).toContain("TestUser");
    expect(prompt).toContain("type narrowing");
  });

  it("contains source information when sources exist", () => {
    const prompt = buildVerificationPrompt(makeCandidate(), makePersona());
    expect(prompt).toContain("Rust WASM Benchmarks");
    expect(prompt).toContain("https://example.com/rust-wasm");
  });

  it("shows no sources message when no sources", () => {
    const candidate = makeCandidate({ sources: [] });
    const prompt = buildVerificationPrompt(candidate, makePersona());
    expect(prompt).toContain("(no sources)");
  });

  it("requests JSON output with required fields", () => {
    const prompt = buildVerificationPrompt(makeCandidate(), makePersona());
    expect(prompt).toContain("approved");
    expect(prompt).toContain("confidence");
    expect(prompt).toContain("status");
    expect(prompt).toContain("notes");
  });
});

// ---------------------------------------------------------------------------
// verifyInsightWithLLM
// ---------------------------------------------------------------------------

describe("verifyInsightWithLLM", () => {
  function verifyJSON(overrides?: Record<string, unknown>): string {
    return JSON.stringify({
      approved: true,
      confidence: 0.85,
      status: "verified",
      notes: "High quality insight",
      ...overrides,
    });
  }

  it("returns status 'verified' with high confidence", async () => {
    const result = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), successDeps(verifyJSON({ confidence: 0.9, status: "verified" })),
    );
    expect(result.status).toBe("verified");
    expect(result.confidence).toBeCloseTo(0.9);
    expect(result.notes).toContain("High quality");
  });

  it("returns status 'partial' with medium confidence", async () => {
    const result = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), successDeps(verifyJSON({ confidence: 0.5, status: "partial" })),
    );
    expect(result.status).toBe("partial");
  });

  it("returns status 'unverified' with low confidence", async () => {
    const result = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), successDeps(verifyJSON({ confidence: 0.2, status: "unverified" })),
    );
    expect(result.status).toBe("unverified");
  });

  it("returns status 'contradicted' when LLM says contradicted", async () => {
    const result = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(),
      successDeps(verifyJSON({ confidence: 0.6, status: "contradicted", approved: false })),
    );
    expect(result.status).toBe("contradicted");
  });

  it("preserves candidate sources in result", async () => {
    const candidate = makeCandidate({
      sources: [
        { url: "https://example.com/1", title: "Source 1", credibility: 0.8 },
        { url: "https://example.com/2", title: "Source 2", credibility: 0.6 },
      ],
    });
    const result = await verifyInsightWithLLM(
      candidate, makePersona(), makeConfig(), successDeps(verifyJSON()),
    );
    expect(result.sources).toEqual(candidate.sources);
    expect(result.sources).toHaveLength(2);
  });

  it("returns unverified with confidence 0 on malformed JSON", async () => {
    const result = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), successDeps("not json {{{"),
    );
    expect(result.status).toBe("unverified");
    expect(result.confidence).toBe(0);
    expect(result.notes).toContain("Verification unavailable");
  });

  it("returns unverified with confidence 0 on LLM error", async () => {
    const result = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), errorDeps,
    );
    expect(result.status).toBe("unverified");
    expect(result.confidence).toBe(0);
  });

  it("returns unverified with confidence 0 on prepareModel error", async () => {
    const result = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), prepareErrorDeps,
    );
    expect(result.status).toBe("unverified");
    expect(result.confidence).toBe(0);
  });

  it("returns unverified on empty LLM response", async () => {
    const result = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), successDeps(""),
    );
    expect(result.status).toBe("unverified");
    expect(result.confidence).toBe(0);
  });

  it("preserves candidate sources even on failure", async () => {
    const candidate = makeCandidate({
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
    });
    const result = await verifyInsightWithLLM(
      candidate, makePersona(), makeConfig(), errorDeps,
    );
    expect(result.sources).toEqual(candidate.sources);
  });

  it("never throws even when everything fails", async () => {
    const bombDeps: LlmInsightDeps = {
      complete: async () => { throw new Error("catastrophic"); },
      prepareModel: async () => { throw new Error("also broke"); },
    };
    const result = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(), bombDeps,
    );
    expect(result.status).toBe("unverified");
    expect(result.confidence).toBe(0);
  });

  it("uses confidence thresholds for status mapping when LLM status is not contradicted", async () => {
    const highResult = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(),
      successDeps(verifyJSON({ confidence: 0.75, status: "verified" })),
    );
    expect(highResult.status).toBe("verified");

    const midResult = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(),
      successDeps(verifyJSON({ confidence: 0.5, status: "partial" })),
    );
    expect(midResult.status).toBe("partial");

    const lowResult = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(),
      successDeps(verifyJSON({ confidence: 0.3, status: "unverified" })),
    );
    expect(lowResult.status).toBe("unverified");
  });

  it("clamps out-of-range confidence to 0-1", async () => {
    const result = await verifyInsightWithLLM(
      makeCandidate(), makePersona(), makeConfig(),
      successDeps(verifyJSON({ confidence: 2.5, status: "verified" })),
    );
    expect(result.confidence).toBe(1);
  });
});
