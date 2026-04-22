import { describe, expect, it } from "vitest";
import { bm25RankToScore, buildFtsQuery, mergeHybridResults } from "./hybrid.js";

describe("memory hybrid helpers", () => {
  it("buildFtsQuery tokenizes and AND-joins", () => {
    expect(buildFtsQuery("hello world")).toBe('"hello" AND "world"');
    expect(buildFtsQuery("FOO_bar baz-1")).toBe('"FOO_bar" AND "baz" AND "1"');
    expect(buildFtsQuery("金银价格")).toBe('"金银价格"');
    expect(buildFtsQuery("価格 2026年")).toBe('"価格" AND "2026年"');
    expect(buildFtsQuery("   ")).toBeNull();
  });

  it("bm25RankToScore is monotonic and clamped", () => {
    expect(bm25RankToScore(0)).toBeCloseTo(1);
    expect(bm25RankToScore(1)).toBeCloseTo(0.5);
    expect(bm25RankToScore(10)).toBeLessThan(bm25RankToScore(1));
    expect(bm25RankToScore(-100)).toBeCloseTo(1, 1);
  });

  it("bm25RankToScore preserves FTS5 BM25 relevance ordering", () => {
    const strongest = bm25RankToScore(-4.2);
    const middle = bm25RankToScore(-2.1);
    const weakest = bm25RankToScore(-0.5);

    expect(strongest).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(weakest);
    expect(strongest).not.toBe(middle);
    expect(middle).not.toBe(weakest);
  });

  it("mergeHybridResults unions by id and combines weighted scores", async () => {
    const merged = await mergeHybridResults({
      vectorWeight: 0.7,
      textWeight: 0.3,
      vector: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "vec-a",
          vectorScore: 0.9,
        },
      ],
      keyword: [
        {
          id: "b",
          path: "memory/b.md",
          startLine: 3,
          endLine: 4,
          source: "memory",
          snippet: "kw-b",
          textScore: 1.0,
        },
      ],
    });

    expect(merged).toHaveLength(2);
    const a = merged.find((r) => r.path === "memory/a.md");
    const b = merged.find((r) => r.path === "memory/b.md");
    expect(a?.score).toBeCloseTo(0.7 * 0.9);
    expect(b?.score).toBeCloseTo(0.3 * 1.0);
  });

  it("mergeHybridResults prefers keyword snippet when ids overlap", async () => {
    const merged = await mergeHybridResults({
      vectorWeight: 0.5,
      textWeight: 0.5,
      vector: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "vec-a",
          vectorScore: 0.2,
        },
      ],
      keyword: [
        {
          id: "a",
          path: "memory/a.md",
          startLine: 1,
          endLine: 2,
          source: "memory",
          snippet: "kw-a",
          textScore: 1.0,
        },
      ],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.snippet).toBe("kw-a");
    expect(merged[0]?.score).toBeCloseTo(0.5 * 0.2 + 0.5 * 1.0);
  });

  describe("semantic dedup", () => {
    it("filters near-duplicate results when dedup enabled", async () => {
      const merged = await mergeHybridResults({
        vectorWeight: 1,
        textWeight: 0,
        vector: [
          {
            id: "a",
            path: "memory/a.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet:
              "KaijiBot is an AI assistant that proactively sends cognitive insights to users via Feishu",
            vectorScore: 0.9,
          },
          {
            id: "b",
            path: "memory/b.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet:
              "KaijiBot is an AI assistant that proactively sends cognitive insights to users via Feishu messaging",
            vectorScore: 0.8,
          },
        ],
        keyword: [],
        semanticDedup: { enabled: true, threshold: 0.85 },
      });

      expect(merged).toHaveLength(1);
      expect(merged[0]?.path).toBe("memory/a.md");
    });

    it("preserves diverse results when dedup enabled", async () => {
      const merged = await mergeHybridResults({
        vectorWeight: 1,
        textWeight: 0,
        vector: [
          {
            id: "a",
            path: "memory/a.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet: "TypeScript strict mode catches bugs at compile time",
            vectorScore: 0.9,
          },
          {
            id: "b",
            path: "memory/b.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet: "Rust ownership model prevents memory leaks at runtime",
            vectorScore: 0.8,
          },
        ],
        keyword: [],
        semanticDedup: { enabled: true, threshold: 0.85 },
      });

      expect(merged).toHaveLength(2);
    });

    it("does not dedup when disabled (default)", async () => {
      const merged = await mergeHybridResults({
        vectorWeight: 1,
        textWeight: 0,
        vector: [
          {
            id: "a",
            path: "memory/a.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet: "KaijiBot is an AI assistant for Feishu",
            vectorScore: 0.9,
          },
          {
            id: "b",
            path: "memory/b.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet: "KaijiBot is an AI assistant for Feishu users",
            vectorScore: 0.8,
          },
        ],
        keyword: [],
      });

      expect(merged).toHaveLength(2);
    });

    it("works with both dedup and MMR enabled", async () => {
      const merged = await mergeHybridResults({
        vectorWeight: 1,
        textWeight: 0,
        vector: [
          {
            id: "a",
            path: "memory/a.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet:
              "KaijiBot proactively sends cognitive insights to users via Feishu",
            vectorScore: 0.95,
          },
          {
            id: "b",
            path: "memory/b.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet:
              "KaijiBot proactively sends cognitive insights to users via Feishu chat",
            vectorScore: 0.9,
          },
          {
            id: "c",
            path: "memory/c.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet: "Rust ownership prevents data races at compile time",
            vectorScore: 0.7,
          },
        ],
        keyword: [],
        semanticDedup: { enabled: true, threshold: 0.85 },
        mmr: { enabled: true, lambda: 0.5 },
      });

      expect(merged.length).toBeLessThanOrEqual(2);
      expect(merged.length).toBeGreaterThanOrEqual(1);
      const paths = merged.map((r) => r.path);
      if (merged.length === 2) {
        expect(paths).toContain("memory/c.md");
      }
    });

    it("respects custom threshold", async () => {
      const snippet1 = "the cat sat on the mat";
      const snippet2 = "the dog sat on the mat";

      const mergedLow = await mergeHybridResults({
        vectorWeight: 1,
        textWeight: 0,
        vector: [
          {
            id: "a",
            path: "memory/a.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet: snippet1,
            vectorScore: 0.9,
          },
          {
            id: "b",
            path: "memory/b.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet: snippet2,
            vectorScore: 0.8,
          },
        ],
        keyword: [],
        semanticDedup: { enabled: true, threshold: 0.5 },
      });

      const mergedHigh = await mergeHybridResults({
        vectorWeight: 1,
        textWeight: 0,
        vector: [
          {
            id: "a",
            path: "memory/a.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet: snippet1,
            vectorScore: 0.9,
          },
          {
            id: "b",
            path: "memory/b.md",
            startLine: 1,
            endLine: 2,
            source: "memory",
            snippet: snippet2,
            vectorScore: 0.8,
          },
        ],
        keyword: [],
        semanticDedup: { enabled: true, threshold: 0.99 },
      });

      expect(mergedLow.length).toBeLessThanOrEqual(mergedHigh.length);
    });
  });
});
