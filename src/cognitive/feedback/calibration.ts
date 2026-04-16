import type { CalibrationRecord } from "../types.js";

// ── Constants ─────────────────────────────────────────────────────────

const MIN_RECORDS_FOR_RELIABLE = 10;
const MAX_HISTORY_WINDOW = 50;
const SLOPE_MIN = 0.3;
const SLOPE_MAX = 2.0;

// ── Pure functions ────────────────────────────────────────────────────

/** Outcome types that count as "actual positive" for calibration. */
const POSITIVE_OUTCOMES: ReadonlySet<CalibrationRecord["actualOutcome"]> = new Set([
  "positive",
  "engaged",
]);

/**
 * Create a calibration record. Pure function — builds the object without I/O.
 */
export function recordCalibration(
  insightId: string,
  predictedPAccept: number,
  actualOutcome: CalibrationRecord["actualOutcome"],
  nowMs?: number,
): CalibrationRecord {
  return {
    insightId,
    predictedPAccept,
    actualOutcome,
    timestamp: nowMs ?? Date.now(),
  };
}

/**
 * Compute the calibration slope from history using simplified linear regression.
 *
 * slope = Σ(predicted × actual) / Σ(predicted²)
 *
 * - slope < 1 → system is overconfident (predicted high, actual low)
 * - slope > 1 → system is underconfident (predicted low, actual high)
 * - slope = 1 → perfectly calibrated
 *
 * Uses the last 50 records. Returns 1.0 (no correction) when < 10 records.
 */
export function computeCalibrationSlope(history: CalibrationRecord[]): number {
  if (history.length < MIN_RECORDS_FOR_RELIABLE) {
    return 1.0;
  }

  const window = history.slice(-MAX_HISTORY_WINDOW);

  let sumPredictedActual = 0;
  let sumPredictedSq = 0;

  for (const record of window) {
    const actual = POSITIVE_OUTCOMES.has(record.actualOutcome) ? 1 : 0;
    sumPredictedActual += record.predictedPAccept * actual;
    sumPredictedSq += record.predictedPAccept * record.predictedPAccept;
  }

  if (sumPredictedSq === 0) {
    return 1.0;
  }

  const slope = sumPredictedActual / sumPredictedSq;
  return Math.max(SLOPE_MIN, Math.min(SLOPE_MAX, slope));
}

/**
 * Apply calibration correction to a raw pAccept value.
 * adjustedPAccept = pAccept * slope, clamped to [0, 1].
 */
export function applyCalibrationCorrection(pAccept: number, slope: number): number {
  return Math.max(0, Math.min(1, pAccept * slope));
}

/**
 * Return calibration statistics for debugging / display.
 */
export function getCalibrationStats(history: CalibrationRecord[]): {
  slope: number;
  recordCount: number;
  isReliable: boolean;
} {
  return {
    slope: computeCalibrationSlope(history),
    recordCount: history.length,
    isReliable: history.length >= MIN_RECORDS_FOR_RELIABLE,
  };
}
