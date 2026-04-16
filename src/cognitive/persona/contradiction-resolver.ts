import type { ContradictionRecord, ContradictionStatus, ConfidenceValue } from "../types.js";
import type { ExtractedAttribute } from "./types.js";

export type ResolvedTrait = {
  value: string;
  resolution: ContradictionStatus;
};

export type DetectContradictionsResult = {
  records: ContradictionRecord[];
  resolvedTraits: Record<string, ResolvedTrait>;
};

export function detectContradictions(
  existingTraits: Record<string, ConfidenceValue>,
  incomingAttributes: ExtractedAttribute[],
  nowMs: number,
): DetectContradictionsResult {
  const records: ContradictionRecord[] = [];
  const resolvedTraits: Record<string, ResolvedTrait> = {};

  for (const attr of incomingAttributes) {
    if (!attr.field.startsWith("identity.coreTraits.")) continue;

    const traitName = attr.field.replace("identity.coreTraits.", "");
    const existing = existingTraits[traitName];
    if (!existing) continue;
    if (existing.value === attr.value) continue;

    const resolution = resolveContradiction(
      existing.confidence,
      attr.confidence,
      existing.source,
      attr.source,
    );

    records.push({
      field: attr.field,
      oldValue: existing.value,
      newValue: attr.value,
      oldConfidence: existing.confidence,
      newConfidence: attr.confidence,
      oldSource: existing.source,
      newSource: attr.source,
      resolution,
      resolvedAt: nowMs,
    });

    const winnerValue = resolution === "resolved_old" ? existing.value : attr.value;
    resolvedTraits[traitName] = { value: winnerValue, resolution };
  }

  return { records, resolvedTraits };
}

export function pruneContradictionLog(
  log: ContradictionRecord[],
  maxSize: number = 50,
): ContradictionRecord[] {
  if (log.length <= maxSize) return log;
  return log.slice(log.length - maxSize);
}

/**
 * Ordered resolution rules (first match wins):
 * 1. explicit incoming overrides non-explicit existing → resolved_new
 * 2. old confidence exceeds new by > 0.3              → resolved_old
 * 3. new confidence exceeds old by > 0.3              → resolved_new
 * 4. otherwise (recency bias)                          → resolved_new
 */
function resolveContradiction(
  oldConfidence: number,
  newConfidence: number,
  oldSource: "explicit" | "inferred" | "observed",
  newSource: "explicit" | "inferred" | "observed",
): ContradictionStatus {
  if (newSource === "explicit" && oldSource !== "explicit") {
    return "resolved_new";
  }

  const diff = oldConfidence - newConfidence;

  if (diff > 0.3) return "resolved_old";
  return "resolved_new";
}
