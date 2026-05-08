import { describe, expect, it } from "vitest";
import { formatCorrectionsPrompt, MAX_INJECTED_CORRECTIONS } from "./injector.js";
import type { CorrectionRecord } from "./types.js";

function makeCorrection(overrides?: Partial<CorrectionRecord>): CorrectionRecord {
  return {
    id: "test-id",
    domain: "test",
    trigger: "test trigger",
    mistake: "test mistake",
    correction: "test correction",
    provenance: "self",
    reinforcedCount: 0,
    createdAt: Date.now(),
    lastReinforced: Date.now(),
    ...overrides,
  };
}

describe("formatCorrectionsPrompt", () => {
  it("returns empty string for empty array", () => {
    expect(formatCorrectionsPrompt([])).toBe("");
  });

  it("formats single correction", () => {
    const result = formatCorrectionsPrompt([makeCorrection()]);
    expect(result).toContain("## Known Corrections");
    expect(result).toContain("[test trigger]");
    expect(result).toContain("test mistake → test correction");
  });

  it("sorts by reinforcedCount desc then lastReinforced desc", () => {
    const corrections = [
      makeCorrection({ trigger: "low-count", reinforcedCount: 0, lastReinforced: 100 }),
      makeCorrection({ trigger: "high-count", reinforcedCount: 3, lastReinforced: 50 }),
      makeCorrection({ trigger: "mid-count", reinforcedCount: 1, lastReinforced: 200 }),
    ];
    const result = formatCorrectionsPrompt(corrections);
    const lines = result.split("\n").filter((l) => l.match(/^\d+\./));
    expect(lines[0]).toContain("high-count");
    expect(lines[1]).toContain("mid-count");
    expect(lines[2]).toContain("low-count");
  });

  it("uses lastReinforced as tiebreaker when reinforcedCount is equal", () => {
    const corrections = [
      makeCorrection({ trigger: "older", reinforcedCount: 2, lastReinforced: 100 }),
      makeCorrection({ trigger: "newer", reinforcedCount: 2, lastReinforced: 300 }),
    ];
    const result = formatCorrectionsPrompt(corrections);
    const lines = result.split("\n").filter((l) => l.match(/^\d+\./));
    expect(lines[0]).toContain("newer");
    expect(lines[1]).toContain("older");
  });

  it("truncates at MAX_INJECTED_CORRECTIONS", () => {
    const corrections = Array.from({ length: 20 }, (_, i) =>
      makeCorrection({ id: `corr-${i}`, trigger: `trigger ${i}` }),
    );
    const result = formatCorrectionsPrompt(corrections);
    const numberedLines = result.split("\n").filter((l) => l.match(/^\d+\./));
    expect(numberedLines).toHaveLength(MAX_INJECTED_CORRECTIONS);
  });
});
