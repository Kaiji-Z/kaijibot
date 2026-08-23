import { describe, it, expect } from "vitest";
import type { PersonaTree } from "../types.js";
import { computeContentStrategy } from "./content-strategy.js";

function makePersona(overrides: Partial<PersonaTree["feedbackProfile"]> = {}): PersonaTree {
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
      recentInsightDomains: [
        ["ai", "ml"],
        ["rust", "systems"],
      ],
    });
    const hint = computeContentStrategy(persona);
    expect(hint.excludeDomains).toEqual(["rust", "systems"]);
    expect(hint.forceMode).toBeUndefined();
    expect(hint.noveltyBoost).toBe(false);
  });

  // MIGRATED (goal 洞察投放人化重构): from streak 2 the ledger itself
  // throttles contact (g(U) + veto) — the strategy no longer forces modes
  // or boosts novelty; being ignored means going quiet, not trying harder.
  it("streak 2 excludes last 2 insight domains without forcing a mode", () => {
    const persona = makePersona({
      consecutiveNoResponses: 2,
      recentInsightDomains: [["ai"], ["rust"], ["web"]],
      recentInsightModes: ["surprise", "pattern", "extend"],
    });
    const hint = computeContentStrategy(persona);
    expect(hint.excludeDomains.toSorted()).toEqual(["rust", "web"].toSorted());
    expect(hint.forceMode).toBeUndefined();
    expect(hint.noveltyBoost).toBe(false);
  });

  // MIGRATED (goal 洞察投放人化重构): streak ≥3 previously forced surprise +
  // noveltyBoost ("try harder"); now the ledger has priority — exclusions
  // only, no force, no boost.
  it("streak 3+ excludes recent domains, no forced mode, no novelty boost", () => {
    const persona = makePersona({
      consecutiveNoResponses: 5,
      recentInsightDomains: [["a"], ["b", "c"], ["d"], ["e"]],
      recentInsightModes: ["pattern", "surprise", "extend"],
    });
    const hint = computeContentStrategy(persona);
    expect(hint.excludeDomains.toSorted()).toEqual(["d", "e"].toSorted());
    expect(hint.forceMode).toBeUndefined();
    expect(hint.noveltyBoost).toBe(false);
  });

  // MIGRATED (goal 洞察投放人化重构): same as above — no forced mode at
  // high streaks even with no domain history.
  it("empty recentInsightDomains produces no exclusions or forced mode", () => {
    const persona = makePersona({
      consecutiveNoResponses: 3,
      recentInsightDomains: [],
    });
    const hint = computeContentStrategy(persona);
    expect(hint.excludeDomains).toEqual([]);
    expect(hint.forceMode).toBeUndefined();
    expect(hint.noveltyBoost).toBe(false);
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

  // MIGRATED (goal 洞察投放人化重构): deleted "modeBandits influence mode
  // selection at streak 2" — strategy no longer selects modes; Thompson
  // Sampling mode selection lives in mode-selection.ts (selectMode).

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
      recentInsightDomains: [
        ["ai", "ml"],
        ["ai", "rust"],
      ],
      recentInsightModes: ["surprise"],
    });
    const hint = computeContentStrategy(persona);
    const unique = new Set(hint.excludeDomains);
    expect(unique.size).toBe(hint.excludeDomains.length);
    expect(hint.excludeDomains.toSorted()).toEqual(["ai", "ml", "rust"].toSorted());
  });
});
