import { describe, it, expect } from "vitest";
import type { TopicBandit } from "../types.js";
import { banditWeightedSelect, selectMode } from "./mode-selection.js";

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
    const r1 = banditWeightedSelect(["pattern", "surprise", "extend"], bandits, 1234);
    const r2 = banditWeightedSelect(["pattern", "surprise", "extend"], bandits, 1234);
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
      results.add(banditWeightedSelect(["pattern", "surprise", "extend"], bandits, seed));
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
      if (banditWeightedSelect(["surprise", "extend"], bandits, seed) === "surprise") {
        surpriseCount++;
      }
    }
    expect(surpriseCount).toBeGreaterThan(n * 0.5);
  });

  it("uses equal weighting when no bandits provided", () => {
    const counts = { pattern: 0, surprise: 0, extend: 0 };
    const n = 10000;
    for (let seed = 0; seed < n; seed++) {
      const r = banditWeightedSelect(["pattern", "surprise", "extend"], undefined, seed);
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
      const r = banditWeightedSelect(["pattern", "surprise", "extend"], bandits, seed);
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
      if (banditWeightedSelect(["pattern", "surprise", "extend"], bandits, seed) === "extend") {
        extendCount++;
      }
    }
    expect(extendCount).toBeGreaterThan(0);
  });

  it("30% floor guarantees >=15% even with extreme negative bandits", () => {
    // Extend has baseWeight=0.1 and extreme negative bandit (α=1, β=1000)
    // Without floor: raw = 0.1 * (1/1001) ≈ 0.0001 → effectively 0%
    // With 30% floor: floored = 0.3 + 0.7*0.0001 ≈ 0.3001 → normalized ~19.6%
    const bandits: Record<string, TopicBandit> = {
      pattern: { alpha: 1000, beta: 1 },
      surprise: { alpha: 1000, beta: 1 },
      extend: { alpha: 1, beta: 1000 },
    };
    const counts: Record<string, number> = { pattern: 0, surprise: 0, extend: 0 };
    const n = 10000;
    for (let seed = 0; seed < n; seed++) {
      counts[banditWeightedSelect(["pattern", "surprise", "extend"], bandits, seed)]++;
    }
    // Extend must get at least 15% (theoretical ~19.6%, conservative threshold)
    expect(counts.extend / n).toBeGreaterThan(0.15);
    // No single mode should dominate >50% with the floor in place
    expect(counts.pattern / n).toBeLessThan(0.50);
    expect(counts.surprise / n).toBeLessThan(0.50);
  });

  it("all modes get >=10% with default (no) bandits", () => {
    // Default bandits: all get banditFactor=0.5
    // pattern: 0.3+0.7*(0.5*0.5)=0.475 → ~38%
    // surprise: 0.3+0.7*(0.4*0.5)=0.440 → ~35%
    // extend:   0.3+0.7*(0.1*0.5)=0.335 → ~27%
    const counts: Record<string, number> = { pattern: 0, surprise: 0, extend: 0 };
    const n = 10000;
    for (let seed = 0; seed < n; seed++) {
      counts[banditWeightedSelect(["pattern", "surprise", "extend"], undefined, seed)]++;
    }
    for (const mode of ["pattern", "surprise", "extend"] as const) {
      expect(counts[mode] / n, `${mode} should be >= 10%`).toBeGreaterThan(0.10);
    }
  });

  it("all modes get >=10% with equal bandits", () => {
    const bandits: Record<string, TopicBandit> = {
      pattern: { alpha: 2, beta: 2 },
      surprise: { alpha: 2, beta: 2 },
      extend: { alpha: 2, beta: 2 },
    };
    const counts: Record<string, number> = { pattern: 0, surprise: 0, extend: 0 };
    const n = 10000;
    for (let seed = 0; seed < n; seed++) {
      counts[banditWeightedSelect(["pattern", "surprise", "extend"], bandits, seed)]++;
    }
    for (const mode of ["pattern", "surprise", "extend"] as const) {
      expect(counts[mode] / n, `${mode} should be >= 10%`).toBeGreaterThan(0.10);
    }
  });

  it("no mode exceeds 60% even with extreme positive bandit", () => {
    const bandits: Record<string, TopicBandit> = {
      pattern: { alpha: 10000, beta: 1 },
      surprise: { alpha: 1, beta: 1 },
      extend: { alpha: 1, beta: 1 },
    };
    const counts: Record<string, number> = { pattern: 0, surprise: 0, extend: 0 };
    const n = 10000;
    for (let seed = 0; seed < n; seed++) {
      counts[banditWeightedSelect(["pattern", "surprise", "extend"], bandits, seed)]++;
    }
    // Even with extreme positive bandit, floor caps pattern at ~45%
    expect(counts.pattern / n).toBeLessThan(0.60);
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
