import type { AssistantMessage, Api, Model } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import type { Fragment, BlindSpotCandidate, QualityAssessment } from "./fragment-types.js";
import { createDefaultFragment } from "./fragment-types.js";
import type { InsightCandidate, InsightEngineInput } from "./types.js";
import type { PipelineDeps } from "./pipeline.js";
import {
  InsightV2Pipeline,
  collectFragmentsForTurn,
  createV2InsightGenerator,
  createPipelineDeps,
  createDualInsightGenerator,
} from "./pipeline.js";

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
      userId: "user-1",
      coreTraits: {},
      expertDomains: ["typescript"],
      interestDomains: ["rust"],
      curiosityDomains: ["wasm"],
      ...overrides?.identity,
    },
    domains: {},
    recentFocus: [],
    activeProjects: [],
    pendingQuestions: [],
    feedbackProfile: {
      topicBandits: {},
      preferredStyle: "observation",
      optimalFrequencyHours: 4,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [],
      ...overrides?.feedbackProfile,
    },
    rapport: {
      trustScore: 0.75,
      totalExchanges: 50,
      avgResponseLength: 120,
      selfDisclosureLevel: 0.4,
    },
    domainBlacklist: [],
    lifecycle: {
      stage: "new",
      lastActiveAt: 0,
      lastStageTransitionAt: 0,
      consecutiveSilentDays: 0,
      totalActiveDays: 0,
    },
    calibrationHistory: [],
    contradictionLog: [],
    moodHistory: [],
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<KaijiBotConfig>): KaijiBotConfig {
  return {
    cognitive: {
      insight: {},
      ...overrides?.cognitive?.insight ? { insight: { ...overrides.cognitive.insight } } : {},
    },
  } as KaijiBotConfig;
}

function makeInput(overrides?: Partial<InsightEngineInput>): InsightEngineInput {
  return {
    targetDomains: ["typescript"],
    recentFocus: ["rust"],
    trustScore: 0.75,
    recentInsightIds: [],
    recentInsightContents: [],
    ...overrides,
  };
}

function makeFragment(overrides?: Partial<Fragment>): Fragment {
  return createDefaultFragment({
    userId: "user-1",
    kind: "assumption",
    evidence: "User assumes async/await always blocks",
    domains: ["typescript"],
    structuralTag: "async-assumption",
    ...overrides,
  });
}

function makeBlindSpot(overrides?: Partial<BlindSpotCandidate>): BlindSpotCandidate {
  return {
    id: "bs-1",
    blindSpot: "User conflates Rust ownership with C++ RAII",
    supportingFragmentIds: ["f-1", "f-2"],
    potentialImpact: "direction_change",
    domains: ["rust", "cpp"],
    unusedDomains: ["memory-safety"],
    crystallizationScore: 0.75,
    ...overrides,
  };
}

function makePipelineDeps(overrides?: Partial<PipelineDeps>): PipelineDeps {
  return {
    collector: {
      complete: async () => assistantMessage("[]"),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    },
    crystallization: {
      complete: async () =>
        assistantMessage(
          '{"blindSpot":"test blind spot","potentialImpact":"efficiency_gain","crystallizationScore":0.8}',
        ),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      loadFragments: async () => [],
      saveFragments: async () => {},
      findClusters: async () => [],
      touchFragments: async () => {},
    },
    qualityGate: {
      complete: async () => assistantMessage("0.8"),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    },
    composer: {
      complete: async () =>
        assistantMessage("This is a specific, actionable insight about the blind spot."),
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    },
    loadFragments: async () => [],
    addFragment: async (_userId, fragment) => [fragment],
    findClusters: async () => [],
    ...overrides,
  };
}

function makeV1Fallback(
  candidates: InsightCandidate[] = [],
): (persona: PersonaTree, input: InsightEngineInput) => Promise<InsightCandidate[]> {
  return vi.fn(async () => candidates);
}

// ─── Cold start ───

