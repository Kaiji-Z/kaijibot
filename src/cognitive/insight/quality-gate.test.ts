import type { Api, AssistantMessage, Model } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import type { BlindSpotCandidate, QualityAssessment } from "./fragment-types.js";
import { QUALITY_PILLAR_WEIGHTS } from "./fragment-types.js";
import type { QualityGateDeps } from "./quality-gate.js";
import {
  assessQuality,
  computeStructuralNovelty,
  computeActionability,
  computeEmotionalReadiness,
} from "./quality-gate.js";

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

function makeSuccessDeps(responseText: string): QualityGateDeps {
  return {
    complete: vi.fn(async () => assistantMessage(responseText)),
    prepareModel: vi.fn(async () => ({ model: TEST_MODEL, auth: TEST_AUTH })),
  };
}

function makePersona(overrides?: Partial<PersonaTree>): PersonaTree {
  return {
    identity: {
      coreTraits: {},
      expertDomains: ["typescript"],
      interestDomains: ["rust"],
      curiosityDomains: [],
    },
    domains: {
      typescript: {
        depth: 5,
        recurrence: 10,
        lastMentioned: Date.now(),
        keyInsights: ["type narrowing", "generics"],
        activeQuestions: [],
        connections: [],
        negationSignals: 0,
      },
    },
    recentFocus: [],
    activeProjects: [],
    pendingQuestions: [],
    feedbackProfile: {
      topicBandits: {},
      preferredStyle: "observation",
      optimalFrequencyHours: 4,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: ["previous insight"],
    },
    rapport: {
      trustScore: 0.75,
      totalExchanges: 50,
      avgResponseLength: 120,
      selfDisclosureLevel: 0.4,
    },
    domainBlacklist: [],
    lifecycle: { stage: "active", lastActiveAt: 0, lastStageTransitionAt: 0, consecutiveSilentDays: 0, totalActiveDays: 10 },
    calibrationHistory: [],
    contradictionLog: [],
    moodHistory: [],
    ...overrides,
  };
}

function makeBlindSpot(overrides?: Partial<BlindSpotCandidate>): BlindSpotCandidate {
  return {
    id: "bs-1",
    blindSpot: "You assume all async patterns need Promises, but AsyncGenerators may be better for streaming",
    supportingFragmentIds: ["frag-1", "frag-2"],
    potentialImpact: "efficiency_gain",
    domains: ["typescript", "rust"],
    unusedDomains: [],
    crystallizationScore: 0.7,
    ...overrides,
  };
}

function makeConfig(): KaijiBotConfig {
  return {} as KaijiBotConfig;
}

// ─── Composite scoring ───

