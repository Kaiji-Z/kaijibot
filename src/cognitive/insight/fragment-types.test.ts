import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeQualityVerdict,
  computeComposite,
  isFragmentExpired,
  createDefaultFragment,
  computeFragmentDecay,
  FRAGMENT_TTL_MS,
} from "./fragment-types.js";

describe("computeQualityVerdict", () => {
  it("returns 'deliver' at exactly 0.75", () => {
    expect(computeQualityVerdict(0.75)).toBe("deliver");
  });

  it("returns 'deliver' above 0.75", () => {
    expect(computeQualityVerdict(0.90)).toBe("deliver");
  });

  it("returns 'park' at exactly 0.60", () => {
    expect(computeQualityVerdict(0.60)).toBe("park");
  });

  it("returns 'park' between 0.60 and 0.75", () => {
    expect(computeQualityVerdict(0.68)).toBe("park");
  });

  it("returns 'discard' below 0.60", () => {
    expect(computeQualityVerdict(0.59)).toBe("discard");
  });

  it("returns 'discard' at 0.0", () => {
    expect(computeQualityVerdict(0)).toBe("discard");
  });
});

describe("computeComposite", () => {
  it("returns 1.0 when all pillars are 1.0", () => {
    const result = computeComposite({
      structuralNovelty: 1,
      actionability: 1,
      emotionalReadiness: 1,
      nonObviousness: 1,
    });
    expect(result).toBe(1);
  });

  it("returns 0.0 when all pillars are 0.0", () => {
    const result = computeComposite({
      structuralNovelty: 0,
      actionability: 0,
      emotionalReadiness: 0,
      nonObviousness: 0,
    });
    expect(result).toBe(0);
  });

  it("weights nonObviousness heaviest", () => {
    const onlyNovel = computeComposite({
      structuralNovelty: 1,
      actionability: 0,
      emotionalReadiness: 0,
      nonObviousness: 0,
    });
    const onlyNonObvious = computeComposite({
      structuralNovelty: 0,
      actionability: 0,
      emotionalReadiness: 0,
      nonObviousness: 1,
    });
    expect(onlyNonObvious).toBeGreaterThan(onlyNovel);
  });
});

describe("isFragmentExpired", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false for fresh fragment", () => {
    const now = Date.now();
    const fragment = { expiresAt: now + FRAGMENT_TTL_MS } as any;
    expect(isFragmentExpired(fragment, now)).toBe(false);
  });

  it("returns true past TTL", () => {
    const now = Date.now();
    const fragment = { expiresAt: now - 1 } as any;
    expect(isFragmentExpired(fragment, now)).toBe(true);
  });

  it("returns false exactly at TTL boundary", () => {
    const now = Date.now();
    const fragment = { expiresAt: now } as any;
    expect(isFragmentExpired(fragment, now)).toBe(false);
  });

  it("uses Date.now() when now is omitted", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const fragment = { expiresAt: now + 1000 } as any;
    vi.setSystemTime(now);
    expect(isFragmentExpired(fragment)).toBe(false);
    vi.setSystemTime(now + 1001);
    expect(isFragmentExpired(fragment)).toBe(true);
  });
});

describe("createDefaultFragment", () => {
  it("fills id, createdAt, expiresAt, strength", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const f = createDefaultFragment({
      userId: "u1",
      kind: "assumption",
      evidence: "test evidence",
      domains: ["ai"],
      structuralTag: "assumes-correlation",
    });

    expect(f.id).toBeTruthy();
    expect(f.createdAt).toBe(now);
    expect(f.expiresAt).toBe(now + FRAGMENT_TTL_MS);
    expect(f.strength).toBe(0.5);
    expect(f.userId).toBe("u1");
    expect(f.kind).toBe("assumption");

    vi.useRealTimers();
  });

  it("applies overrides", () => {
    const f = createDefaultFragment({
      userId: "u1",
      kind: "knowledge_gap",
      evidence: "short",
      domains: [],
      structuralTag: "tag",
      strength: 0.9,
    });
    expect(f.strength).toBe(0.9);
  });
});

describe("computeFragmentDecay", () => {
  const baseFragment = {
    id: "test",
    userId: "u1",
    kind: "assumption" as const,
    evidence: "test",
    domains: [],
    structuralTag: "tag",
    strength: 0.8,
    createdAt: 0,
    expiresAt: FRAGMENT_TTL_MS,
  };

  it("returns original strength at creation time", () => {
    expect(computeFragmentDecay(baseFragment, 0)).toBeCloseTo(0.8);
  });

  it("returns 0 after TTL", () => {
    expect(computeFragmentDecay(baseFragment, FRAGMENT_TTL_MS)).toBe(0);
  });

  it("returns half strength at 7 days (half TTL)", () => {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const result = computeFragmentDecay(baseFragment, sevenDays);
    expect(result).toBeCloseTo(0.4, 5);
  });

  it("floors at 0", () => {
    expect(computeFragmentDecay(baseFragment, FRAGMENT_TTL_MS + 1000)).toBe(0);
  });
});
