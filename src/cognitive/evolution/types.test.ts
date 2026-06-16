import { describe, expect, it } from "vitest";
import { DEFAULT_EVOLUTION_CONFIG } from "./types.js";

describe("EvolutionConfig defaults", () => {
  it("has sensible default values", () => {
    expect(DEFAULT_EVOLUTION_CONFIG.enabled).toBe(true);
  });
});
