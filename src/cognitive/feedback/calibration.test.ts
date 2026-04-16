import { describe, it, expect } from "vitest";
import {
  recordCalibration,
  computeCalibrationSlope,
  applyCalibrationCorrection,
  getCalibrationStats,
} from "./calibration.js";
import type { CalibrationRecord } from "../types.js";

function makeRecords(
  count: number,
  predicted: number,
  outcome: CalibrationRecord["actualOutcome"],
  startId = 0,
): CalibrationRecord[] {
  return Array.from({ length: count }, (_, i) =>
    recordCalibration(`insight-${startId + i}`, predicted, outcome, 1000 + i),
  );
}

function makeMixedRecords(
  entries: Array<{ predicted: number; outcome: CalibrationRecord["actualOutcome"] }>,
): CalibrationRecord[] {
  return entries.map((e, i) =>
    recordCalibration(`insight-${i}`, e.predicted, e.outcome, 1000 + i),
  );
}

describe("recordCalibration", () => {
  it("creates a correct record with explicit timestamp", () => {
    const record = recordCalibration("insight-1", 0.75, "positive", 9999);

    expect(record).toEqual({
      insightId: "insight-1",
      predictedPAccept: 0.75,
      actualOutcome: "positive",
      timestamp: 9999,
    });
  });

  it("uses Date.now() when timestamp is omitted", () => {
    const before = Date.now();
    const record = recordCalibration("insight-2", 0.5, "negative");
    const after = Date.now();

    expect(record.timestamp).toBeGreaterThanOrEqual(before);
    expect(record.timestamp).toBeLessThanOrEqual(after);
  });

  it("preserves all outcome types", () => {
    const outcomes: Array<CalibrationRecord["actualOutcome"]> = [
      "positive",
      "negative",
      "neutral",
      "engaged",
      "no_response",
    ];

    for (const outcome of outcomes) {
      const record = recordCalibration("x", 0.5, outcome, 0);
      expect(record.actualOutcome).toBe(outcome);
    }
  });
});

describe("computeCalibrationSlope", () => {
  it("returns 1.0 when fewer than 10 records", () => {
    const history = makeRecords(9, 0.8, "positive");
    expect(computeCalibrationSlope(history)).toBe(1.0);
  });

  it("returns 1.0 with empty history", () => {
    expect(computeCalibrationSlope([])).toBe(1.0);
  });

  it("returns 1.0 with perfect predictions (predicted=0.8, all positive)", () => {
    const history = makeRecords(20, 0.8, "positive");
    // Σ(0.8×1) / Σ(0.8²) = 20×0.8 / 20×0.64 = 16/12.8 = 1.25... wait
    // Actually: slope = 20 * (0.8 * 1) / (20 * 0.64) = 16 / 12.8 = 1.25
    // For slope=1.0, predicted needs to equal the "perfect" prediction.
    // With all actual=1: slope = Σ(p)/Σ(p²) = np / np² = 1/p
    // So for p=0.8, slope = 1/0.8 = 1.25
    // For p=1.0, slope = 1/1.0 = 1.0
    const perfectHistory = makeRecords(20, 1.0, "positive");
    expect(computeCalibrationSlope(perfectHistory)).toBeCloseTo(1.0, 6);
  });

  it("returns < 1 when overconfident (predicted=0.9, all negative)", () => {
    const history = makeRecords(15, 0.9, "negative");
    const slope = computeCalibrationSlope(history);
    expect(slope).toBeLessThan(1);
    expect(slope).toBe(SLOPE_MIN);
  });

  it("returns > 1 when underconfident (predicted=0.3, all positive)", () => {
    const history = makeRecords(15, 0.3, "positive");
    const slope = computeCalibrationSlope(history);
    expect(slope).toBeGreaterThan(1);
  });

  it("uses at most 50 records", () => {
    const first50 = makeRecords(50, 0.9, "positive", 0);
    const next50 = makeRecords(50, 0.1, "negative", 50);
    const fullHistory = [...first50, ...next50];

    const slope = computeCalibrationSlope(fullHistory);
    const expectedSlope = clampSlope(0.0 / (50 * 0.01));
    expect(slope).toBeCloseTo(expectedSlope, 6);
  });

  it("clamps slope to [0.3, 2.0]", () => {
    const extremelyOverconfident = makeRecords(15, 0.99, "negative");
    const extremelyUnderconfident = makeRecords(15, 0.01, "positive");

    expect(computeCalibrationSlope(extremelyOverconfident)).toBe(0.3);
    expect(computeCalibrationSlope(extremelyUnderconfident)).toBe(2.0);
  });

  it("returns 1.0 when all predicted values are 0", () => {
    const history = makeRecords(15, 0, "positive");
    expect(computeCalibrationSlope(history)).toBe(1.0);
  });

  it("handles mixed outcomes correctly", () => {
    const history = makeMixedRecords([
      { predicted: 0.8, outcome: "positive" },
      { predicted: 0.8, outcome: "negative" },
      { predicted: 0.8, outcome: "engaged" },
      { predicted: 0.8, outcome: "neutral" },
      { predicted: 0.8, outcome: "no_response" },
      { predicted: 0.8, outcome: "positive" },
      { predicted: 0.8, outcome: "negative" },
      { predicted: 0.8, outcome: "positive" },
      { predicted: 0.8, outcome: "engaged" },
      { predicted: 0.8, outcome: "positive" },
    ]);
    // actual positive: positive, engaged, positive, positive, engaged, positive = 6
    // slope = 10 * (0.8 * 0.6) / (10 * 0.64) = 4.8 / 6.4 = 0.75
    const slope = computeCalibrationSlope(history);
    expect(slope).toBeCloseTo(0.75, 6);
  });
});

