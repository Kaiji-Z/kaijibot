import { describe, expect, it } from "vitest";
import { DEFAULT_EVOLUTION_CONFIG } from "./types.js";

describe("EvolutionConfig defaults", () => {
  it("has sensible default values", () => {
    expect(DEFAULT_EVOLUTION_CONFIG.minComplexity).toBe(0.4);
    expect(DEFAULT_EVOLUTION_CONFIG.errorComplexityThreshold).toBe(0.3);
    expect(DEFAULT_EVOLUTION_CONFIG.minTrustScore).toBe(0.5);
    expect(DEFAULT_EVOLUTION_CONFIG.enabled).toBe(true);
  });

  it("all numeric defaults are in valid range", () => {
    const { minComplexity, errorComplexityThreshold, minTrustScore } = DEFAULT_EVOLUTION_CONFIG;
    expect(minComplexity).toBeGreaterThan(0);
    expect(minComplexity).toBeLessThanOrEqual(1);
    expect(errorComplexityThreshold).toBeGreaterThan(0);
    expect(errorComplexityThreshold).toBeLessThan(minComplexity);
    expect(minTrustScore).toBeGreaterThan(0);
    expect(minTrustScore).toBeLessThanOrEqual(1);
  });
});
