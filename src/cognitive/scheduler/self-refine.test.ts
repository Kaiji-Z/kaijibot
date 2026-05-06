import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProactiveScheduler } from "./proactive-scheduler.js";
import { createDefaultPersona } from "../persona/store.js";
import type { SchedulerConfig, Opportunity } from "./types.js";
import type { PersonaTree } from "../types.js";
import type { InsightCandidate } from "../insight/types.js";
import type { LlmInsightDeps } from "../insight/llm-engine.js";
import type { KaijiBotConfig } from "../../config/types.kaijibot.js";
import type { LlmCritiqueResult } from "../insight/types.js";
import type { Fragment, FragmentCluster } from "../insight/fragment-types.js";

vi.mock("../insight/llm-engine.js", () => ({
  critiqueInsightWithLLM: vi.fn(),
  refineInsightWithLLM: vi.fn(),
  verifyInsightWithLLM: vi.fn(),
  checkSemanticNoveltyWithLLM: vi.fn(),
  buildSearchQuery: vi.fn(() => "test query"),
}));

import { critiqueInsightWithLLM, refineInsightWithLLM, verifyInsightWithLLM, checkSemanticNoveltyWithLLM } from "../insight/llm-engine.js";

const mockedCritique = vi.mocked(critiqueInsightWithLLM);
const mockedRefine = vi.mocked(refineInsightWithLLM);
const mockedVerify = vi.mocked(verifyInsightWithLLM);
const mockedFreshness = vi.mocked(checkSemanticNoveltyWithLLM);

const stubFragment: Fragment = {
  id: "frag-1",
  userId: "test-user",
  createdAt: Date.now(),
  expiresAt: Date.now() + 86_400_000,
  kind: "assumption",
  evidence: "test evidence",
  domains: ["AI"],
  structuralTag: "assumption",
  strength: 0.8,
};

const stubCluster: FragmentCluster = {
  id: "cluster-1",
  fragmentIds: ["frag-1", "frag-2"],
  domains: ["AI"],
  structuralPattern: "recurring_theme",
  averageStrength: 0.7,
  createdAt: Date.now(),
};

function personaWithDomains(): PersonaTree {
  const persona = createDefaultPersona();
  persona.identity = { ...persona.identity, userId: "test-user" };
  persona.rapport.trustScore = 0.7;
  persona.rapport.totalExchanges = 10;
  persona.domains = {
    "AI": {
      depth: 5,
      recurrence: 10,
      lastMentioned: Date.now(),
      keyInsights: ["Transformer架构"],
      activeQuestions: [],
      connections: [],
      negationSignals: 0,
    },
    "Rust": {
      depth: 4,
      recurrence: 8,
      lastMentioned: Date.now(),
      keyInsights: [],
      activeQuestions: [],
      connections: [],
      negationSignals: 0,
    },
  };
  persona.feedbackProfile.topicBandits = {
    "AI": { alpha: 5, beta: 1 },
    "Rust": { alpha: 4, beta: 2 },
  };
  persona.lifecycle = { ...persona.lifecycle, stage: "active", lastActiveAt: Date.now() };
  return persona;
}

const baseConfig: SchedulerConfig = {
  minIntervalHours: 4,
  minTrustScore: 0.3,
};

const fakeLlmDeps: LlmInsightDeps = {
  complete: vi.fn(),
  prepareModel: vi.fn(),
};

const fakeBotConfig: KaijiBotConfig = {};

function makeCandidate(overrides: Partial<InsightCandidate> = {}): InsightCandidate {
  return {
    id: "test-id",
    content: "Test insight content",
    rationale: "test rationale",
    targetDomains: ["AI"],
    sourceDomains: [],
    relevanceScore: 0.5,
    surpriseScore: 0.5,
    compositeScore: 0.5,
    sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
    verificationStatus: "unverified",
    ...overrides,
  };
}

import { FragmentStore } from "../insight/fragment-store.js";

function createStubFragmentStore(): FragmentStore {
  const store = Object.create(FragmentStore.prototype) as FragmentStore;
  vi.spyOn(store, "load").mockResolvedValue([stubFragment]);
  vi.spyOn(store, "findClusters").mockResolvedValue([stubCluster]);
  return store;
}

