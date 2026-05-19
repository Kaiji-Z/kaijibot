import { describe, it, expect } from "vitest";
import { banditWeightedSelect, selectMode } from "./mode-selection.js";
import type { TopicBandit } from "../types.js";
import type { ContentStrategyHint } from "./content-strategy.js";

describe("banditWeightedSelect", () => {
  it("returns the only candidate when single", () => {
    const result = banditWeightedSelect(["surprise"], undefined, 42);
    expect(result).toBe("surprise");
  });

  it("returns the only candidate when array has one element", () => {
    const result = banditWeightedSelect(["pattern"], undefined, 0);
    expect(result).toBe("pattern");
  });

  it("falls back to all base weights when candidates empty", () => {
    const result = banditWeightedSelect([], undefined, 42);
    // Should return one of the three modes, not crash
    expect(["pattern", "surprise", "extend"]).toContain(result);
  });

  it("produces deterministic results for same seed", () => {
    const bandits: Record<string, TopicBandit> = {
      pattern: { alpha: 3, beta: 2 },
      surprise: { alpha: 2, beta: 1 },
    };
    const r1 = banditWeightedSelect(
      ["pattern", "surprise", "extend"],
      bandits,
      1234,
    );
    const r2 = banditWeightedSelect(
      ["pattern", "surprise", "extend"],
      bandits,
      1234,
    );
    expect(r1).toBe(r2);
  });

  it("produces different results for different seeds", () => {
    const results = new Set<string>();
    const bandits: Record<string, TopicBandit> = {
      pattern: { alpha: 3, beta: 2 },
      surprise: { alpha: 2, beta: 1 },
      extend: { alpha: 2, beta: 1 },
    };
    // Seeds must span full 0-9999 range: roll = (seed % 10000) / 10000
    for (let seed = 0; seed < 10000; seed += 100) {
      results.add(
        banditWeightedSelect(["pattern", "surprise", "extend"], bandits, seed),
      );
    }
    expect(results.size).toBeGreaterThanOrEqual(2);
  });

  it("favors mode with higher bandit alpha/(alpha+beta)", () => {
    const bandits: Record<string, TopicBandit> = {
      surprise: { alpha: 100, beta: 1 },
      extend: { alpha: 1, beta: 100 },
    };
    let surpriseCount = 0;
    const n = 10000;
    for (let seed = 0; seed < n; seed++) {
      if (
        banditWeightedSelect(["surprise", "extend"], bandits, seed) ===
        "surprise"
      ) {
        surpriseCount++;
      }
    }
    expect(surpriseCount).toBeGreaterThan(n * 0.5);
  });

  it("uses equal weighting when no bandits provided", () => {
    const counts = { pattern: 0, surprise: 0, extend: 0 };
    const n = 10000;
    for (let seed = 0; seed < n; seed++) {
      const r = banditWeightedSelect(
        ["pattern", "surprise", "extend"],
        undefined,
        seed,
      );
      counts[r]++;
    }
    expect(counts.extend).toBeGreaterThan(0);
    expect(counts.pattern).toBeGreaterThan(counts.extend);
  });

  it("respects base weight ordering when bandits are equal", () => {
    const bandits: Record<string, TopicBandit> = {
      pattern: { alpha: 2, beta: 2 },
      surprise: { alpha: 2, beta: 2 },
      extend: { alpha: 2, beta: 2 },
    };
    const counts = { pattern: 0, surprise: 0, extend: 0 };
    const n = 10000;
    for (let seed = 0; seed < n; seed++) {
      const r = banditWeightedSelect(
        ["pattern", "surprise", "extend"],
        bandits,
        seed,
      );
      counts[r]++;
    }
    expect(counts.pattern).toBeGreaterThan(counts.surprise);
    expect(counts.surprise).toBeGreaterThan(counts.extend);
  });

  it("floor prevents any mode from being completely eliminated", () => {
    const bandits: Record<string, TopicBandit> = {
      pattern: { alpha: 1000, beta: 1 },
      surprise: { alpha: 1000, beta: 1 },
      extend: { alpha: 1, beta: 1000 },
    };
    let extendCount = 0;
    for (let seed = 0; seed < 10000; seed++) {
      if (
        banditWeightedSelect(["pattern", "surprise", "extend"], bandits, seed) ===
        "extend"
      ) {
        extendCount++;
      }
    }
    expect(extendCount).toBeGreaterThan(0);
  });
});

describe("selectMode", () => {
  it("returns forceMode from strategy hint (highest priority)", () => {
    const result = selectMode(
      ["pattern", "surprise"],
      { surprise: { alpha: 100, beta: 1 } },
      { excludeDomains: [], forceMode: "extend", noveltyBoost: false },
      42,
    );
    expect(result).toBe("extend");
  });

  it("uses bandit-weighted selection when no forceMode", () => {
    const result = selectMode(
      ["surprise"],
      undefined,
      { excludeDomains: [], noveltyBoost: false },
      42,
    );
    expect(result).toBe("surprise");
  });

  it("falls back to all modes when modeCandidates is undefined", () => {
    const result = selectMode(undefined, undefined, undefined, 42);
    expect(["pattern", "surprise", "extend"]).toContain(result);
  });

  it("passes modeCandidates to banditWeightedSelect", () => {
    const result = selectMode(
      ["surprise", "extend"],
      undefined,
      { excludeDomains: [], noveltyBoost: false },
      42,
    );
    expect(["surprise", "extend"]).toContain(result);
  });

  it("ignores strategy hint when forceMode is undefined", () => {
    const bandits: Record<string, TopicBandit> = {
      surprise: { alpha: 1000, beta: 1 },
    };
    let surpriseCount = 0;
    for (let seed = 0; seed < 10000; seed++) {
      if (
        selectMode(
          ["pattern", "surprise"],
          bandits,
          { excludeDomains: [], noveltyBoost: true },
          seed,
        ) === "surprise"
      ) {
        surpriseCount++;
      }
    }
    expect(surpriseCount).toBeGreaterThan(5000);
  });

  it("forceMode overrides even with strong bandits for other modes", () => {
    const bandits: Record<string, TopicBandit> = {
      pattern: { alpha: 1000, beta: 1 },
      surprise: { alpha: 1000, beta: 1 },
    };
    const result = selectMode(
      ["pattern", "surprise"],
      bandits,
      { excludeDomains: [], forceMode: "extend", noveltyBoost: false },
      42,
    );
    expect(result).toBe("extend");
  });
});