describe("assessQuality — composite scoring", () => {
  it("returns 'deliver' when composite >= 0.75", async () => {
    const result = await assessQuality(
      makeBlindSpot(),
      makePersona(),
      makeConfig(),
      makeSuccessDeps("0.9"),
    );
    expect(result.verdict).toBe("deliver");
    expect(result.composite).toBeGreaterThanOrEqual(0.75);
  });

  it("returns 'park' when composite 0.60-0.74", async () => {
    const result = await assessQuality(
      makeBlindSpot({ potentialImpact: "direction_change", domains: ["typescript"], unusedDomains: [] }),
      makePersona({
        rapport: { trustScore: 0.5, totalExchanges: 15, avgResponseLength: 80, selfDisclosureLevel: 0.2 },
        lifecycle: { stage: "active", lastActiveAt: 0, lastStageTransitionAt: 0, consecutiveSilentDays: 0, totalActiveDays: 5 },
      }),
      makeConfig(),
      makeSuccessDeps("0.6"),
    );
    expect(result.verdict).toBe("park");
    expect(result.composite).toBeGreaterThanOrEqual(0.60);
    expect(result.composite).toBeLessThan(0.75);
  });

  it("returns 'discard' when composite < 0.60", async () => {
    const result = await assessQuality(
      makeBlindSpot({ potentialImpact: "connection_reveal", domains: ["typescript"], unusedDomains: [] }),
      makePersona({
        feedbackProfile: {
          topicBandits: {},
          preferredStyle: "observation",
          optimalFrequencyHours: 4,
          lastProactiveAt: 0,
          recentInsightIds: [],
          recentInsightContents: ["x"],
          suppressUntil: Date.now() + 100000,
        },
        rapport: { trustScore: 0.1, totalExchanges: 2, avgResponseLength: 30, selfDisclosureLevel: 0.1 },
      }),
      makeConfig(),
      makeSuccessDeps("0.2"),
    );
    expect(result.verdict).toBe("discard");
    expect(result.composite).toBeLessThan(0.60);
  });

  it("computes composite as weighted sum", async () => {
    const result = await assessQuality(
      makeBlindSpot(),
      makePersona(),
      makeConfig(),
      makeSuccessDeps("0.8"),
    );
    const expectedComposite =
      result.structuralNovelty * QUALITY_PILLAR_WEIGHTS.structuralNovelty +
      result.actionability * QUALITY_PILLAR_WEIGHTS.actionability +
      result.emotionalReadiness * QUALITY_PILLAR_WEIGHTS.emotionalReadiness +
      result.nonObviousness * QUALITY_PILLAR_WEIGHTS.nonObviousness;
    expect(result.composite).toBeCloseTo(expectedComposite, 10);
  });

  it("nonObviousness (weight 0.4) dominates", async () => {
    const highNo = await assessQuality(
      makeBlindSpot({ domains: ["typescript"], unusedDomains: [] }),
      makePersona(),
      makeConfig(),
      makeSuccessDeps("1.0"),
    );
    const lowNo = await assessQuality(
      makeBlindSpot({ potentialImpact: "efficiency_gain", domains: ["typescript", "rust", "go", "python", "java"], unusedDomains: ["ai", "ml", "data"] }),
      makePersona({
        rapport: { trustScore: 1.0, totalExchanges: 100, avgResponseLength: 200, selfDisclosureLevel: 0.8 },
        lifecycle: { stage: "active", lastActiveAt: 0, lastStageTransitionAt: 0, consecutiveSilentDays: 0, totalActiveDays: 50 },
      }),
      makeConfig(),
      makeSuccessDeps("0.0"),
    );
    expect(highNo.composite).toBeGreaterThan(lowNo.composite);
  });
});

// ─── structuralNovelty ───

describe("computeStructuralNovelty", () => {
  it("increases with domain diversity", () => {
    const single = computeStructuralNovelty(makeBlindSpot({ domains: ["typescript"] }));
    const multi = computeStructuralNovelty(makeBlindSpot({ domains: ["typescript", "rust", "go"] }));
    expect(multi).toBeGreaterThan(single);
  });

  it("increases with unused expert domains", () => {
    const none = computeStructuralNovelty(makeBlindSpot({ unusedDomains: [] }));
    const withUnused = computeStructuralNovelty(makeBlindSpot({ unusedDomains: ["ai", "ml"] }));
    expect(withUnused).toBeGreaterThan(none);
  });

  it("returns base 0.3 for single-domain, no unused domains", () => {
    const result = computeStructuralNovelty(makeBlindSpot({ domains: ["typescript"], unusedDomains: [] }));
    expect(result).toBeCloseTo(0.45, 10);
  });
});

// ─── actionability ───

describe("computeActionability", () => {
  it("efficiency_gain → 0.9", () => {
    expect(computeActionability(makeBlindSpot({ potentialImpact: "efficiency_gain" }))).toBe(0.9);
  });

  it("direction_change → 0.8", () => {
    expect(computeActionability(makeBlindSpot({ potentialImpact: "direction_change" }))).toBe(0.8);
  });

  it("risk_avoidance → 0.7", () => {
    expect(computeActionability(makeBlindSpot({ potentialImpact: "risk_avoidance" }))).toBe(0.7);
  });

  it("connection_reveal → 0.5", () => {
    expect(computeActionability(makeBlindSpot({ potentialImpact: "connection_reveal" }))).toBe(0.5);
  });
});

// ─── emotionalReadiness ───