function makeScheduler(
  schedulerConfig: SchedulerConfig = baseConfig,
  persona?: PersonaTree,
  overrides?: {
    insightGenerator?: (persona: PersonaTree) => Promise<InsightCandidate[]>;
    llmDeps?: LlmInsightDeps | undefined;
    botConfig?: KaijiBotConfig | undefined;
    patternVerification?: boolean;
    fragmentStore?: FragmentStore;
  },
): ProactiveScheduler {
  const config = { ...schedulerConfig };
  if (overrides?.patternVerification !== undefined) {
    config.patternVerification = overrides.patternVerification;
  }
  const llmDeps = overrides && "llmDeps" in overrides ? overrides.llmDeps : fakeLlmDeps;
  const botConfig = overrides && "botConfig" in overrides ? overrides.botConfig : fakeBotConfig;
  return new ProactiveScheduler(
    config,
    {
      loadPersona: async () => persona ?? personaWithDomains(),
      onInsightReady: async () => {},
      savePersona: async () => {},
    },
    {
      insightGenerator: overrides?.insightGenerator
        ? (_p, _input, _opts) => overrides.insightGenerator!(_p)
        : undefined,
      llmDeps,
      botConfig,
      fragmentStore: overrides?.fragmentStore ?? createStubFragmentStore(),
    },
  );
}

const crossDomainOpp: Opportunity = {
  type: "cross_domain",
  targetDomains: ["AI"],
  sourceDomains: ["Rust"],
  pNeed: 0.8,
  pAccept: 0.7,
  pAct: 0.56,
};

const explorationOpp: Opportunity = {
  type: "exploration",
  targetDomains: [],
  sourceDomains: [],
  pNeed: 0.55,
  pAccept: 0.7,
  pAct: 0.385,
  metadata: { mode: "surprise" },
};

const patternOpp: Opportunity = {
  type: "exploration",
  targetDomains: [],
  sourceDomains: [],
  pNeed: 0.55,
  pAccept: 0.7,
  pAct: 0.385,
  metadata: { mode: "pattern" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Self-refine: knowledge mode", () => {
  it("calls critique → refine when initial candidate is low quality", async () => {
    const persona = personaWithDomains();
    const lowQuality = makeCandidate({ compositeScore: 0.3 });
    const refinedCandidate = makeCandidate({ compositeScore: 0.9, id: "refined-id" });
    const critique: LlmCritiqueResult = {
      specificity: 0.5,
      personaRelevance: 0.4,
      actionability: 0.6,
      surprise: 0.3,
      voiceMatch: 0.5,
      overallScore: 0.4,
      critique: "needs improvement",
      improvementSuggestions: ["be more specific"],
    };

    mockedCritique.mockResolvedValueOnce(critique);
    mockedRefine.mockResolvedValueOnce(refinedCandidate);
    mockedVerify.mockResolvedValueOnce({
      status: "verified",
      sources: [],
      confidence: 0.8,
      notes: "good",
    });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [lowQuality],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(mockedCritique).toHaveBeenCalledTimes(1);
    expect(mockedRefine).toHaveBeenCalledTimes(1);
    expect(result!.compositeScore).toBe(0.9);
  });

  it("skips critique/refine when first candidate scores ≥ 0.85", async () => {
    const persona = personaWithDomains();
    const highQuality = makeCandidate({ compositeScore: 0.9 });

    mockedVerify.mockResolvedValueOnce({
      status: "verified",
      sources: [],
      confidence: 0.8,
      notes: "good",
    });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [highQuality],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(mockedCritique).not.toHaveBeenCalled();
    expect(mockedRefine).not.toHaveBeenCalled();
  });

  it("stops refining when critique returns null", async () => {
    const persona = personaWithDomains();
    const lowQuality = makeCandidate({ compositeScore: 0.3 });

    mockedCritique.mockResolvedValueOnce(null);
    mockedVerify.mockResolvedValueOnce({
      status: "verified",
      sources: [],
      confidence: 0.8,
      notes: "ok",
    });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [lowQuality],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(mockedRefine).not.toHaveBeenCalled();
    expect(result!.id).toBe("test-id");
  });

  it("stops refining when refine returns null", async () => {
    const persona = personaWithDomains();
    const lowQuality = makeCandidate({ compositeScore: 0.3 });
    const critique: LlmCritiqueResult = {
      specificity: 0.5,
      personaRelevance: 0.4,
      actionability: 0.6,
      surprise: 0.3,
      voiceMatch: 0.5,
      overallScore: 0.4,
      critique: "needs improvement",
      improvementSuggestions: ["be more specific"],
    };

    mockedCritique.mockResolvedValueOnce(critique);
    mockedRefine.mockResolvedValueOnce(null);
    mockedVerify.mockResolvedValueOnce({
      status: "verified",
      sources: [],
      confidence: 0.8,
      notes: "ok",
    });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [lowQuality],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(mockedCritique).toHaveBeenCalledTimes(1);
    expect(mockedRefine).toHaveBeenCalledTimes(1);
    expect(result!.id).toBe("test-id");
  });

  it("respects max retries (2 refine attempts max)", async () => {
    const persona = personaWithDomains();
    const lowQuality = makeCandidate({ compositeScore: 0.2 });
    const critique: LlmCritiqueResult = {
      specificity: 0.3,
      personaRelevance: 0.3,
      actionability: 0.3,
      surprise: 0.3,
      voiceMatch: 0.3,
      overallScore: 0.3,
      critique: "still weak",
      improvementSuggestions: ["improve"],
    };
    const refined1 = makeCandidate({ compositeScore: 0.4, id: "refined-1" });
    const refined2 = makeCandidate({ compositeScore: 0.5, id: "refined-2" });

    mockedCritique
      .mockResolvedValueOnce(critique)
      .mockResolvedValueOnce(critique);
    mockedRefine
      .mockResolvedValueOnce(refined1)
      .mockResolvedValueOnce(refined2);
    mockedVerify.mockResolvedValueOnce({
      status: "verified",
      sources: [],
      confidence: 0.7,
      notes: "ok",
    });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [lowQuality],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(mockedCritique).toHaveBeenCalledTimes(2);
    expect(mockedRefine).toHaveBeenCalledTimes(2);
  });

  it("keeps best candidate when refined is worse", async () => {
    const persona = personaWithDomains();
    const lowQuality = makeCandidate({ compositeScore: 0.5 });
    const critique: LlmCritiqueResult = {
      specificity: 0.5,
      personaRelevance: 0.4,
      actionability: 0.6,
      surprise: 0.3,
      voiceMatch: 0.5,
      overallScore: 0.4,
      critique: "needs improvement",
      improvementSuggestions: ["be more specific"],
    };
    const worseRefined = makeCandidate({ compositeScore: 0.2, id: "worse" });

    mockedCritique.mockResolvedValueOnce(critique);
    mockedRefine.mockResolvedValueOnce(worseRefined);
    mockedVerify.mockResolvedValueOnce({
      status: "verified",
      sources: [],
      confidence: 0.7,
      notes: "ok",
    });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [lowQuality],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("test-id");
    expect(result!.compositeScore).toBe(0.5);
  });
});

