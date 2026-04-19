import { describe, expect, it } from "vitest";
import { DEFAULT_EVOLUTION_CONFIG } from "./types.js";

describe("EvolutionConfig defaults", () => {
  it("has sensible default values", () => {
    expect(DEFAULT_EVOLUTION_CONFIG.minComplexity).toBe(0.6);
    expect(DEFAULT_EVOLUTION_CONFIG.cooldownHours).toBe(24);
    expect(DEFAULT_EVOLUTION_CONFIG.maxSuggestionsPerDay).toBe(3);
    expect(DEFAULT_EVOLUTION_CONFIG.minTrustScore).toBe(0.5);
    expect(DEFAULT_EVOLUTION_CONFIG.enabled).toBe(true);
  });

  it("all numeric defaults are in valid range", () => {
    const { minComplexity, cooldownHours, maxSuggestionsPerDay, minTrustScore } = DEFAULT_EVOLUTION_CONFIG;
    expect(minComplexity).toBeGreaterThan(0);
    expect(minComplexity).toBeLessThanOrEqual(1);
    expect(cooldownHours).toBeGreaterThan(0);
    expect(maxSuggestionsPerDay).toBeGreaterThan(0);
    expect(minTrustScore).toBeGreaterThan(0);
    expect(minTrustScore).toBeLessThanOrEqual(1);
  });
});
