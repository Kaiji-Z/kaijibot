import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CrystallizationDeps } from "./crystallization.js";
import type { Fragment, FragmentCluster, BlindSpotCandidate } from "./fragment-types.js";
import type { PersonaTree } from "../types.js";

// ─── Logger mock (hoisted by vitest) ───

const debugMessages: unknown[][] = [];
const warnMessages: unknown[][] = [];
vi.mock("../../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    info: vi.fn(),
    warn: (...args: unknown[]) => { warnMessages.push(args); },
    error: vi.fn(),
    debug: (...args: unknown[]) => { debugMessages.push(args); },
  }),
}));

// Import AFTER vi.mock so the mock is active
import { crystallize, parseBlindSpot } from "./crystallization.js";

// ─── Helpers ───

function makeFragment(overrides?: Partial<Fragment>): Fragment {
  return {
    id: overrides?.id ?? "frag-1",
    userId: "user-1",
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
    kind: "assumption",
    evidence: "some evidence text",
    domains: ["domain-a"],
    structuralTag: "test-tag",
    strength: 0.6,
    ...overrides,
  };
}

function makeCluster(overrides?: Partial<FragmentCluster>): FragmentCluster {
  return {
    id: overrides?.id ?? "cluster-1",
    fragmentIds: overrides?.fragmentIds ?? ["frag-1", "frag-2", "frag-3"],
    domains: overrides?.domains ?? ["domain-a", "domain-b"],
    structuralPattern: "assumption+knowledge_gap",
    averageStrength: 0.6,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makePersona(overrides?: Partial<PersonaTree>): PersonaTree {
  return {
    identity: {
      coreTraits: {},
      expertDomains: ["expert-x", "expert-y"],
      interestDomains: [],
      curiosityDomains: [],
    },
    domains: {
      "domain-a": {
        depth: 3,
        recurrence: 5,
        lastMentioned: Date.now(),
        keyInsights: [],
        activeQuestions: [],
        connections: [],
        negationSignals: 0,
      },
    },
    recentFocus: [],
    activeProjects: [],
    feedbackProfile: {
      topicBandits: {},
      preferredStyle: "question",
      optimalFrequencyHours: 24,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [],
    },
    rapport: {
      trustScore: 0.5,
      totalExchanges: 10,
      avgResponseLength: 100,
      selfDisclosureLevel: 0.3,
    },
    moodHistory: [],
    domainBlacklist: [],
    lifecycle: {
      stage: "active",
      lastActiveAt: Date.now(),
      lastStageTransitionAt: Date.now(),
      consecutiveSilentDays: 0,
      totalActiveDays: 10,
    },
    calibrationHistory: [],
    contradictionLog: [],
    ...overrides,
  };
}

const defaultConfig = {
  cognitive: {
    persona: {
      extractionModel: "zai/glm-5-turbo",
    },
  },
} as unknown as import("../../config/config.js").KaijiBotConfig;

function makeMockDeps(
  fragments: Fragment[],
  clusters: FragmentCluster[],
  llmResponse: string,
): CrystallizationDeps {
  const touchedIds: string[] = [];

  return {
    complete: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: llmResponse }],
    }),
    prepareModel: vi.fn().mockResolvedValue({
      model: { provider: "zai", id: "glm-5-turbo" },
      auth: { apiKey: "test-key", mode: "env" },
    }),
    loadFragments: vi.fn().mockResolvedValue(fragments),
    saveFragments: vi.fn().mockResolvedValue(undefined),
    findClusters: vi.fn().mockResolvedValue(clusters),
    touchFragments: vi.fn().mockImplementation(async (_userId: string, ids: string[]) => {
      touchedIds.push(...ids);
    }),
  };
}

function makeValidLlmResponse(
  overrides?: Partial<{ blindSpot: string; potentialImpact: string; crystallizationScore: number }>,
): string {
  return JSON.stringify({
    blindSpot: "You consistently assume distributed systems require eventual consistency without evaluating strong consistency alternatives",
    potentialImpact: "connection_reveal",
    crystallizationScore: 0.8,
    ...overrides,
  });
}

// ─── Tests ───