describe("LLM-as-Judge verification (knowledge mode)", () => {
  it("passes candidate when judge returns verified", async () => {
    const persona = personaWithDomains();
    const candidate = makeCandidate({ compositeScore: 0.9 });

    mockedVerify.mockResolvedValueOnce({
      status: "verified",
      sources: [],
      confidence: 0.8,
      notes: "good",
    });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [candidate],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(result!.verificationStatus).toBe("verified");
  });

  it("returns null when judge returns unverified for non-exploration", async () => {
    const persona = personaWithDomains();
    const candidate = makeCandidate({ compositeScore: 0.9 });

    mockedVerify.mockResolvedValueOnce({
      status: "unverified",
      sources: [],
      confidence: 0.2,
      notes: "generic",
    });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [candidate],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).toBeNull();
  });

  it("passes candidate when judge returns partial", async () => {
    const persona = personaWithDomains();
    const candidate = makeCandidate({ compositeScore: 0.9 });

    mockedVerify.mockResolvedValueOnce({
      status: "partial",
      sources: [],
      confidence: 0.5,
      notes: "decent",
    });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [candidate],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(result!.verificationStatus).toBe("partial");
  });
});

describe("Pattern-mode LLM judge", () => {
  it("calls LLM judge when patternVerification=true", async () => {
    const persona = personaWithDomains();

    mockedVerify.mockResolvedValueOnce({
      status: "verified",
      sources: [],
      confidence: 0.8,
      notes: "good",
    });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [makeCandidate()],
      patternVerification: true,
    });

    const result = await scheduler.resolve(persona, patternOpp);

    expect(result).not.toBeNull();
    expect(mockedVerify).toHaveBeenCalledTimes(1);
  });

  it("stays partial when patternVerification=false", async () => {
    const persona = personaWithDomains();

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [makeCandidate()],
      patternVerification: false,
    });

    const result = await scheduler.resolve(persona, patternOpp);

    expect(result).not.toBeNull();
    expect(mockedVerify).not.toHaveBeenCalled();
    expect(result!.verificationStatus).toBe("partial");
  });

  it("upgrades partial to verified via LLM judge", async () => {
    const persona = personaWithDomains();

    mockedVerify.mockResolvedValueOnce({
      status: "verified",
      sources: [],
      confidence: 0.8,
      notes: "good behavioral observation",
    });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [makeCandidate()],
    });

    const result = await scheduler.resolve(persona, patternOpp);

    expect(result).not.toBeNull();
    expect(result!.verificationStatus).toBe("verified");
    expect(mockedVerify).toHaveBeenCalledTimes(1);
  });

  it("defaults patternVerification to true (calls judge)", async () => {
    const persona = personaWithDomains();

    mockedVerify.mockResolvedValueOnce({
      status: "partial",
      sources: [],
      confidence: 0.5,
      notes: "ok",
    });

    const config: SchedulerConfig = { minIntervalHours: 4, minTrustScore: 0.3 };
    const scheduler = new ProactiveScheduler(config, {
      loadPersona: async () => persona,
      onInsightReady: async () => {},
      savePersona: async () => {},
    }, {
      insightGenerator: async () => [makeCandidate()],
      llmDeps: fakeLlmDeps,
      botConfig: fakeBotConfig,
      fragmentStore: createStubFragmentStore(),
    });

    const result = await scheduler.resolve(persona, patternOpp);

    expect(result).not.toBeNull();
    expect(mockedVerify).toHaveBeenCalledTimes(1);
  });
});