describe("computeEmotionalReadiness", () => {
  it("increases with trust score", () => {
    const low = computeEmotionalReadiness(makePersona({ rapport: { trustScore: 0.2, totalExchanges: 5, avgResponseLength: 50, selfDisclosureLevel: 0.1 } }));
    const high = computeEmotionalReadiness(makePersona({ rapport: { trustScore: 0.9, totalExchanges: 100, avgResponseLength: 200, selfDisclosureLevel: 0.7 } }));
    expect(high).toBeGreaterThan(low);
  });

  it("returns 0.0 when suppressUntil in future", () => {
    const result = computeEmotionalReadiness(makePersona({
      feedbackProfile: {
        topicBandits: {},
        preferredStyle: "observation",
        optimalFrequencyHours: 4,
        lastProactiveAt: 0,
        recentInsightIds: [],
        recentInsightContents: [],
        suppressUntil: Date.now() + 3600000,
      },
    }));
    expect(result).toBe(0.0);
  });

  it("low for 'new' stage", () => {
    const newResult = computeEmotionalReadiness(makePersona({
      rapport: { trustScore: 0.3, totalExchanges: 3, avgResponseLength: 40, selfDisclosureLevel: 0.1 },
      lifecycle: { stage: "new", lastActiveAt: 0, lastStageTransitionAt: 0, consecutiveSilentDays: 0, totalActiveDays: 0 },
      feedbackProfile: {
        topicBandits: {},
        preferredStyle: "observation",
        optimalFrequencyHours: 4,
        lastProactiveAt: 0,
        recentInsightIds: [],
        recentInsightContents: ["existing"],
      },
    }));
    expect(newResult).toBeLessThan(0.5);
  });

  it("higher for 'active' stage", () => {
    const activeResult = computeEmotionalReadiness(makePersona({
      lifecycle: { stage: "active", lastActiveAt: 0, lastStageTransitionAt: 0, consecutiveSilentDays: 0, totalActiveDays: 10 },
      feedbackProfile: {
        topicBandits: {},
        preferredStyle: "observation",
        optimalFrequencyHours: 4,
        lastProactiveAt: 0,
        recentInsightIds: [],
        recentInsightContents: ["existing"],
      },
    }));
    expect(activeResult).toBeGreaterThan(0.3);
  });
});

// ─── nonObviousness LLM ───

describe("assessQuality — nonObviousness LLM", () => {
  it("parses numeric score from response", async () => {
    const result = await assessQuality(
      makeBlindSpot(),
      makePersona(),
      makeConfig(),
      makeSuccessDeps("0.85"),
    );
    expect(result.nonObviousness).toBe(0.85);
  });

  it("returns 0.5 on LLM throw", async () => {
    const deps: QualityGateDeps = {
      complete: vi.fn(async () => { throw new Error("LLM unavailable"); }),
      prepareModel: vi.fn(async () => ({ model: TEST_MODEL, auth: TEST_AUTH })),
    };
    const result = await assessQuality(
      makeBlindSpot(),
      makePersona(),
      makeConfig(),
      deps,
    );
    expect(result.nonObviousness).toBe(0.5);
  });

  it("returns 0.5 on prepareModel error", async () => {
    const deps: QualityGateDeps = {
      complete: vi.fn(async () => assistantMessage("0.9")),
      prepareModel: vi.fn(async () => ({ error: "No API key" })),
    };
    const result = await assessQuality(
      makeBlindSpot(),
      makePersona(),
      makeConfig(),
      deps,
    );
    expect(result.nonObviousness).toBe(0.5);
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it("returns 0.5 on non-numeric response", async () => {
    const result = await assessQuality(
      makeBlindSpot(),
      makePersona(),
      makeConfig(),
      makeSuccessDeps("not a number"),
    );
    expect(result.nonObviousness).toBe(0.5);
  });

  it("clamps score to 0-1", async () => {
    const overOne = await assessQuality(
      makeBlindSpot(),
      makePersona(),
      makeConfig(),
      makeSuccessDeps("1.5"),
    );
    expect(overOne.nonObviousness).toBe(1.0);

    const underZero = await assessQuality(
      makeBlindSpot(),
      makePersona(),
      makeConfig(),
      makeSuccessDeps("-0.3"),
    );
    expect(underZero.nonObviousness).toBe(0.0);
  });
});