describe("crystallize", () => {
  describe("signal-driven mode", () => {
    it("returns BlindSpotCandidate from valid cluster + LLM response", async () => {
      const fragments = [
        makeFragment({ id: "f1", domains: ["domain-a"] }),
        makeFragment({ id: "f2", domains: ["domain-b"] }),
        makeFragment({ id: "f3", domains: ["domain-a", "domain-b"] }),
      ];
      const cluster = makeCluster({ fragmentIds: ["f1", "f2", "f3"] });
      const deps = makeMockDeps(fragments, [cluster], makeValidLlmResponse());

      const result = await crystallize("user-1", makePersona(), defaultConfig, deps);

      expect(result).toHaveLength(1);
      expect(result[0].blindSpot).toBeTypeOf("string");
      expect(result[0].blindSpot.length).toBeGreaterThan(0);
      expect(result[0].supportingFragmentIds).toEqual(["f1", "f2", "f3"]);
      expect(result[0].crystallizationScore).toBe(0.8);
    });

    it("returns empty for no clusters", async () => {
      const deps = makeMockDeps([], [], "");
      const result = await crystallize("user-1", makePersona(), defaultConfig, deps);
      expect(result).toEqual([]);
    });

    it("returns empty when all clusters filtered as existing blind spots", async () => {
      const cluster = makeCluster({ domains: ["domain-a", "domain-b"] });
      const existingBS: BlindSpotCandidate = {
        id: "bs-1",
        blindSpot: "existing blind spot",
        supportingFragmentIds: [],
        potentialImpact: "connection_reveal",
        domains: ["domain-a", "domain-b"],
        unusedDomains: [],
        crystallizationScore: 0.7,
      };
      const persona = makePersona({ activeBlindSpots: [existingBS] });
      const deps = makeMockDeps([], [cluster], makeValidLlmResponse());

      const result = await crystallize("user-1", persona, defaultConfig, deps);

      expect(result).toEqual([]);
    });

    it("logs debug when no clusters found", async () => {
      debugMessages.length = 0;
      const deps = makeMockDeps([], [], "");

      await crystallize("user-1", makePersona(), defaultConfig, deps);

      expect(debugMessages.some((args) => String(args[0]).includes("no clusters found"))).toBe(true);
    });

    it("logs warn when all clusters filtered by domain overlap", async () => {
      debugMessages.length = 0;
      const cluster = makeCluster({ domains: ["domain-a", "domain-b"] });
      const existingBS: BlindSpotCandidate = {
        id: "bs-1",
        blindSpot: "existing blind spot",
        supportingFragmentIds: [],
        potentialImpact: "connection_reveal",
        domains: ["domain-a", "domain-b"],
        unusedDomains: [],
        crystallizationScore: 0.7,
      };
      const persona = makePersona({ activeBlindSpots: [existingBS] });
      const deps = makeMockDeps([], [cluster], makeValidLlmResponse());

      await crystallize("user-1", persona, defaultConfig, deps);

      expect(warnMessages.some((args) => String(args[0]).includes("all clusters filtered"))).toBe(true);
    });

    it("processes max 3 clusters per run", async () => {
      const fragments = Array.from({ length: 15 }, (_, i) =>
        makeFragment({ id: `f${i}`, domains: [`domain-${i % 5}`] }),
      );
      const clusters = Array.from({ length: 5 }, (_, i) =>
        makeCluster({
          id: `c${i}`,
          fragmentIds: [`f${i * 3}`, `f${i * 3 + 1}`, `f${i * 3 + 2}`],
          domains: [`domain-${i}`, `domain-${(i + 1) % 5}`],
        }),
      );
      const deps = makeMockDeps(fragments, clusters, makeValidLlmResponse());

      const result = await crystallize("user-1", makePersona(), defaultConfig, deps, "deep_scan");

      expect(result.length).toBeLessThanOrEqual(3);
      expect(deps.complete).toHaveBeenCalledTimes(3);
    });
  });

  describe("deep-scan mode", () => {
    it("processes ALL clusters in deep_scan mode", async () => {
      const fragments = Array.from({ length: 9 }, (_, i) =>
        makeFragment({ id: `f${i}`, domains: [`domain-${i}`] }),
      );
      const clusters = Array.from({ length: 2 }, (_, i) =>
        makeCluster({
          id: `c${i}`,
          fragmentIds: [`f${i * 3}`, `f${i * 3 + 1}`, `f${i * 3 + 2}`],
          domains: [`domain-${i}`, `domain-${i + 3}`],
        }),
      );
      const existingBS: BlindSpotCandidate = {
        id: "bs-1",
        blindSpot: "existing",
        supportingFragmentIds: [],
        potentialImpact: "connection_reveal",
        domains: ["domain-0"],
        unusedDomains: [],
        crystallizationScore: 0.5,
      };
      const persona = makePersona({ activeBlindSpots: [existingBS] });
      const deps = makeMockDeps(fragments, clusters, makeValidLlmResponse());

      const result = await crystallize("user-1", persona, defaultConfig, deps, "deep_scan");

      expect(deps.complete).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it("processes only newly-ripe clusters in signal mode", async () => {
      const fragments = Array.from({ length: 6 }, (_, i) =>
        makeFragment({ id: `f${i}`, domains: [`domain-${i}`] }),
      );
      const overlappingCluster = makeCluster({
        id: "c-overlap",
        fragmentIds: ["f0", "f1", "f2"],
        domains: ["domain-0", "domain-1"],
      });
      const freshCluster = makeCluster({
        id: "c-fresh",
        fragmentIds: ["f3", "f4", "f5"],
        domains: ["domain-3", "domain-4"],
      });
      const existingBS: BlindSpotCandidate = {
        id: "bs-1",
        blindSpot: "existing",
        supportingFragmentIds: [],
        potentialImpact: "connection_reveal",
        domains: ["domain-0", "domain-1"],
        unusedDomains: [],
        crystallizationScore: 0.5,
      };
      const persona = makePersona({ activeBlindSpots: [existingBS] });
      const deps = makeMockDeps(fragments, [overlappingCluster, freshCluster], makeValidLlmResponse());

      const result = await crystallize("user-1", persona, defaultConfig, deps, "signal");

      expect(deps.complete).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });
  });

  describe("fragment handling", () => {
    it("skips clusters with <2 fragments after loading", async () => {
      const fragments = [makeFragment({ id: "f1" })];
      const cluster = makeCluster({ fragmentIds: ["f1", "f-missing"] });
      const deps = makeMockDeps(fragments, [cluster], makeValidLlmResponse());

      const result = await crystallize("user-1", makePersona(), defaultConfig, deps);

      expect(result).toEqual([]);
      expect(deps.complete).not.toHaveBeenCalled();
    });

    it("boosts fragment strength after successful crystallization (touchFragments called)", async () => {
      const fragments = [
        makeFragment({ id: "f1" }),
        makeFragment({ id: "f2" }),
        makeFragment({ id: "f3" }),
      ];
      const cluster = makeCluster({ fragmentIds: ["f1", "f2", "f3"] });
      const deps = makeMockDeps(fragments, [cluster], makeValidLlmResponse());

      await crystallize("user-1", makePersona(), defaultConfig, deps);

      expect(deps.touchFragments).toHaveBeenCalledWith("user-1", ["f1", "f2", "f3"]);
    });

    it("skips cluster fragments not found in loaded fragments", async () => {
      const fragments = [
        makeFragment({ id: "f1" }),
        makeFragment({ id: "f2" }),
        makeFragment({ id: "f3" }),
      ];
      const cluster = makeCluster({ fragmentIds: ["f1", "f2", "f-ghost", "f3"] });
      const deps = makeMockDeps(fragments, [cluster], makeValidLlmResponse());

      const result = await crystallize("user-1", makePersona(), defaultConfig, deps);

      expect(result).toHaveLength(1);
      expect(result[0].supportingFragmentIds).toEqual(["f1", "f2", "f3"]);
    });
  });

  describe("domain overlap dedup", () => {
    it("skips cluster with >70% domain overlap with existing activeBlindSpot", async () => {
      const cluster = makeCluster({ domains: ["a", "b", "c"] });
      const existingBS: BlindSpotCandidate = {
        id: "bs-1",
        blindSpot: "existing",
        supportingFragmentIds: [],
        potentialImpact: "connection_reveal",
        domains: ["a", "b", "c"],
        unusedDomains: [],
        crystallizationScore: 0.5,
      };
      const persona = makePersona({ activeBlindSpots: [existingBS] });
      const deps = makeMockDeps([], [cluster], makeValidLlmResponse());

      const result = await crystallize("user-1", persona, defaultConfig, deps, "signal");

      expect(result).toEqual([]);
    });

    it("processes cluster with <70% domain overlap", async () => {
      const fragments = [
        makeFragment({ id: "f1", domains: ["a"] }),
        makeFragment({ id: "f2", domains: ["b"] }),
        makeFragment({ id: "f3", domains: ["c"] }),
      ];
      const cluster = makeCluster({
        fragmentIds: ["f1", "f2", "f3"],
        domains: ["a", "b", "c"],
      });
      const existingBS: BlindSpotCandidate = {
        id: "bs-1",
        blindSpot: "existing",
        supportingFragmentIds: [],
        potentialImpact: "connection_reveal",
        domains: ["x", "y", "z"],
        unusedDomains: [],
        crystallizationScore: 0.5,
      };
      const persona = makePersona({ activeBlindSpots: [existingBS] });
      const deps = makeMockDeps(fragments, [cluster], makeValidLlmResponse());

      const result = await crystallize("user-1", persona, defaultConfig, deps, "signal");

      expect(result).toHaveLength(1);
    });
  });

  describe("LLM parsing", () => {
    it("parses valid JSON object response", () => {
      const fragments = [makeFragment({ id: "f1" })];
      const result = parseBlindSpot(
        '{"blindSpot":"test spot","potentialImpact":"risk_avoidance","crystallizationScore":0.9}',
        fragments,
        ["a"],
        [],
      );

      expect(result).not.toBeNull();
      expect(result!.blindSpot).toBe("test spot");
      expect(result!.potentialImpact).toBe("risk_avoidance");
      expect(result!.crystallizationScore).toBe(0.9);
    });

    it("returns null for malformed JSON", () => {
      const result = parseBlindSpot("not json at all", [makeFragment()], ["a"], []);
      expect(result).toBeNull();
    });

    it("returns null for missing blindSpot field", () => {
      const result = parseBlindSpot(
        '{"potentialImpact":"connection_reveal","crystallizationScore":0.5}',
        [makeFragment()],
        ["a"],
        [],
      );
      expect(result).toBeNull();
    });

    it("defaults potentialImpact to connection_reveal on invalid value", () => {
      const result = parseBlindSpot(
        '{"blindSpot":"test","potentialImpact":"invalid_value","crystallizationScore":0.5}',
        [makeFragment()],
        ["a"],
        [],
      );
      expect(result).not.toBeNull();
      expect(result!.potentialImpact).toBe("connection_reveal");
    });

    it("defaults crystallizationScore to 0.5 on missing value", () => {
      const result = parseBlindSpot(
        '{"blindSpot":"test","potentialImpact":"connection_reveal"}',
        [makeFragment()],
        ["a"],
        [],
      );
      expect(result).not.toBeNull();
      expect(result!.crystallizationScore).toBe(0.5);
    });

    it("clamps crystallizationScore to 0-1", () => {
      const high = parseBlindSpot(
        '{"blindSpot":"test","crystallizationScore":2.5}',
        [makeFragment()],
        ["a"],
        [],
      );
      expect(high!.crystallizationScore).toBe(1);

      const low = parseBlindSpot(
        '{"blindSpot":"test","crystallizationScore":-0.5}',
        [makeFragment()],
        ["a"],
        [],
      );
      expect(low!.crystallizationScore).toBe(0);
    });
  });

  describe("error handling", () => {
    it("continues processing other clusters if one fails", async () => {
      const fragments = Array.from({ length: 6 }, (_, i) =>
        makeFragment({ id: `f${i}`, domains: [`d${i}`] }),
      );
      const failCluster = makeCluster({
        id: "c-fail",
        fragmentIds: ["f0", "f1", "f2"],
      });
      const okCluster = makeCluster({
        id: "c-ok",
        fragmentIds: ["f3", "f4", "f5"],
      });

      let callCount = 0;
      const deps: CrystallizationDeps = {
        complete: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) throw new Error("LLM failure");
          return { content: [{ type: "text", text: makeValidLlmResponse() }] };
        }),
        prepareModel: vi.fn().mockResolvedValue({
          model: { provider: "zai", id: "glm-5-turbo" },
          auth: { apiKey: "test-key", mode: "env" },
        }),
        loadFragments: vi.fn().mockResolvedValue(fragments),
        saveFragments: vi.fn().mockResolvedValue(undefined),
        findClusters: vi.fn().mockResolvedValue([failCluster, okCluster]),
        touchFragments: vi.fn().mockResolvedValue(undefined),
      };

      const result = await crystallize("user-1", makePersona(), defaultConfig, deps, "deep_scan");

      expect(result).toHaveLength(1);
      expect(result[0].blindSpot).toBeTypeOf("string");
    });

    it("never throws — all errors caught", async () => {
      const deps: CrystallizationDeps = {
        complete: vi.fn().mockRejectedValue(new Error("catastrophic")),
        prepareModel: vi.fn().mockRejectedValue(new Error("model fail")),
        loadFragments: vi.fn().mockRejectedValue(new Error("load fail")),
        saveFragments: vi.fn().mockResolvedValue(undefined),
        findClusters: vi.fn().mockRejectedValue(new Error("cluster fail")),
        touchFragments: vi.fn().mockResolvedValue(undefined),
      };

      const result = await crystallize("user-1", makePersona(), defaultConfig, deps);

      expect(result).toEqual([]);
    });
  });
});