describe("Constructor: new parameters accepted", () => {
  it("accepts llmDeps and botConfig in deps", () => {
    const deps = {
      llmDeps: fakeLlmDeps,
      botConfig: fakeBotConfig,
    };

    const scheduler = new ProactiveScheduler(baseConfig, {
      loadPersona: async () => undefined,
      onInsightReady: async () => {},
      savePersona: async () => {},
    }, deps);

    expect(scheduler).toBeDefined();
  });

  it("works without llmDeps (backward compatible)", () => {
    const scheduler = new ProactiveScheduler(baseConfig, {
      loadPersona: async () => undefined,
      onInsightReady: async () => {},
      savePersona: async () => {},
    });

    expect(scheduler).toBeDefined();
  });

  it("falls back to source-based verification when no LLM deps", async () => {
    const persona = personaWithDomains();
    const candidateWithSources = makeCandidate({
      compositeScore: 0.9,
      sources: [{ url: "https://example.com", title: "Test", credibility: 0.5 }],
    });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [candidateWithSources],
      llmDeps: undefined,
      botConfig: undefined,
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(result!.verificationStatus).toBe("verified");
    expect(mockedVerify).not.toHaveBeenCalled();
  });
});

describe("No-LLM fallback: backward compatibility", () => {
  it("exploration opp with unverified sources still passes (backward compat)", async () => {
    const persona = personaWithDomains();
    const candidateNoSources = makeCandidate({ compositeScore: 0.9, sources: [] });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [candidateNoSources],
      llmDeps: undefined,
      botConfig: undefined,
    });

    const result = await scheduler.resolve(persona, explorationOpp);

    expect(result).not.toBeNull();
    expect(result!.verificationStatus).toBe("unverified");
  });
});

