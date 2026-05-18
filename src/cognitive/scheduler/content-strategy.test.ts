import { describe, it, expect, vi } from "vitest";
import { computeContentStrategy } from "./content-strategy.js";
import type { PersonaTree } from "../types.js";

function makePersona(
  overrides: Partial<PersonaTree["feedbackProfile"]> = {},
): PersonaTree {
  return {
    identity: {
      coreTraits: {},
      expertDomains: [],
      interestDomains: [],
      curiosityDomains: [],
    },
    domains: {},
    recentFocus: [],
    feedbackProfile: {
      topicBandits: {},
      optimalFrequencyHours: 4,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [],
      ...overrides,
    },
    rapport: {
      trustScore: 0.5,
      totalExchanges: 10,
      avgResponseLength: 50,
      selfDisclosureLevel: 0.3,
    },
    domainBlacklist: [],
    lifecycle: {
      stage: "new",
      lastActiveAt: 0,
      lastStageTransitionAt: 0,
      totalActiveDays: 0,
    },
    calibrationHistory: [],
    moodHistory: [],
  };
}

describe("computeContentStrategy", () => {
  it("streak 0 returns empty hint", () => {
    const persona = makePersona({ consecutiveNoResponses: 0 });
    const hint = computeContentStrategy(persona);
    expect(hint.excludeDomains).toEqual([]);
    expect(hint.forceMode).toBeUndefined();
    expect(hint.noveltyBoost).toBe(false);
  });

  it("streak 1 excludes last insight domains", () => {
    const persona = makePersona({
      consecutiveNoResponses: 1,
      recentInsightDomains: [["ai", "ml"], ["rust", "systems"]],
    });
    const hint = computeContentStrategy(persona);
    expect(hint.excludeDomains).toEqual(["rust", "systems"]);
    expect(hint.forceMode).toBeUndefined();
    expect(hint.noveltyBoost).toBe(false);
  });

  it("streak 2 excludes last 2 insights domains and forces different mode", () => {
    const persona = makePersona({
      consecutiveNoResponses: 2,
      recentInsightDomains: [["ai"], ["rust"], ["web"]],
      recentInsightModes: ["surprise", "pattern", "extend"],
    });
    const hint = computeContentStrategy(persona);
    expect(hint.excludeDomains.sort()).toEqual(["rust", "web"].sort());
    expect(hint.forceMode).toBeDefined();
    expect(hint.forceMode).not.toBe("extend");
    expect(hint.noveltyBoost).toBe(false);
  });

  it("streak 3+ forces surprise with noveltyBoost", () => {
    const persona = makePersona({
      consecutiveNoResponses: 5,
      recentInsightDomains: [["a"], ["b", "c"], ["d"], ["e"]],
      recentInsightModes: ["pattern", "surprise", "extend"],
    });
    const hint = computeContentStrategy(persona);
    expect(hint.excludeDomains.sort()).toEqual(["b", "c", "d", "e"].sort());
    expect(hint.forceMode).toBe("surprise");
    expect(hint.noveltyBoost).toBe(true);
  });

  it("empty recentInsightDomains produces no exclusions", () => {
    const persona = makePersona({
      consecutiveNoResponses: 3,
      recentInsightDomains: [],
    });
    const hint = computeContentStrategy(persona);
    expect(hint.excludeDomains).toEqual([]);
    expect(hint.forceMode).toBe("surprise");
    expect(hint.noveltyBoost).toBe(true);
  });

  it("streak 2 with no recentInsightModes does not force mode", () => {
    const persona = makePersona({
      consecutiveNoResponses: 2,
      recentInsightDomains: [["x"]],
      recentInsightModes: [],
    });
    const hint = computeContentStrategy(persona);
    expect(hint.forceMode).toBeUndefined();
  });

  it("modeBandits influence mode selection at streak 2", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const persona = makePersona({
      consecutiveNoResponses: 2,
      recentInsightDomains: [["a"], ["b"]],
      recentInsightModes: ["pattern"],
      modeBandits: {
        surprise: { alpha: 10, beta: 1 },
        extend: { alpha: 1, beta: 10 },
      },
    });

    const hint = computeContentStrategy(persona);
    expect(hint.forceMode).toBe("surprise");
    expect(hint.noveltyBoost).toBe(false);

    vi.restoreAllMocks();
  });

  it("does not mutate input persona", () => {
    const persona = makePersona({
      consecutiveNoResponses: 2,
      recentInsightDomains: [["a"], ["b", "c"]],
      recentInsightModes: ["pattern"],
    });

    const domainsBefore = JSON.stringify(persona.feedbackProfile.recentInsightDomains);
    const modesBefore = JSON.stringify(persona.feedbackProfile.recentInsightModes);

    computeContentStrategy(persona);

    expect(JSON.stringify(persona.feedbackProfile.recentInsightDomains)).toBe(domainsBefore);
    expect(JSON.stringify(persona.feedbackProfile.recentInsightModes)).toBe(modesBefore);
  });

  it("single domain at streak 1 excludes that domain", () => {
    const persona = makePersona({
      consecutiveNoResponses: 1,
      recentInsightDomains: [["kubernetes"]],
    });
    const hint = computeContentStrategy(persona);
    expect(hint.excludeDomains).toEqual(["kubernetes"]);
    expect(hint.forceMode).toBeUndefined();
  });

  it("undefined consecutiveNoResponses treated as 0", () => {
    const persona = makePersona({
      consecutiveNoResponses: undefined,
      recentInsightDomains: [["a", "b"]],
    });
    const hint = computeContentStrategy(persona);
    expect(hint.excludeDomains).toEqual([]);
    expect(hint.forceMode).toBeUndefined();
    expect(hint.noveltyBoost).toBe(false);
  });

  it("deduplicates overlapping domains across insights", () => {
    const persona = makePersona({
      consecutiveNoResponses: 2,
      recentInsightDomains: [["ai", "ml"], ["ai", "rust"]],
      recentInsightModes: ["surprise"],
    });
    const hint = computeContentStrategy(persona);
    const unique = new Set(hint.excludeDomains);
    expect(unique.size).toBe(hint.excludeDomains.length);
    expect(hint.excludeDomains.sort()).toEqual(["ai", "ml", "rust"].sort());
  });
});
