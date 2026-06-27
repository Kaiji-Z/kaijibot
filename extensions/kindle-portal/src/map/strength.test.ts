import { describe, expect, it } from "vitest";
import { computeStrength } from "./strength.js";
import type { PersonaDomainNode } from "../types.js";

describe("computeStrength", () => {
  it("stable + depth 5 + rec 10 → ~1.0", () => {
    const node: PersonaDomainNode = {
      phase: "stable",
      depth: 5,
      recurrence: 10,
    };
    // depthNorm=1*0.5 + recNorm=1*0.3 + phaseWeight=1*0.2 = 1.0
    expect(computeStrength(node)).toBeCloseTo(1.0, 5);
  });

  it("emergent + depth 1 + rec 1 → mid (formula yields ~0.25)", () => {
    // NOTE: spec prose said "~0.5" but the explicit formula gives 0.25.
    // We pin to the formula since it is unambiguous.
    const node: PersonaDomainNode = {
      phase: "emergent",
      depth: 1,
      recurrence: 1,
    };
    // depthNorm=0.2*0.5=0.1 + recNorm=0.1*0.3=0.03 + phaseWeight=0.6*0.2=0.12 = 0.25
    expect(computeStrength(node)).toBeCloseTo(0.25, 5);
  });

  it("dormant + depth 3 + rec 2 → low (formula yields 0.38)", () => {
    // NOTE: spec prose said "<0.3" but the explicit formula gives 0.38.
    const node: PersonaDomainNode = {
      phase: "dormant",
      depth: 3,
      recurrence: 2,
    };
    // 0.6*0.5 + 0.2*0.3 + 0.1*0.2 = 0.30 + 0.06 + 0.02 = 0.38
    expect(computeStrength(node)).toBeCloseTo(0.38, 5);
    expect(computeStrength(node)).toBeLessThan(0.5);
  });

  it("declining + depth 3 + rec 5 → mid-low (~0.51)", () => {
    const node: PersonaDomainNode = {
      phase: "declining",
      depth: 3,
      recurrence: 5,
    };
    // 0.6*0.5 + 0.5*0.3 + 0.3*0.2 = 0.30 + 0.15 + 0.06 = 0.51
    expect(computeStrength(node)).toBeCloseTo(0.51, 5);
  });

  it("monotonic in depth (other params fixed)", () => {
    const base: PersonaDomainNode = { phase: "stable", recurrence: 5 };
    const shallow = computeStrength({ ...base, depth: 0 });
    const deep = computeStrength({ ...base, depth: 5 });
    expect(deep).toBeGreaterThan(shallow);
  });

  it("monotonic in recurrence (other params fixed)", () => {
    const base: PersonaDomainNode = { phase: "stable", depth: 3 };
    const low = computeStrength({ ...base, recurrence: 0 });
    const high = computeStrength({ ...base, recurrence: 10 });
    expect(high).toBeGreaterThan(low);
  });

  it("phase ranking: stable == revived > emergent > declining > dormant", () => {
    const mk = (phase: PersonaDomainNode["phase"]): PersonaDomainNode => ({
      phase,
      depth: 3,
      recurrence: 5,
    });
    const stable = computeStrength(mk("stable"));
    const revived = computeStrength(mk("revived"));
    const emergent = computeStrength(mk("emergent"));
    const declining = computeStrength(mk("declining"));
    const dormant = computeStrength(mk("dormant"));
    // stable & revived share weight 1.0
    expect(stable).toBe(revived);
    expect(stable).toBeGreaterThan(emergent);
    expect(emergent).toBeGreaterThan(declining);
    expect(declining).toBeGreaterThan(dormant);
  });

  it("clamps to [0, 1]", () => {
    const extreme: PersonaDomainNode = {
      phase: "stable",
      depth: 9999,
      recurrence: 9999,
    };
    const s = computeStrength(extreme);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("handles undefined fields gracefully", () => {
    const node: PersonaDomainNode = {};
    // Defaults: phase="stable"(1), depth=0(0), rec=0(0) → 0 + 0 + 0.2 = 0.2
    const s = computeStrength(node);
    expect(typeof s).toBe("number");
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeCloseTo(0.2, 5);
  });

  it("falls back to insights.length when recurrence undefined", () => {
    const withInsights: PersonaDomainNode = {
      phase: "stable",
      depth: 3,
      insights: [
        { category: "domain_knowledge" },
        { category: "behavioral_pattern" },
        { category: "stated_preference" },
        { category: "goal_or_aspiration" },
        { category: "contextual_fact" },
      ],
    };
    const equivalent: PersonaDomainNode = {
      phase: "stable",
      depth: 3,
      recurrence: 5,
    };
    expect(computeStrength(withInsights)).toBeCloseTo(computeStrength(equivalent), 5);
  });
});