describe("LLM freshness check: knowledge mode", () => {
  const recentContents = ["previous insight about AI", "another insight about Rust"];

  function personaWithRecentContents(): PersonaTree {
    const persona = personaWithDomains();
    persona.feedbackProfile.recentInsightContents = recentContents;
    return persona;
  }

  it("trigram blocks → LLM freshness NOT called", async () => {
    const persona = personaWithRecentContents();
    const duplicateContent = "previous insight about AI";

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [makeCandidate({ content: duplicateContent, compositeScore: 0.9 })],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).toBeNull();
    expect(mockedFreshness).not.toHaveBeenCalled();
  });

  it("trigram passes → LLM freshness not novel → returns null", async () => {
    const persona = personaWithRecentContents();
    mockedFreshness.mockResolvedValueOnce({ isNovel: false, reason: "too similar to recent" });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [makeCandidate({ compositeScore: 0.9 })],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).toBeNull();
    expect(mockedFreshness).toHaveBeenCalledTimes(1);
  });

  it("trigram passes → LLM freshness novel → returns candidate", async () => {
    const persona = personaWithRecentContents();
    mockedFreshness.mockResolvedValueOnce({ isNovel: true, reason: "distinct content" });
    mockedVerify.mockResolvedValueOnce({ status: "verified", sources: [], confidence: 0.8, notes: "ok" });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [makeCandidate({ compositeScore: 0.9 })],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(mockedFreshness).toHaveBeenCalledTimes(1);
  });

  it("trigram passes → LLM freshness throws → conservative pass (returns candidate)", async () => {
    const persona = personaWithRecentContents();
    mockedFreshness.mockResolvedValueOnce({ isNovel: true, reason: "LLM freshness check unavailable" });
    mockedVerify.mockResolvedValueOnce({ status: "verified", sources: [], confidence: 0.8, notes: "ok" });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [makeCandidate({ compositeScore: 0.9 })],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(mockedFreshness).toHaveBeenCalledTimes(1);
  });

  it("llmFreshnessCheck: false → skip LLM freshness entirely", async () => {
    const persona = personaWithRecentContents();
    const config: SchedulerConfig = { ...baseConfig, llmFreshnessCheck: false };
    mockedVerify.mockResolvedValueOnce({ status: "verified", sources: [], confidence: 0.8, notes: "ok" });

    const scheduler = makeScheduler(config, persona, {
      insightGenerator: async () => [makeCandidate({ compositeScore: 0.9 })],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(mockedFreshness).not.toHaveBeenCalled();
  });

  it("fewer than 2 recent insights → skip LLM freshness call", async () => {
    const persona = personaWithDomains();
    persona.feedbackProfile.recentInsightContents = ["only one"];
    mockedVerify.mockResolvedValueOnce({ status: "verified", sources: [], confidence: 0.8, notes: "ok" });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [makeCandidate({ compositeScore: 0.9 })],
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(mockedFreshness).not.toHaveBeenCalled();
  });

  it("no LLM deps → skip freshness check", async () => {
    const persona = personaWithRecentContents();

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [makeCandidate({ compositeScore: 0.9 })],
      llmDeps: undefined,
      botConfig: undefined,
    });

    const result = await scheduler.resolve(persona, crossDomainOpp);

    expect(result).not.toBeNull();
    expect(mockedFreshness).not.toHaveBeenCalled();
  });
});

describe("LLM freshness check: pattern mode", () => {
  const recentContents = ["behavioral observation A", "behavioral observation B"];

  function personaWithRecentPatternContents(): PersonaTree {
    const persona = personaWithDomains();
    persona.feedbackProfile.recentInsightContents = recentContents;
    return persona;
  }

  it("trigram blocks → LLM freshness NOT called", async () => {
    const persona = personaWithRecentPatternContents();
    const duplicateContent = "behavioral observation A";

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [makeCandidate({ content: duplicateContent })],
    });

    const result = await scheduler.resolve(persona, patternOpp);

    expect(result).toBeNull();
    expect(mockedFreshness).not.toHaveBeenCalled();
  });

  it("trigram passes → LLM freshness not novel → returns null", async () => {
    const persona = personaWithRecentPatternContents();
    mockedFreshness.mockResolvedValueOnce({ isNovel: false, reason: "semantically repetitive" });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [makeCandidate()],
    });

    const result = await scheduler.resolve(persona, patternOpp);

    expect(result).toBeNull();
    expect(mockedFreshness).toHaveBeenCalledTimes(1);
  });

  it("trigram passes → LLM freshness novel → returns candidate", async () => {
    const persona = personaWithRecentPatternContents();
    mockedFreshness.mockResolvedValueOnce({ isNovel: true, reason: "new pattern" });
    mockedVerify.mockResolvedValueOnce({ status: "partial", sources: [], confidence: 0.5, notes: "ok" });

    const scheduler = makeScheduler(baseConfig, persona, {
      insightGenerator: async () => [makeCandidate()],
    });

    const result = await scheduler.resolve(persona, patternOpp);

    expect(result).not.toBeNull();
    expect(mockedFreshness).toHaveBeenCalledTimes(1);
  });

  it("llmFreshnessCheck: false → skip freshness in pattern mode", async () => {
    const persona = personaWithRecentPatternContents();
    const config: SchedulerConfig = { ...baseConfig, llmFreshnessCheck: false };
    mockedVerify.mockResolvedValueOnce({ status: "partial", sources: [], confidence: 0.5, notes: "ok" });

    const scheduler = makeScheduler(config, persona, {
      insightGenerator: async () => [makeCandidate()],
    });

    const result = await scheduler.resolve(persona, patternOpp);

    expect(result).not.toBeNull();
    expect(mockedFreshness).not.toHaveBeenCalled();
  });
});
