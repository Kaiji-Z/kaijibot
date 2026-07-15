import { describe, expect, it } from "vitest";
import {
  buildSupervisorPrompt,
  createSupervisor,
  DEFAULT_DIMENSIONS,
  DEFAULT_THRESHOLD,
  type SupervisionInput,
} from "./supervisor.js";

/** Deterministic mock generateText — returns canned JSON. No real LLM. */
function mockGenerate(response: string) {
  return async () => response;
}

const SAMPLE_INPUT: SupervisionInput = {
  expected: "The insight must reference a domain from the user's persona.",
  actual: "You've been exploring eBPF — here's how it pairs with your tracing work.",
  artifactKind: "proactive insight",
};

describe("buildSupervisorPrompt — clean-context contract (§3.2)", () => {
  it("contains expected + actual but never asks for code/implementation context", () => {
    const prompt = buildSupervisorPrompt(SAMPLE_INPUT, DEFAULT_DIMENSIONS, {
      quality: "q?",
      relevance: "r?",
      novelty: "n?",
      safety: "s?",
    });
    expect(prompt).toContain("Expected correct behavior");
    expect(prompt).toContain(SAMPLE_INPUT.expected);
    expect(prompt).toContain(SAMPLE_INPUT.actual);
    expect(prompt).toContain(SAMPLE_INPUT.artifactKind);
    // The judge is told it does NOT know / need the implementation.
    expect(prompt).toMatch(/do NOT know how the code is written/);
  });

  it("includes every requested dimension in the JSON instruction", () => {
    const prompt = buildSupervisorPrompt(SAMPLE_INPUT, ["coherence"], {
      coherence: "is it coherent?",
    });
    expect(prompt).toContain('"coherence": 0.0-1.0');
  });
});

describe("createSupervisor", () => {
  it("passes when every dimension >= threshold", async () => {
    const supervise = createSupervisor({
      generateText: mockGenerate(
        JSON.stringify({
          quality: 0.9,
          relevance: 0.85,
          novelty: 0.8,
          safety: 1,
          deductions: [],
        }),
      ),
    });
    const result = await supervise.supervise(SAMPLE_INPUT);
    expect(result.passed).toBe(true);
    expect(result.mean).toBeCloseTo((0.9 + 0.85 + 0.8 + 1) / 4, 5);
    expect(result.deductions).toEqual([]);
  });

  it("fails and emits a deduction for every sub-threshold dimension", async () => {
    const supervise = createSupervisor({
      generateText: mockGenerate(
        JSON.stringify({
          quality: 0.4,
          relevance: 0.9,
          novelty: 0.3,
          safety: 1,
          deductions: [],
        }),
      ),
    });
    const result = await supervise.supervise(SAMPLE_INPUT);
    expect(result.passed).toBe(false);
    expect(result.scores.quality).toBe(0.4);
    expect(result.scores.novelty).toBe(0.3);
    // Two sub-threshold deductions, keyed by dimension prefix.
    const keys = result.deductions.map((d) => d.split(":")[0]);
    expect(keys).toContain("quality");
    expect(keys).toContain("novelty");
    expect(keys).not.toContain("relevance");
  });

  it("clamps out-of-range and non-numeric scores to [0,1]", async () => {
    const supervise = createSupervisor({
      generateText: mockGenerate(
        JSON.stringify({ quality: 5, relevance: -1, novelty: "0.7", safety: "high" }),
      ),
    });
    const result = await supervise.supervise(SAMPLE_INPUT);
    expect(result.scores.quality).toBe(1);
    expect(result.scores.relevance).toBe(0);
    expect(result.scores.novelty).toBe(0.7);
    expect(result.scores.safety).toBe(0);
  });

  it("fails closed when the LLM returns unparseable output", async () => {
    const supervise = createSupervisor({
      generateText: mockGenerate("not json at all"),
    });
    const result = await supervise.supervise(SAMPLE_INPUT);
    expect(result.passed).toBe(false);
    expect(result.mean).toBe(0);
    expect(result.deductions.length).toBeGreaterThan(0);
  });

  it("respects a custom threshold and dimensions", async () => {
    const supervise = createSupervisor({
      generateText: mockGenerate(JSON.stringify({ coherence: 0.65, deductions: [] })),
      dimensions: ["coherence"],
      dimensionGuide: { coherence: "is it coherent?" },
      threshold: 0.7,
    });
    const below = await supervise.supervise(SAMPLE_INPUT);
    expect(below.passed).toBe(false);
    expect(DEFAULT_THRESHOLD).toBe(0.7);
  });

  it("deduplicates deductions sharing a dimension prefix", async () => {
    const supervise = createSupervisor({
      generateText: mockGenerate(
        JSON.stringify({
          quality: 0.2,
          relevance: 1,
          novelty: 1,
          safety: 1,
          deductions: ["quality: judge-supplied reason"],
        }),
      ),
    });
    const result = await supervise.supervise(SAMPLE_INPUT);
    // Only one quality-keyed deduction survives dedup.
    const qualityDeductions = result.deductions.filter((d) => d.startsWith("quality"));
    expect(qualityDeductions).toHaveLength(1);
  });
});
