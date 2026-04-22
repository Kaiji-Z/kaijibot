import { describe, it, expect } from "vitest";
import { extractTrigrams, computeTrigramSimilarity, isDuplicateByContent } from "./content-similarity.js";

describe("extractTrigrams", () => {
  it("extracts trigrams from text", () => {
    const result = extractTrigrams("abcde");
    expect(result.has("abc")).toBe(true);
    expect(result.has("bcd")).toBe(true);
    expect(result.has("cde")).toBe(true);
    expect(result.size).toBe(3);
  });

  it("handles short text (< 3 chars)", () => {
    expect(extractTrigrams("ab").size).toBe(0);
  });

  it("normalizes to lowercase", () => {
    const upper = extractTrigrams("ABC");
    const lower = extractTrigrams("abc");
    expect(upper).toEqual(lower);
  });
});

describe("computeTrigramSimilarity", () => {
  it("returns 1.0 for identical text", () => {
    expect(computeTrigramSimilarity("hello world", "hello world")).toBe(1.0);
  });

  it("returns 0 for completely different text", () => {
    expect(computeTrigramSimilarity("abcdef", "uvwxyz")).toBe(0);
  });

  it("returns moderate similarity for related text", () => {
    const sim = computeTrigramSimilarity(
      "飞书skill开发本质上是在写一个能力边界明确的函数",
      "飞书skill开发和写函数是同一件事——都是先画能力边界再填实现",
    );
    expect(sim).toBeGreaterThan(0.2);
  });

  it("returns 0 for text shorter than 3 chars", () => {
    expect(computeTrigramSimilarity("ab", "cd")).toBe(0);
  });
});

describe("isDuplicateByContent", () => {
  it("returns true for identical content", () => {
    expect(isDuplicateByContent("hello world", ["hello world"])).toBe(true);
  });

  it("returns false for clearly different content", () => {
    expect(isDuplicateByContent("TypeScript类型系统", ["英超赛程时间转换"])).toBe(false);
  });

  it("returns true for similar content above threshold", () => {
    expect(isDuplicateByContent(
      "飞书skill开发本质上是在写一个能力边界明确的函数",
      ["飞书skill开发和写函数是同一件事——都是先画能力边界再填实现"],
      0.2,
    )).toBe(true);
  });

  it("respects custom threshold", () => {
    const a = "TypeScript decorator patterns";
    const b = "TypeScript decorator usage";
    expect(isDuplicateByContent(a, [b], 0.9)).toBe(false);
  });

  it("returns false for empty recent contents", () => {
    expect(isDuplicateByContent("anything", [])).toBe(false);
  });
});