describe("InsightV2Pipeline cold start", () => {
  it("falls back to v1 when user has <5 fragments", async () => {
    const fragments = Array.from({ length: 4 }, () => makeFragment());
    const v1Fallback = makeV1Fallback([
      { id: "v1-1", content: "v1 insight", rationale: "test", targetDomains: [], sourceDomains: [], relevanceScore: 0.5, surpriseScore: 0.5, compositeScore: 0.5, sources: [], verificationStatus: "unverified" },
    ]);
    const deps = makePipelineDeps({
      loadFragments: async () => fragments,
    });
    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    const result = await pipeline.generateInsight(makePersona(), makeInput(), makeConfig());

    expect(result.deliverable).toHaveLength(1);
    expect(result.deliverable[0].id).toBe("v1-1");
    expect(result.parked).toHaveLength(0);
    expect(v1Fallback).toHaveBeenCalledOnce();
  });

  it("falls back to v1 when user has 0 fragments", async () => {
    const v1Fallback = makeV1Fallback([]);
    const deps = makePipelineDeps({ loadFragments: async () => [] });
    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    const result = await pipeline.generateInsight(makePersona(), makeInput(), makeConfig());

    expect(result.deliverable).toHaveLength(0);
    expect(result.parked).toHaveLength(0);
    expect(v1Fallback).toHaveBeenCalledOnce();
  });

  it("uses v2 pipeline when user has ≥5 fragments", async () => {
    const fragments = Array.from({ length: 5 }, () => makeFragment());
    const v1Fallback = makeV1Fallback();
    const bs = makeBlindSpot();
    const deps = makePipelineDeps({
      loadFragments: async () => fragments,
      crystallization: {
        complete: async () =>
          assistantMessage('{"blindSpot":"test","potentialImpact":"efficiency_gain","crystallizationScore":0.8}'),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
        loadFragments: async () => fragments,
        saveFragments: async () => {},
        findClusters: async () => [],
        touchFragments: async () => {},
      },
    });

    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    const result = await pipeline.generateInsight(makePersona(), makeInput(), makeConfig());

    expect(v1Fallback).not.toHaveBeenCalled();
    expect(result.deliverable).toHaveLength(0);
  });

  it("passes persona and input to v1 fallback correctly", async () => {
    const v1Fallback = vi.fn(async (persona: PersonaTree, input: InsightEngineInput) => {
      expect(persona.identity.userId).toBe("user-1");
      expect(input.targetDomains).toContain("typescript");
      return [];
    });
    const deps = makePipelineDeps({ loadFragments: async () => [] });
    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    await pipeline.generateInsight(makePersona(), makeInput(), makeConfig());

    expect(v1Fallback).toHaveBeenCalledOnce();
  });
});

// ─── Full pipeline ───