describe("applyCalibrationCorrection", () => {
  it("clamps result to [0, 1]", () => {
    expect(applyCalibrationCorrection(0.5, 3.0)).toBe(1);
    expect(applyCalibrationCorrection(0.5, -1.0)).toBe(0);
  });

  it("with slope=1 returns same value", () => {
    expect(applyCalibrationCorrection(0.6, 1.0)).toBeCloseTo(0.6, 10);
    expect(applyCalibrationCorrection(0.0, 1.0)).toBe(0);
    expect(applyCalibrationCorrection(1.0, 1.0)).toBeCloseTo(1.0, 10);
  });

  it("scales pAccept by slope", () => {
    expect(applyCalibrationCorrection(0.5, 0.6)).toBeCloseTo(0.3, 10);
    expect(applyCalibrationCorrection(0.4, 1.5)).toBeCloseTo(0.6, 10);
  });

  it("handles edge cases", () => {
    expect(applyCalibrationCorrection(0, 2.0)).toBe(0);
    expect(applyCalibrationCorrection(1, 0.5)).toBeCloseTo(0.5, 10);
  });
});

describe("getCalibrationStats", () => {
  it("returns correct metadata for empty history", () => {
    const stats = getCalibrationStats([]);
    expect(stats.slope).toBe(1.0);
    expect(stats.recordCount).toBe(0);
    expect(stats.isReliable).toBe(false);
  });

  it("returns correct metadata for reliable history", () => {
    const history = makeRecords(15, 0.8, "positive");
    const stats = getCalibrationStats(history);
    expect(stats.slope).toBeGreaterThan(0);
    expect(stats.recordCount).toBe(15);
    expect(stats.isReliable).toBe(true);
  });

  it("isReliable is false below 10 records", () => {
    const history = makeRecords(9, 0.8, "positive");
    const stats = getCalibrationStats(history);
    expect(stats.isReliable).toBe(false);
    expect(stats.recordCount).toBe(9);
  });
});

const SLOPE_MIN = 0.3;
const SLOPE_MAX = 2.0;
function clampSlope(raw: number): number {
  return Math.max(SLOPE_MIN, Math.min(SLOPE_MAX, raw));
}
