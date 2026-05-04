import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { FragmentStore } from "./fragment-store.js";
import type { Fragment } from "./fragment-types.js";
import { FRAGMENT_TTL_MS } from "./fragment-types.js";

function makeFragment(overrides: Partial<Fragment> = {}): Fragment {
  const result: Fragment = {
    id: randomUUID(),
    userId: "test-user",
    createdAt: Date.now(),
    expiresAt: Date.now() + FRAGMENT_TTL_MS,
    kind: "assumption",
    evidence: "User assumes X implies Y",
    domains: ["typescript"],
    structuralTag: "assumes-correlation-is-causation",
    strength: 0.5,
    ...overrides,
  };
  result.initialStrength = result.initialStrength ?? result.strength;
  return result;
}

describe("FragmentStore", () => {
  let tempDir: string;
  let store: FragmentStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "fragment-test-"));
    store = new FragmentStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── Persistence ───

  describe("persistence", () => {
    it("save + load round-trip preserves all Fragment fields", async () => {
      const fragment = makeFragment();
      await store.save("test-user", [fragment]);
      const loaded = await store.load("test-user");
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe(fragment.id);
      expect(loaded[0].userId).toBe(fragment.userId);
      expect(loaded[0].kind).toBe(fragment.kind);
      expect(loaded[0].evidence).toBe(fragment.evidence);
      expect(loaded[0].domains).toEqual(fragment.domains);
      expect(loaded[0].structuralTag).toBe(fragment.structuralTag);
    });

    it("load returns empty array for non-existent user", async () => {
      const loaded = await store.load("no-such-user");
      expect(loaded).toEqual([]);
    });

    it("load returns empty array for malformed JSON file", async () => {
      const dir = join(tempDir, "cognitive/fragments");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "bad-user.json"), "not valid json{{{");
      const loaded = await store.load("bad-user");
      expect(loaded).toEqual([]);
    });

    it("load returns empty array for wrong version file", async () => {
      const dir = join(tempDir, "cognitive/fragments");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "wrong-version.json"), JSON.stringify({ version: 2, fragments: [] }));
      const loaded = await store.load("wrong-version");
      expect(loaded).toEqual([]);
    });
  });

  // ─── TTL ───

  describe("TTL", () => {
    it("prunes fragments past 14-day TTL on load", async () => {
      const expired = makeFragment({
        createdAt: Date.now() - FRAGMENT_TTL_MS - 1000,
        expiresAt: Date.now() - 1000,
      });
      await store.save("test-user", [expired]);
      const loaded = await store.load("test-user");
      expect(loaded).toHaveLength(0);
    });

    it("keeps fragments within TTL on load", async () => {
      const fresh = makeFragment();
      await store.save("test-user", [fresh]);
      const loaded = await store.load("test-user");
      expect(loaded).toHaveLength(1);
    });
  });

  // ─── Decay ───

  describe("decay", () => {
    it("applies strength decay based on age", async () => {
      const halfAge = FRAGMENT_TTL_MS / 2;
      const fragment = makeFragment({
        createdAt: Date.now() - halfAge,
        strength: 1.0,
      });
      await store.save("test-user", [fragment]);
      const loaded = await store.load("test-user");
      expect(loaded[0].strength).toBeCloseTo(0.5, 1);
    });

    it("floors decayed strength at 0.0", async () => {
      const fragment = makeFragment({
        createdAt: Date.now() - FRAGMENT_TTL_MS + 1,
        strength: 0.0001,
      });
      await store.save("test-user", [fragment]);
      const loaded = await store.load("test-user");
      expect(loaded[0].strength).toBeGreaterThanOrEqual(0);
    });

    it("does not decay freshly created fragments", async () => {
      const fragment = makeFragment({ strength: 0.8 });
      await store.save("test-user", [fragment]);
      const loaded = await store.load("test-user");
      expect(loaded[0].strength).toBeCloseTo(0.8, 2);
    });
  });

  // ─── Dedup ───

  describe("dedup", () => {
    it("deduplicates by structuralTag — keeps higher strength", async () => {
      const existing = makeFragment({ structuralTag: "same-tag", strength: 0.3, evidence: "short" });
      await store.addFragment("test-user", existing);

      const incoming = makeFragment({ structuralTag: "same-tag", strength: 0.7, evidence: "longer evidence here" });
      const result = await store.addFragment("test-user", incoming);

      expect(result).toHaveLength(1);
      expect(result[0].strength).toBe(0.7);
    });

    it("adds fragment with new structuralTag", async () => {
      const first = makeFragment({ structuralTag: "tag-a" });
      await store.addFragment("test-user", first);

      const second = makeFragment({ structuralTag: "tag-b" });
      const result = await store.addFragment("test-user", second);

      expect(result).toHaveLength(2);
    });
  });

  // ─── Clustering ───

  describe("clustering", () => {
    function makeClusterableFragments(): Fragment[] {
      const sharedDomain = "typescript";
      return [
        makeFragment({ id: "f1", domains: [sharedDomain, "react"], strength: 0.6, kind: "assumption" }),
        makeFragment({ id: "f2", domains: [sharedDomain, "nodejs"], strength: 0.7, kind: "knowledge_gap" }),
        makeFragment({ id: "f3", domains: [sharedDomain, "testing"], strength: 0.5, kind: "methodological_habit" }),
      ];
    }

    it("groups fragments sharing ≥1 domain", async () => {
      await store.save("test-user", makeClusterableFragments());
      const clusters = await store.findClusters("test-user");
      expect(clusters).toHaveLength(1);
      expect(clusters[0].fragmentIds).toHaveLength(3);
    });

    it("merges overlapping domain groups transitively", async () => {
      const fragments = [
        makeFragment({ id: "f1", domains: ["a", "b"], strength: 0.6 }),
        makeFragment({ id: "f2", domains: ["b", "c"], strength: 0.6 }),
        makeFragment({ id: "f3", domains: ["c", "d"], strength: 0.6 }),
      ];
      await store.save("test-user", fragments);
      const clusters = await store.findClusters("test-user");
      expect(clusters).toHaveLength(1);
      expect(clusters[0].domains).toContain("a");
      expect(clusters[0].domains).toContain("d");
    });

    it("pre-filter rejects cluster with <2 fragments", async () => {
      const fragments = [
        makeFragment({ domains: ["a", "b"], strength: 0.8 }),
      ];
      await store.save("test-user", fragments);
      const clusters = await store.findClusters("test-user");
      expect(clusters).toHaveLength(0);
    });

    it("pre-filter rejects cluster with avg strength < 0.3", async () => {
      const fragments = [
        makeFragment({ domains: ["a", "b"], strength: 0.1 }),
        makeFragment({ domains: ["a", "c"], strength: 0.2 }),
        makeFragment({ domains: ["a", "d"], strength: 0.1 }),
      ];
      await store.save("test-user", fragments);
      const clusters = await store.findClusters("test-user");
      expect(clusters).toHaveLength(0);
    });

    it("pre-filter accepts cluster with ≥2 domains and ≥3 fragments", async () => {
      await store.save("test-user", makeClusterableFragments());
      const clusters = await store.findClusters("test-user");
      expect(clusters).toHaveLength(1);
      expect(clusters[0].domains.length).toBeGreaterThanOrEqual(2);
      expect(clusters[0].fragmentIds.length).toBeGreaterThanOrEqual(3);
    });

    it("sorts clusters by strength × size descending", async () => {
      const groupA = [
        makeFragment({ domains: ["x", "a1"], strength: 0.9, kind: "assumption" }),
        makeFragment({ domains: ["x", "a2"], strength: 0.9, kind: "assumption" }),
        makeFragment({ domains: ["x", "a3"], strength: 0.9, kind: "assumption" }),
      ];
      const groupB = [
        makeFragment({ domains: ["y", "b1"], strength: 0.5, kind: "knowledge_gap" }),
        makeFragment({ domains: ["y", "b2"], strength: 0.5, kind: "knowledge_gap" }),
        makeFragment({ domains: ["y", "b3"], strength: 0.5, kind: "knowledge_gap" }),
      ];
      await store.save("test-user", [...groupA, ...groupB]);
      const clusters = await store.findClusters("test-user");
      expect(clusters).toHaveLength(2);
      const scoreA = clusters[0].averageStrength * clusters[0].fragmentIds.length;
      const scoreB = clusters[1].averageStrength * clusters[1].fragmentIds.length;
      expect(scoreA).toBeGreaterThanOrEqual(scoreB);
    });

    it("returns empty clusters for user with no fragments", async () => {
      const clusters = await store.findClusters("empty-user");
      expect(clusters).toEqual([]);
    });
  });

  // ─── Domain-aware dedup ───

  describe("domain-aware dedup", () => {
    it("addFragment does not dedupe fragments with same tag but different domains", async () => {
      await store.addFragment("test-user", makeFragment({ structuralTag: "tag-a", domains: ["A"] }));
      const result = await store.addFragment("test-user", makeFragment({ structuralTag: "tag-a", domains: ["B"] }));
      expect(result).toHaveLength(2);
    });

    it("addFragment dedupes fragments with same tag AND same domains", async () => {
      await store.addFragment("test-user", makeFragment({ structuralTag: "tag-a", domains: ["A", "B"], strength: 0.7 }));
      const result = await store.addFragment("test-user", makeFragment({ structuralTag: "tag-a", domains: ["B", "A"], strength: 0.3 }));
      expect(result).toHaveLength(1);
      expect(result[0].strength).toBeCloseTo(0.7, 1);
    });

    it("addFragment dedupes by keeping stronger fragment", async () => {
      await store.addFragment("test-user", makeFragment({ structuralTag: "tag-x", domains: ["X"], strength: 0.3 }));
      const result = await store.addFragment("test-user", makeFragment({ structuralTag: "tag-x", domains: ["X"], strength: 0.7 }));
      expect(result).toHaveLength(1);
      expect(result[0].strength).toBeCloseTo(0.7, 1);
    });
  });

  // ─── Relaxed clustering thresholds ───

  describe("relaxed clustering", () => {
    it("findClusters forms clusters with 2 fragments", async () => {
      const fragments = [
        makeFragment({ domains: ["A", "B"], strength: 0.5 }),
        makeFragment({ domains: ["A", "C"], strength: 0.5 }),
      ];
      await store.save("test-user", fragments);
      const clusters = await store.findClusters("test-user");
      expect(clusters.length).toBeGreaterThanOrEqual(1);
    });

    it("findClusters forms clusters with avg strength 0.3", async () => {
      const fragments = [
        makeFragment({ domains: ["A", "B"], strength: 0.35 }),
        makeFragment({ domains: ["A", "C"], strength: 0.35 }),
        makeFragment({ domains: ["A", "D"], strength: 0.35 }),
      ];
      await store.save("test-user", fragments);
      const clusters = await store.findClusters("test-user");
      expect(clusters.length).toBeGreaterThanOrEqual(1);
    });

    it("findClusters rejects cluster with avg strength below 0.15", async () => {
      const fragments = [
        makeFragment({ domains: ["A", "B"], strength: 0.1 }),
        makeFragment({ domains: ["A", "C"], strength: 0.1 }),
        makeFragment({ domains: ["A", "D"], strength: 0.1 }),
      ];
      await store.save("test-user", fragments);
      const clusters = await store.findClusters("test-user");
      expect(clusters).toHaveLength(0);
    });
  });

  // ─── Cache ───

  describe("cache", () => {
    it("returns cached fragments within cache TTL", async () => {
      vi.useFakeTimers();
      try {
        const fragment = makeFragment();
        await store.save("test-user", [fragment]);

        // Advance time but stay within cache TTL
        vi.advanceTimersByTime(30_000);
        const loaded = await store.load("test-user");
        expect(loaded).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── Atomic writes ───

  describe("atomic writes", () => {
    it("file is valid JSON after save", async () => {
      const fragment = makeFragment();
      await store.save("test-user", [fragment]);
      const raw = readFileSync(join(tempDir, "cognitive/fragments/test-user.json"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.version).toBe(1);
      expect(parsed.fragments).toHaveLength(1);
    });
  });

  // ─── Edge cases ───

  describe("edge cases", () => {
    it("handles empty evidence field", async () => {
      const fragment = makeFragment({ evidence: "" });
      await store.save("test-user", [fragment]);
      const loaded = await store.load("test-user");
      expect(loaded[0].evidence).toBe("");
    });

    it("handles fragment with empty domains array", async () => {
      const fragment = makeFragment({ domains: [] });
      await store.save("test-user", [fragment]);
      const loaded = await store.load("test-user");
      expect(loaded[0].domains).toEqual([]);
    });
  });

  // ─── removeFragment ───

  describe("removeFragment", () => {
    it("removes a fragment by id", async () => {
      const f1 = makeFragment({ id: "to-remove" });
      const f2 = makeFragment({ id: "to-keep", structuralTag: "different-tag" });
      await store.save("test-user", [f1, f2]);
      await store.removeFragment("test-user", "to-remove");
      const loaded = await store.load("test-user");
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("to-keep");
    });
  });

  // ─── touchFragment ───

  describe("touchFragment", () => {
    it("bumps strength by 0.1 capped at 1.0", async () => {
      const fragment = makeFragment({ id: "touch-me", strength: 0.5 });
      await store.save("test-user", [fragment]);
      await store.touchFragment("test-user", "touch-me");
      const loaded = await store.load("test-user");
      expect(loaded[0].strength).toBeCloseTo(0.6, 2);
    });

    it("caps strength at 1.0", async () => {
      const fragment = makeFragment({ id: "max-str", strength: 0.95 });
      await store.save("test-user", [fragment]);
      await store.touchFragment("test-user", "max-str");
      const loaded = await store.load("test-user");
      expect(loaded[0].strength).toBeCloseTo(1.0, 1);
    });
  });

  // ─── Cascading decay regression ───

  describe("cascading decay prevention", () => {
    it("strength does not compound on repeated save/load cycles", async () => {
      vi.useFakeTimers();
      try {
        const threeDays = 3 * 24 * 60 * 60 * 1000;
        const fiveDays = 5 * 24 * 60 * 60 * 1000;
        const now = Date.now();

        const fragment = makeFragment({
          id: "decay-test",
          createdAt: now,
          expiresAt: now + FRAGMENT_TTL_MS,
          strength: 0.8,
          initialStrength: 0.8,
        });

        await store.save("test-user", [fragment]);

        vi.advanceTimersByTime(threeDays);
        const loaded3d = await store.load("test-user");
        await store.save("test-user", loaded3d);

        vi.advanceTimersByTime(fiveDays - threeDays);
        const loaded5d = await store.load("test-user");

        // Correct: 0.8 * 0.5^(5/7) ≈ 0.488
        // Buggy (compound): (0.8 * 0.5^(3/7)) * 0.5^(5/7) ≈ 0.363
        const expectedAt5d = 0.8 * Math.pow(0.5, fiveDays / (7 * 24 * 60 * 60 * 1000));
        expect(loaded5d[0].strength).toBeCloseTo(expectedAt5d, 3);
        expect(loaded5d[0].strength).toBeGreaterThan(0.45);
      } finally {
        vi.useRealTimers();
      }
    });

    it("initialStrength is preserved across load/save cycles", async () => {
      vi.useFakeTimers();
      try {
        const now = Date.now();
        const fragment = makeFragment({
          createdAt: now,
          expiresAt: now + FRAGMENT_TTL_MS,
          strength: 0.8,
          initialStrength: 0.8,
        });

        await store.save("test-user", [fragment]);
        vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000);
        const loaded = await store.load("test-user");
        await store.save("test-user", loaded);

        const raw = readFileSync(join(tempDir, "cognitive/fragments/test-user.json"), "utf-8");
        const parsed = JSON.parse(raw);
        expect(parsed.fragments[0].initialStrength).toBe(0.8);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── Clustering pre-filter ───

  describe("clustering pre-filter", () => {
    it("findClusters excludes fragments below CLUSTER_MIN_STRENGTH from clusters", async () => {
      const fragments = [
        makeFragment({ id: "strong1", domains: ["A", "B"], strength: 0.5, initialStrength: 0.5 }),
        makeFragment({ id: "strong2", domains: ["A", "C"], strength: 0.6, initialStrength: 0.6 }),
        makeFragment({ id: "weak1", domains: ["A", "D"], strength: 0.03, initialStrength: 0.03 }),
        makeFragment({ id: "weak2", domains: ["A", "E"], strength: 0.01, initialStrength: 0.01 }),
      ];
      await store.save("test-user", fragments);
      const clusters = await store.findClusters("test-user");
      expect(clusters).toHaveLength(1);
      expect(clusters[0].fragmentIds).toHaveLength(2);
      expect(clusters[0].fragmentIds).not.toContain("weak1");
      expect(clusters[0].fragmentIds).not.toContain("weak2");
    });

    it("findClusters returns empty when all fragments are sub-threshold", async () => {
      const fragments = [
        makeFragment({ domains: ["A", "B"], strength: 0.03 }),
        makeFragment({ domains: ["A", "C"], strength: 0.04 }),
      ];
      await store.save("test-user", fragments);
      const clusters = await store.findClusters("test-user");
      expect(clusters).toHaveLength(0);
    });
  });
});
