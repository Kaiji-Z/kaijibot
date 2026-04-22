import { describe, it, expect } from "vitest";
import { deduplicateBySimilarity, DEFAULT_SEMANTIC_DEDUP_CONFIG } from "./semantic-dedup.js";
import type { DedupableItem } from "./semantic-dedup.js";

function item(overrides: Partial<DedupableItem> & { id: string; content: string }): DedupableItem {
  return { score: 1, ...overrides };
}

describe("deduplicateBySimilarity", () => {
  it("empty input returns empty output", () => {
    expect(deduplicateBySimilarity([])).toEqual([]);
  });

  it("single item passes through unchanged", () => {
    const items = [item({ id: "a", content: "hello" })];
    const result = deduplicateBySimilarity(items, { enabled: true });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a");
    expect(result[0]!.mergedFrom).toBeUndefined();
  });

  it("disabled by default keeps all items", () => {
    const items = [
      item({ id: "a", content: "用户偏好深色模式" }),
      item({ id: "b", content: "用户喜欢深色主题" }),
    ];
    const result = deduplicateBySimilarity(items);
    expect(result).toHaveLength(2);
  });

  it("explicitly disabled keeps all items", () => {
    const items = [
      item({ id: "a", content: "用户偏好深色模式" }),
      item({ id: "b", content: "用户偏好深色模式" }),
    ];
    const result = deduplicateBySimilarity(items, { enabled: false });
    expect(result).toHaveLength(2);
  });

  it("identical content (Jaccard=1.0) merges into one", () => {
    const items = [
      item({ id: "a", score: 0.9, content: "用户偏好深色模式" }),
      item({ id: "b", score: 0.8, content: "用户偏好深色模式" }),
    ];
    const result = deduplicateBySimilarity(items, { enabled: true });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a");
    expect(result[0]!.mergedFrom).toEqual(["b"]);
  });

  it("near-duplicate content above threshold merges into one", () => {
    const items = [
      item({ id: "a", score: 0.9, content: "用户偏好深色模式" }),
      item({ id: "b", score: 0.8, content: "用户喜欢暗色模式" }),
    ];
    const result = deduplicateBySimilarity(items, { enabled: true, threshold: 0.3 });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a");
  });

  it("completely different content keeps both", () => {
    const items = [
      item({ id: "a", score: 0.9, content: "用户偏好深色模式" }),
      item({ id: "b", score: 0.8, content: "项目使用 React 框架" }),
    ];
    const result = deduplicateBySimilarity(items, { enabled: true });
    expect(result).toHaveLength(2);
  });

  it("higher-scored item wins in merge", () => {
    const items = [
      item({ id: "a", score: 0.3, content: "用户偏好深色模式" }),
      item({ id: "b", score: 0.9, content: "用户偏好深色模式" }),
    ];
    const result = deduplicateBySimilarity(items, { enabled: true });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("b");
    expect(result[0]!.mergedFrom).toEqual(["a"]);
  });

  it("preserves original order of kept items", () => {
    const items = [
      item({ id: "a", score: 0.9, content: "用户偏好深色模式" }),
      item({ id: "b", score: 0.8, content: "项目使用 React 框架" }),
      item({ id: "c", score: 0.7, content: "用户喜欢暗色模式" }),
    ];
    const result = deduplicateBySimilarity(items, { enabled: true, threshold: 0.3 });
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("a");
    expect(result[1]!.id).toBe("b");
    expect(result[0]!.mergedFrom).toContain("c");
  });

  it("custom threshold controls merge sensitivity", () => {
    const items = [
      item({ id: "a", score: 0.9, content: "用户偏好深色模式" }),
      item({ id: "b", score: 0.8, content: "用户喜欢暗色模式" }),
    ];
    // High threshold: different enough to keep both
    const strict = deduplicateBySimilarity(items, { enabled: true, threshold: 0.99 });
    expect(strict).toHaveLength(2);

    // Low threshold: similar enough to merge
    const loose = deduplicateBySimilarity(items, { enabled: true, threshold: 0.3 });
    expect(loose).toHaveLength(1);
  });

  it("transitive merge accumulates mergedFrom", () => {
    const items = [
      item({ id: "a", score: 0.9, content: "用户偏好深色模式" }),
      item({ id: "b", score: 0.7, content: "用户喜欢深色主题" }),
      item({ id: "c", score: 0.8, content: "用户喜欢暗色模式" }),
    ];
    const result = deduplicateBySimilarity(items, { enabled: true, threshold: 0.3 });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a");
    expect(result[0]!.mergedFrom).toHaveLength(2);
    expect(result[0]!.mergedFrom).toContain("b");
    expect(result[0]!.mergedFrom).toContain("c");
  });

  it("items not in any duplicate group have no mergedFrom", () => {
    const items = [
      item({ id: "a", score: 0.9, content: "项目使用 React 框架" }),
      item({ id: "b", score: 0.8, content: "用户偏好深色模式" }),
      item({ id: "c", score: 0.7, content: "数据库采用 PostgreSQL" }),
    ];
    const result = deduplicateBySimilarity(items, { enabled: true });
    expect(result).toHaveLength(3);
    for (const r of result) {
      expect(r.mergedFrom).toBeUndefined();
    }
  });
});

describe("DEFAULT_SEMANTIC_DEDUP_CONFIG", () => {
  it("has expected defaults", () => {
    expect(DEFAULT_SEMANTIC_DEDUP_CONFIG.enabled).toBe(false);
    expect(DEFAULT_SEMANTIC_DEDUP_CONFIG.threshold).toBe(0.85);
  });
});
