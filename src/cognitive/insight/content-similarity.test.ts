import { describe, it, expect } from "vitest";
import { extractTrigrams, computeTrigramSimilarity, isDuplicateByContent, extractChinesePhrases, computeContentWordOverlap, isDuplicateBySemanticOverlap } from "./content-similarity.js";

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

describe("extractChinesePhrases", () => {
  it("splits by stop characters", () => {
    const phrases = extractChinesePhrases("机器学习是人工智能的一个分支");
    expect(phrases).toContain("机器学习");
    expect(phrases.length).toBeGreaterThan(0);
  });

  it("preserves English words", () => {
    const phrases = extractChinesePhrases("React组件的设计模式");
    expect(phrases).toContain("React组件");
    expect(phrases).toContain("设计模式");
  });

  it("filters out short and long tokens", () => {
    const phrases = extractChinesePhrases("a 人工智能核心算法研究与实际应用场景深度剖析和未来发展趋势预测");
    for (const p of phrases) {
      expect(p.length).toBeGreaterThanOrEqual(2);
      expect(p.length).toBeLessThanOrEqual(20);
    }
  });
});

describe("computeContentWordOverlap", () => {
  it("detects overlap for paraphrased Chinese", () => {
    const overlap = computeContentWordOverlap(
      "深度学习在图像识别领域取得了突破性进展",
      "深度学习技术推动了图像识别的重大突破",
    );
    expect(overlap).toBeGreaterThan(0.3);
  });

  it("returns 0 for completely different Chinese content", () => {
    const overlap = computeContentWordOverlap(
      "量子计算的纠错码设计",
      "有机农业的土壤改良方法",
    );
    expect(overlap).toBeLessThan(0.15);
  });

  it("returns 0 for non-CJK strings", () => {
    expect(computeContentWordOverlap("hello world", "foo bar")).toBe(0);
  });
});

describe("isDuplicateBySemanticOverlap", () => {
  it("catches paraphrases via content-word overlap", () => {
    expect(isDuplicateBySemanticOverlap(
      "Transformer架构的自注意力机制改变了自然语言处理的研究方向",
      ["Transformer自注意力机制彻底革新了自然语言处理的技术路线"],
    )).toBe(true);
  });

  it("allows clearly different content", () => {
    expect(isDuplicateBySemanticOverlap(
      "Rust语言的内存安全模型通过所有权机制避免了数据竞争",
      ["飞书机器人的Webhook回调需要验证签名才能处理请求"],
    )).toBe(false);
  });

  it("catches identical content via trigram", () => {
    expect(isDuplicateBySemanticOverlap("hello world", ["hello world"])).toBe(true);
  });
});