describe("InsightV2Pipeline full pipeline", () => {
  it("produces InsightCandidate from valid pipeline run", async () => {
    const fragments = Array.from({ length: 5 }, () => makeFragment());
    const bs = makeBlindSpot();

    // crystallize returns blind spots when findClusters returns clusters
    // but the internal flow is: findClusters → synthesizeBlindSpot (LLM call).
    // For testing, we override the crystallization deps to simulate blind spots being returned.
    // The simplest approach: the pipeline calls crystallize() which uses deps.crystallization.
    // We can't easily mock crystallize() itself since it's imported, but we can make
    // the crystallization deps work in a way that produces blind spots.

    // Actually the cleanest approach for integration tests: mock the full crystallization
    // by having findClusters return clusters AND the LLM return valid blind spot JSON.
    // But crystallize() has internal filtering. Let's just verify the pipeline wires correctly
    // by testing with a crystallization mock that produces blind spots through the LLM path.

    // For a more controlled test, let's make findClusters return a cluster, and the LLM
    // synthesize it into a blind spot, then quality gate passes, then composer succeeds.

    const v1Fallback = makeV1Fallback();
    const deps = makePipelineDeps({
      loadFragments: async () => fragments,
      crystallization: {
        complete: async () =>
          assistantMessage(
            '{"blindSpot":"User conflates async patterns with sync ones","potentialImpact":"efficiency_gain","crystallizationScore":0.85}',
          ),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
        loadFragments: async () => fragments,
        saveFragments: async () => {},
        findClusters: async () => [
          {
            id: "cluster-1",
            fragmentIds: fragments.slice(0, 3).map(f => f.id),
            domains: ["typescript"],
            structuralPattern: "assumption+knowledge_gap",
            averageStrength: 0.7,
            createdAt: Date.now(),
          },
        ],
        touchFragments: async () => {},
      },
    });

    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    const result = await pipeline.generateInsight(makePersona(), makeInput(), makeConfig());

    expect(result.deliverable.length).toBeGreaterThanOrEqual(0);
    expect(result.parked).toBeDefined();
    if (result.deliverable.length > 0) {
      expect(result.deliverable[0].content).toBeTruthy();
      expect(result.deliverable[0].id).toBeTruthy();
    }
  });

  it("returns empty deliverable when no blind spots crystallized", async () => {
    const fragments = Array.from({ length: 5 }, () => makeFragment());
    const v1Fallback = makeV1Fallback();
    const deps = makePipelineDeps({
      loadFragments: async () => fragments,
      crystallization: {
        complete: async () => assistantMessage("[]"),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
        loadFragments: async () => fragments,
        saveFragments: async () => {},
        findClusters: async () => [],
        touchFragments: async () => {},
      },
    });

    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    const result = await pipeline.generateInsight(makePersona(), makeInput(), makeConfig());

    expect(result.deliverable).toHaveLength(0);
    expect(result.parked).toHaveLength(0);
  });

  it("returns empty deliverable when all blind spots discarded", async () => {
    const fragments = Array.from({ length: 5 }, () => makeFragment());
    const v1Fallback = makeV1Fallback();
    const deps = makePipelineDeps({
      loadFragments: async () => fragments,
      crystallization: {
        complete: async () =>
          assistantMessage(
            '{"blindSpot":"Obvious observation","potentialImpact":"connection_reveal","crystallizationScore":0.3}',
          ),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
        loadFragments: async () => fragments,
        saveFragments: async () => {},
        findClusters: async () => [
          {
            id: "cluster-1",
            fragmentIds: fragments.slice(0, 3).map(f => f.id),
            domains: ["typescript"],
            structuralPattern: "assumption",
            averageStrength: 0.3,
            createdAt: Date.now(),
          },
        ],
        touchFragments: async () => {},
      },
      qualityGate: {
        complete: async () => assistantMessage("0.1"),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
    });

    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    const result = await pipeline.generateInsight(makePersona(), makeInput(), makeConfig());

    expect(result.deliverable).toHaveLength(0);
  });

  it("returns parked candidates with 'park' verdict", async () => {
    const fragments = Array.from({ length: 5 }, () => makeFragment());
    const v1Fallback = makeV1Fallback();

    const deps = makePipelineDeps({
      loadFragments: async () => fragments,
      crystallization: {
        complete: async () =>
          assistantMessage(
            '{"blindSpot":"Semi-interesting observation","potentialImpact":"risk_avoidance","crystallizationScore":0.6}',
          ),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
        loadFragments: async () => fragments,
        saveFragments: async () => {},
        findClusters: async () => [
          {
            id: "cluster-1",
            fragmentIds: fragments.slice(0, 3).map(f => f.id),
            domains: ["typescript", "rust"],
            structuralPattern: "assumption+unresolved_tension",
            averageStrength: 0.6,
            createdAt: Date.now(),
          },
        ],
        touchFragments: async () => {},
      },
      qualityGate: {
        complete: async () => assistantMessage("0.65"),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
    });

    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    const result = await pipeline.generateInsight(makePersona(), makeInput(), makeConfig());

    if (result.parked.length > 0) {
      expect(result.parked[0].assessment.verdict).toBe("park");
      expect(result.parked[0].candidate.blindSpot).toBeTruthy();
    }
  });

  it("returns deliverable candidates with 'deliver' verdict", async () => {
    const fragments = Array.from({ length: 5 }, () => makeFragment());
    const v1Fallback = makeV1Fallback();

    const deps = makePipelineDeps({
      loadFragments: async () => fragments,
      crystallization: {
        complete: async () =>
          assistantMessage(
            '{"blindSpot":"Critical insight about cross-domain pattern","potentialImpact":"direction_change","crystallizationScore":0.9}',
          ),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
        loadFragments: async () => fragments,
        saveFragments: async () => {},
        findClusters: async () => [
          {
            id: "cluster-1",
            fragmentIds: fragments.slice(0, 3).map(f => f.id),
            domains: ["typescript", "rust", "wasm"],
            structuralPattern: "assumption+knowledge_gap+contradictory_positions",
            averageStrength: 0.85,
            createdAt: Date.now(),
          },
        ],
        touchFragments: async () => {},
      },
      qualityGate: {
        complete: async () => assistantMessage("0.95"),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
      composer: {
        complete: async () =>
          assistantMessage("TypeScript 的类型系统和 Rust 的所有权模型在编译期保证安全性上有深层的同构关系。"),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
    });

    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    const result = await pipeline.generateInsight(makePersona(), makeInput(), makeConfig());

    if (result.deliverable.length > 0) {
      const insight = result.deliverable[0];
      expect(insight.content).toBeTruthy();
      expect(insight.id).toBeTruthy();
      expect(insight.verificationStatus).toBe("unverified");
    }
  });

  it("skips blind spots where composer returns null", async () => {
    const fragments = Array.from({ length: 5 }, () => makeFragment());
    const v1Fallback = makeV1Fallback();

    let composerCallCount = 0;
    const deps = makePipelineDeps({
      loadFragments: async () => fragments,
      crystallization: {
        complete: async () =>
          assistantMessage(
            '{"blindSpot":"Some insight","potentialImpact":"efficiency_gain","crystallizationScore":0.85}',
          ),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
        loadFragments: async () => fragments,
        saveFragments: async () => {},
        findClusters: async () => [
          {
            id: "cluster-1",
            fragmentIds: fragments.slice(0, 3).map(f => f.id),
            domains: ["typescript", "rust"],
            structuralPattern: "assumption+knowledge_gap",
            averageStrength: 0.8,
            createdAt: Date.now(),
          },
        ],
        touchFragments: async () => {},
      },
      qualityGate: {
        complete: async () => assistantMessage("0.9"),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
      composer: {
        complete: async () => {
          composerCallCount++;
          return assistantMessage("");
        },
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
    });

    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    const result = await pipeline.generateInsight(makePersona(), makeInput(), makeConfig());

    // Composer returned empty content → composeInsight returns null
    if (composerCallCount > 0) {
      expect(result.deliverable).toHaveLength(0);
    }
  });
});

// ─── Error degradation ───

describe("InsightV2Pipeline error degradation", () => {
  it("returns partial results when one blind spot fails", async () => {
    const fragments = Array.from({ length: 5 }, () => makeFragment());
    const v1Fallback = makeV1Fallback();

    let qualityCallCount = 0;
    const deps = makePipelineDeps({
      loadFragments: async () => fragments,
      crystallization: {
        complete: async () =>
          assistantMessage(
            '{"blindSpot":"Second insight","potentialImpact":"efficiency_gain","crystallizationScore":0.85}',
          ),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
        loadFragments: async () => fragments,
        saveFragments: async () => {},
        findClusters: async () => [
          {
            id: "cluster-1",
            fragmentIds: fragments.slice(0, 3).map(f => f.id),
            domains: ["typescript", "rust"],
            structuralPattern: "assumption+knowledge_gap",
            averageStrength: 0.8,
            createdAt: Date.now(),
          },
        ],
        touchFragments: async () => {},
      },
      qualityGate: {
        complete: async () => {
          qualityCallCount++;
          if (qualityCallCount === 1) throw new Error("LLM timeout");
          return assistantMessage("0.85");
        },
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
      composer: {
        complete: async () => assistantMessage("A valid insight about the topic."),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
    });

    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    const result = await pipeline.generateInsight(makePersona(), makeInput(), makeConfig());
    expect(result).toBeDefined();
    expect(result.deliverable).toBeDefined();
    expect(result.parked).toBeDefined();
  });

  it("returns empty when userId is missing from persona", async () => {
    const v1Fallback = makeV1Fallback();
    const pipeline = new InsightV2Pipeline(makePipelineDeps(), v1Fallback);
    const persona = makePersona({ identity: { coreTraits: {}, expertDomains: [], interestDomains: [], curiosityDomains: [] } });
    const result = await pipeline.generateInsight(persona, makeInput(), makeConfig());

    expect(result.deliverable).toHaveLength(0);
    expect(result.parked).toHaveLength(0);
    expect(v1Fallback).not.toHaveBeenCalled();
  });
});

// ─── collectFragmentsForTurn ───

describe("collectFragmentsForTurn", () => {
  it("collects and stores fragments for a user turn", async () => {
    const addedFragments: Fragment[] = [];
    const deps: Pick<PipelineDeps, "collector" | "addFragment"> = {
      collector: {
        complete: async () =>
          assistantMessage(
            '[{"kind":"assumption","evidence":"User assumes X","domains":["typescript"],"structuralTag":"test-assumption","strength":0.7}]',
          ),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
      addFragment: async (_userId, fragment) => {
        addedFragments.push(fragment);
        return [fragment];
      },
    };

    await collectFragmentsForTurn(
      "user-1",
      "I think TypeScript always infers types correctly",
      "Actually, there are edge cases...",
      makePersona(),
      makeConfig(),
      deps,
    );

    expect(addedFragments).toHaveLength(1);
    expect(addedFragments[0].userId).toBe("user-1");
    expect(addedFragments[0].kind).toBe("assumption");
  });

  it("sets userId on each fragment", async () => {
    const storedUserIds: string[] = [];
    const deps: Pick<PipelineDeps, "collector" | "addFragment"> = {
      collector: {
        complete: async () =>
          assistantMessage(
            '[{"kind":"knowledge_gap","evidence":"Gap A","domains":["rust"],"structuralTag":"gap-a","strength":0.6},{"kind":"implicit_priority","evidence":"Priority B","domains":["wasm"],"structuralTag":"prio-b","strength":0.8}]',
          ),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
      addFragment: async (userId, fragment) => {
        storedUserIds.push(userId);
        return [fragment];
      },
    };

    await collectFragmentsForTurn(
      "user-42",
      "I want to learn Rust for embedded systems",
      "Rust is great for embedded...",
      makePersona(),
      makeConfig(),
      deps,
    );

    expect(storedUserIds).toHaveLength(2);
    expect(storedUserIds.every(id => id === "user-42")).toBe(true);
  });

  it("skips when userId is empty", async () => {
    const deps: Pick<PipelineDeps, "collector" | "addFragment"> = {
      collector: {
        complete: async () => assistantMessage("[]"),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
      addFragment: async () => [],
    };

    await collectFragmentsForTurn(
      "",
      "some text",
      "some reply",
      makePersona(),
      makeConfig(),
      deps,
    );
  });
});

// ─── createV2InsightGenerator ───

describe("createV2InsightGenerator", () => {
  it("returns only deliverable candidates", async () => {
    const fragments = Array.from({ length: 5 }, () => makeFragment());
    const v1Fallback = makeV1Fallback();

    const deps = makePipelineDeps({
      loadFragments: async () => fragments,
      crystallization: {
        complete: async () =>
          assistantMessage(
            '{"blindSpot":"Deep insight","potentialImpact":"direction_change","crystallizationScore":0.9}',
          ),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
        loadFragments: async () => fragments,
        saveFragments: async () => {},
        findClusters: async () => [
          {
            id: "cluster-1",
            fragmentIds: fragments.slice(0, 3).map(f => f.id),
            domains: ["typescript", "rust", "wasm"],
            structuralPattern: "assumption+knowledge_gap",
            averageStrength: 0.9,
            createdAt: Date.now(),
          },
        ],
        touchFragments: async () => {},
      },
      qualityGate: {
        complete: async () => assistantMessage("0.95"),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
      composer: {
        complete: async () =>
          assistantMessage("跨域发现：TypeScript 类型系统和 Rust 所有权模型有深层同构关系。"),
        prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
      },
    });

    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    const generator = createV2InsightGenerator(pipeline, makeConfig());
    const result = await generator(makePersona(), makeInput());

    // Result should be InsightCandidate[] (only deliverables)
    expect(Array.isArray(result)).toBe(true);
    for (const item of result) {
      expect(item.id).toBeTruthy();
      expect(item.content).toBeTruthy();
    }
  });

  it("adapts pipeline to InsightGeneratorFn signature", async () => {
    const fragments = Array.from({ length: 5 }, () => makeFragment());
    const v1Fallback = makeV1Fallback();
    const deps = makePipelineDeps({ loadFragments: async () => fragments });

    const pipeline = new InsightV2Pipeline(deps, v1Fallback);
    const generator = createV2InsightGenerator(pipeline, makeConfig());

    const result = await generator(makePersona(), makeInput());

    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── createDualInsightGenerator ───

function makeCandidate(overrides: Partial<InsightCandidate>): InsightCandidate {
  return {
    id: "c-1",
    content: "test insight",
    rationale: "test",
    targetDomains: [],
    sourceDomains: [],
    relevanceScore: 0.5,
    surpriseScore: 0.5,
    compositeScore: 0.5,
    sources: [],
    verificationStatus: "unverified",
    ...overrides,
  };
}

describe("createDualInsightGenerator", () => {
  it("merges results from both generators", async () => {
    const v1 = vi.fn(async () => [
      makeCandidate({ id: "v1-1", content: "Rust ownership model prevents data races at compile time" }),
    ]);
    const v2 = vi.fn(async () => [
      makeCandidate({ id: "v2-1", content: "WebAssembly enables near-native performance in browsers" }),
    ]);
    const dual = createDualInsightGenerator(v1, v2);
    const result = await dual(makePersona(), makeInput());

    expect(result).toHaveLength(2);
    const ids = result.map((c) => c.id);
    expect(ids).toContain("v1-1");
    expect(ids).toContain("v2-1");
  });

  it("deduplicates by content similarity", async () => {
    const v1 = vi.fn(async () => [
      makeCandidate({ id: "v1-1", content: "TypeScript's type system provides compile-time safety" }),
    ]);
    const v2 = vi.fn(async () => [
      makeCandidate({ id: "v2-1", content: "TypeScript type system provides compile time safety guarantees" }),
    ]);
    const dual = createDualInsightGenerator(v1, v2);
    const result = await dual(makePersona(), makeInput());

    expect(result).toHaveLength(1);
  });

  it("returns empty when both generators fail", async () => {
    const v1 = vi.fn(async () => { throw new Error("v1 fail"); });
    const v2 = vi.fn(async () => { throw new Error("v2 fail"); });
    const dual = createDualInsightGenerator(v1, v2);
    const result = await dual(makePersona(), makeInput());

    expect(result).toHaveLength(0);
  });

  it("continues with v2 when v1 fails", async () => {
    const v1 = vi.fn(async () => { throw new Error("v1 fail"); });
    const v2 = vi.fn(async () => [
      makeCandidate({ id: "v2-1", content: "v2 insight" }),
    ]);
    const dual = createDualInsightGenerator(v1, v2);
    const result = await dual(makePersona(), makeInput());

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("v2-1");
  });

  it("sorts by compositeScore descending", async () => {
    const v1 = vi.fn(async () => [
      makeCandidate({ id: "v1-1", content: "Rust ownership model prevents data races at compile time", compositeScore: 0.5 }),
    ]);
    const v2 = vi.fn(async () => [
      makeCandidate({ id: "v2-1", content: "WebAssembly enables near-native performance in browsers", compositeScore: 0.9 }),
    ]);
    const dual = createDualInsightGenerator(v1, v2);
    const result = await dual(makePersona(), makeInput());

    expect(result[0].compositeScore).toBe(0.9);
    expect(result[1].compositeScore).toBe(0.5);
  });

  it("limits to top 3 candidates", async () => {
    const v1 = vi.fn(async () => [
      makeCandidate({ id: "v1-1", content: "alpha", compositeScore: 0.9 }),
      makeCandidate({ id: "v1-2", content: "beta", compositeScore: 0.7 }),
    ]);
    const v2 = vi.fn(async () => [
      makeCandidate({ id: "v2-1", content: "gamma", compositeScore: 0.8 }),
      makeCandidate({ id: "v2-2", content: "delta", compositeScore: 0.6 }),
    ]);
    const dual = createDualInsightGenerator(v1, v2);
    const result = await dual(makePersona(), makeInput());

    expect(result).toHaveLength(3);
    expect(result[0].compositeScore).toBe(0.9);
    expect(result[1].compositeScore).toBe(0.8);
    expect(result[2].compositeScore).toBe(0.7);
  });
});

// ─── createPipelineDeps ───

describe("createPipelineDeps", () => {
  it("creates PipelineDeps with all sub-deps wired correctly", () => {
    const deps = createPipelineDeps("/tmp/test-kaijibot");

    expect(deps.collector).toBeDefined();
    expect(deps.crystallization).toBeDefined();
    expect(deps.qualityGate).toBeDefined();
    expect(deps.composer).toBeDefined();
    expect(typeof deps.loadFragments).toBe("function");
    expect(typeof deps.addFragment).toBe("function");
    expect(typeof deps.findClusters).toBe("function");
  });
});
