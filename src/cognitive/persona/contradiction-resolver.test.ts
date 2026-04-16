import { describe, it, expect } from "vitest";
import { detectContradictions, pruneContradictionLog } from "./contradiction-resolver.js";
import type { ConfidenceValue, ContradictionRecord } from "../types.js";
import type { ExtractedAttribute } from "./types.js";

const NOW = 1_700_000_000_000;

function makeTrait(value: string, confidence: number, source: "explicit" | "inferred" | "observed" = "inferred"): ConfidenceValue {
  return { value, confidence, evidenceCount: 3, lastUpdated: NOW, source };
}

function makeAttr(field: string, value: string, confidence: number, source: "explicit" | "inferred" | "observed" = "inferred"): ExtractedAttribute {
  return { field, value, confidence, source, evidence: "test" };
}

describe("detectContradictions", () => {
  it("returns no records when values match", () => {
    const existing: Record<string, ConfidenceValue> = {
      role: makeTrait("engineer", 0.8),
    };
    const incoming = [makeAttr("identity.coreTraits.role", "engineer", 0.7)];

    const { records, resolvedTraits } = detectContradictions(existing, incoming, NOW);
    expect(records).toHaveLength(0);
    expect(Object.keys(resolvedTraits)).toHaveLength(0);
  });

  it("creates a record when values differ", () => {
    const existing: Record<string, ConfidenceValue> = {
      role: makeTrait("engineer", 0.5),
    };
    const incoming = [makeAttr("identity.coreTraits.role", "manager", 0.5)];

    const { records, resolvedTraits } = detectContradictions(existing, incoming, NOW);
    expect(records).toHaveLength(1);
    expect(records[0].oldValue).toBe("engineer");
    expect(records[0].newValue).toBe("manager");
    expect(resolvedTraits["role"]).toBeDefined();
  });

  it("resolves to resolved_new when new source is explicit and old is not", () => {
    const existing: Record<string, ConfidenceValue> = {
      role: makeTrait("engineer", 0.9, "inferred"),
    };
    const incoming = [makeAttr("identity.coreTraits.role", "manager", 0.5, "explicit")];

    const { records, resolvedTraits } = detectContradictions(existing, incoming, NOW);
    expect(records[0].resolution).toBe("resolved_new");
    expect(resolvedTraits["role"].value).toBe("manager");
    expect(resolvedTraits["role"].resolution).toBe("resolved_new");
  });

  it("resolves inferred-vs-inferred by confidence rules", () => {
    const existing: Record<string, ConfidenceValue> = {
      role: makeTrait("engineer", 0.5, "inferred"),
    };
    const incoming = [makeAttr("identity.coreTraits.role", "designer", 0.5, "inferred")];

    const { records } = detectContradictions(existing, incoming, NOW);
    expect(records[0].resolution).toBe("resolved_new");
  });

  it("resolves to resolved_old when old confidence exceeds new by > 0.3", () => {
    const existing: Record<string, ConfidenceValue> = {
      role: makeTrait("engineer", 0.9, "inferred"),
    };
    const incoming = [makeAttr("identity.coreTraits.role", "designer", 0.5, "inferred")];

    const { records, resolvedTraits } = detectContradictions(existing, incoming, NOW);
    expect(records[0].resolution).toBe("resolved_old");
    expect(resolvedTraits["role"].value).toBe("engineer");
  });

  it("resolves to resolved_new when new confidence exceeds old by > 0.3", () => {
    const existing: Record<string, ConfidenceValue> = {
      role: makeTrait("engineer", 0.4, "inferred"),
    };
    const incoming = [makeAttr("identity.coreTraits.role", "designer", 0.9, "inferred")];

    const { records, resolvedTraits } = detectContradictions(existing, incoming, NOW);
    expect(records[0].resolution).toBe("resolved_new");
    expect(resolvedTraits["role"].value).toBe("designer");
  });

  it("applies recency bias (resolved_new) when confidence gap is small", () => {
    const existing: Record<string, ConfidenceValue> = {
      role: makeTrait("engineer", 0.6, "inferred"),
    };
    const incoming = [makeAttr("identity.coreTraits.role", "designer", 0.7, "inferred")];

    const { records, resolvedTraits } = detectContradictions(existing, incoming, NOW);
    expect(records[0].resolution).toBe("resolved_new");
    expect(resolvedTraits["role"].value).toBe("designer");
  });

  it("detects multiple contradictions in a single batch", () => {
    const existing: Record<string, ConfidenceValue> = {
      role: makeTrait("engineer", 0.6),
      level: makeTrait("senior", 0.5),
    };
    const incoming = [
      makeAttr("identity.coreTraits.role", "designer", 0.9),
      makeAttr("identity.coreTraits.level", "junior", 0.9),
    ];

    const { records, resolvedTraits } = detectContradictions(existing, incoming, NOW);
    expect(records).toHaveLength(2);
    expect(Object.keys(resolvedTraits)).toHaveLength(2);
    expect(records[0].field).toBe("identity.coreTraits.role");
    expect(records[1].field).toBe("identity.coreTraits.level");
  });

  it("ignores non-coreTraits attributes", () => {
    const existing: Record<string, ConfidenceValue> = {
      role: makeTrait("engineer", 0.8),
    };
    const incoming = [
      makeAttr("identity.communicationStyle.formality", "casual", 0.9),
      makeAttr("domains.AI.depth", "5", 0.8),
    ];

    const { records, resolvedTraits } = detectContradictions(existing, incoming, NOW);
    expect(records).toHaveLength(0);
    expect(Object.keys(resolvedTraits)).toHaveLength(0);
  });
});

describe("pruneContradictionLog", () => {
  function makeRecord(field: string, idx: number): ContradictionRecord {
    return {
      field,
      oldValue: `old-${idx}`,
      newValue: `new-${idx}`,
      oldConfidence: 0.5,
      newConfidence: 0.5,
      oldSource: "inferred",
      newSource: "inferred",
      resolution: "resolved_new",
      resolvedAt: NOW + idx,
    };
  }

  it("keeps last N records when log exceeds maxSize", () => {
    const log: ContradictionRecord[] = Array.from({ length: 60 }, (_, i) => makeRecord("trait", i));

    const pruned = pruneContradictionLog(log, 50);
    expect(pruned).toHaveLength(50);
    expect(pruned[0].resolvedAt).toBe(NOW + 10);
    expect(pruned[49].resolvedAt).toBe(NOW + 59);
  });

  it("returns all records when count is under maxSize", () => {
    const log: ContradictionRecord[] = Array.from({ length: 30 }, (_, i) => makeRecord("trait", i));

    const pruned = pruneContradictionLog(log, 50);
    expect(pruned).toHaveLength(30);
    expect(pruned).toBe(log);
  });
});
