import { describe, expect, it } from "vitest";
import {
  formatCorrectionsPrompt,
  MAX_INJECTED_CORRECTIONS,
  selectRelevantCorrections,
} from "./injector.js";
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

describe("selectRelevantCorrections", () => {
  it("returns empty array for empty input", () => {
    expect(selectRelevantCorrections([], "anything")).toEqual([]);
  });

  it("returns all sorted by reinforcedCount when count <= limit", () => {
    const low = makeCorrection({ id: "low", reinforcedCount: 0 });
    const high = makeCorrection({ id: "high", reinforcedCount: 5 });
    const mid = makeCorrection({ id: "mid", reinforcedCount: 2 });
    const result = selectRelevantCorrections([low, high, mid], "any message", 5);
    expect(result.map((r) => r.id)).toEqual(["high", "mid", "low"]);
  });

  it("falls back to top-N by reinforcedCount when no overlap", () => {
    const corrections = Array.from({ length: 20 }, (_, i) =>
      makeCorrection({
        id: `c-${i}`,
        domain: "cooking",
        trigger: "cooking trigger",
        mistake: "burned the food",
        reinforcedCount: i,
      }),
    );
    const result = selectRelevantCorrections(corrections, "completely unrelated message", 5);
    expect(result).toHaveLength(5);
    expect(result[0].reinforcedCount).toBe(19);
    expect(result[4].reinforcedCount).toBe(15);
  });

  it("prioritizes corrections with token overlap on current message", () => {
    const unrelated = makeCorrection({
      id: "unrelated",
      domain: "cooking",
      trigger: "cooking",
      mistake: "burned the food",
      reinforcedCount: 10,
    });
    const related = makeCorrection({
      id: "related",
      domain: "git",
      trigger: "git commit",
      mistake: "forgot to commit the changes",
      reinforcedCount: 1,
    });
    const result = selectRelevantCorrections(
      [unrelated, related],
      "please git commit these changes",
      1,
    );
    expect(result[0].id).toBe("related");
  });

  it("respects limit parameter", () => {
    const corrections = Array.from({ length: 30 }, (_, i) =>
      makeCorrection({ id: `c-${i}`, reinforcedCount: i }),
    );
    const result = selectRelevantCorrections(corrections, "any message", 10);
    expect(result).toHaveLength(10);
  });

  it("uses default limit when limit parameter omitted", () => {
    const corrections = Array.from({ length: 30 }, (_, i) =>
      makeCorrection({ id: `c-${i}`, reinforcedCount: i }),
    );
    const result = selectRelevantCorrections(corrections, "any message");
    expect(result).toHaveLength(MAX_INJECTED_CORRECTIONS);
  });

  it("ties broken by reinforcedCount desc", () => {
    const a = makeCorrection({
      id: "a",
      domain: "git",
      trigger: "git push",
      mistake: "force pushed without warning",
      reinforcedCount: 1,
    });
    const b = makeCorrection({
      id: "b",
      domain: "git",
      trigger: "git push",
      mistake: "force pushed without warning",
      reinforcedCount: 5,
    });
    const result = selectRelevantCorrections([a, b], "git push warning", 1);
    expect(result[0].id).toBe("b");
  });

  it("returns all sorted when count equals limit", () => {
    const low = makeCorrection({ id: "low", reinforcedCount: 0 });
    const high = makeCorrection({ id: "high", reinforcedCount: 5 });
    const result = selectRelevantCorrections([low, high], "any message", 2);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["high", "low"]);
  });
});
