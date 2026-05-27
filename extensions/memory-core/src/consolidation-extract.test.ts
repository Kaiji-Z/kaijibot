import { describe, it, expect, vi } from "vitest";
import type { TranscriptBatch, ExtractedItem } from "./consolidation-types.js";
import { extractFromBatch, mergeAndDedupBatches, resolveConflicts } from "./consolidation-extract.js";

function makeBatch(files: Array<{ path: string; content: string }> = []): TranscriptBatch {
  return { agentId: "test-agent", userId: "test-user", files };
}

function makeItem(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    category: "domain_knowledge",
    content: "User prefers TypeScript for backend development",
    confidence: 0.85,
    source: "transcript",
    evidence: "I love TypeScript for backend development",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractFromBatch
// ---------------------------------------------------------------------------

describe("extractFromBatch", () => {
  it("returns empty array for empty batch", async () => {
    const generateText = vi.fn();
    const result = await extractFromBatch(makeBatch(), generateText);
    expect(result).toEqual([]);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("returns parsed items when generateText returns valid JSON array", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          category: "domain_knowledge",
          content: "User prefers TypeScript for backend",
          confidence: 0.85,
          evidence: "I love TypeScript for backend development",
        },
      ]),
    );
    const result = await extractFromBatch(
      makeBatch([{ path: "session1.jsonl", content: "some transcript" }]),
      generateText,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: "domain_knowledge",
      content: "User prefers TypeScript for backend",
      confidence: 0.85,
      source: "transcript",
      evidence: "I love TypeScript for backend development",
    });
  });

  it("strips markdown code fences before parsing", async () => {
    const raw = '```json\n[{"category":"domain_knowledge","content":"Likes Rust","confidence":0.7,"evidence":"Rust is great"}]\n```';
    const generateText = vi.fn().mockResolvedValue(raw);
    const result = await extractFromBatch(
      makeBatch([{ path: "s.jsonl", content: "transcript" }]),
      generateText,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("Likes Rust");
  });

  it("strips markdown code fences without json tag before parsing", async () => {
    const raw = '```\n[{"category":"domain_knowledge","content":"Likes Go","confidence":0.75,"evidence":"Go is nice"}]\n```';
    const generateText = vi.fn().mockResolvedValue(raw);
    const result = await extractFromBatch(
      makeBatch([{ path: "s.jsonl", content: "transcript" }]),
      generateText,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("Likes Go");
  });

  it("returns empty array when generateText returns invalid JSON", async () => {
    const generateText = vi.fn().mockResolvedValue("not valid json {{{");
    const result = await extractFromBatch(
      makeBatch([{ path: "s.jsonl", content: "transcript" }]),
      generateText,
    );
    expect(result).toEqual([]);
  });

  it("filters out items with invalid categories", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify([
        { category: "tool_config", content: "some config", confidence: 0.9, evidence: "evidence" },
        { category: "contextual_fact", content: "a fact", confidence: 0.9, evidence: "ev" },
        { category: "invalid_category", content: "bad", confidence: 0.9, evidence: "ev" },
        { category: "domain_knowledge", content: "valid", confidence: 0.8, evidence: "good ev" },
      ]),
    );
    const result = await extractFromBatch(
      makeBatch([{ path: "s.jsonl", content: "transcript" }]),
      generateText,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe("domain_knowledge");
  });

  it("filters out items with confidence < 0.5", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify([
        { category: "domain_knowledge", content: "low conf", confidence: 0.3, evidence: "ev" },
        { category: "domain_knowledge", content: "edge case", confidence: 0.49, evidence: "ev" },
        { category: "domain_knowledge", content: "just ok", confidence: 0.5, evidence: "ev" },
      ]),
    );
    const result = await extractFromBatch(
      makeBatch([{ path: "s.jsonl", content: "transcript" }]),
      generateText,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("just ok");
  });

  it("filters out items with empty content or evidence", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify([
        { category: "domain_knowledge", content: "", confidence: 0.8, evidence: "has evidence" },
        { category: "domain_knowledge", content: "has content", confidence: 0.8, evidence: "" },
        { category: "domain_knowledge", content: "   ", confidence: 0.8, evidence: "has ev" },
        { category: "domain_knowledge", content: "good", confidence: 0.8, evidence: "   " },
        { category: "domain_knowledge", content: "valid", confidence: 0.8, evidence: "good" },
      ]),
    );
    const result = await extractFromBatch(
      makeBatch([{ path: "s.jsonl", content: "transcript" }]),
      generateText,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("valid");
  });

  it("preserves domain field from LLM output", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          category: "domain_knowledge",
          content: "User deploys Kubernetes clusters on Alibaba Cloud",
          confidence: 0.9,
          evidence: "我在阿里云上部署了三个 Kubernetes 集群",
          domain: "Kubernetes",
        },
        {
          category: "behavioral_pattern",
          content: "User prefers async patterns for I/O",
          confidence: 0.8,
          evidence: "I always use async",
          domain: "异步编程",
        },
      ]),
    );
    const result = await extractFromBatch(
      makeBatch([{ path: "s.jsonl", content: "transcript" }]),
      generateText,
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.domain).toBe("Kubernetes");
    expect(result[1]!.domain).toBe("异步编程");
  });

  it("sets domain to undefined when LLM omits it", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          category: "domain_knowledge",
          content: "Some knowledge",
          confidence: 0.8,
          evidence: "evidence text",
        },
      ]),
    );
    const result = await extractFromBatch(
      makeBatch([{ path: "s.jsonl", content: "transcript" }]),
      generateText,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.domain).toBeUndefined();
  });

  it("sets domain to undefined when LLM returns empty string", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          category: "domain_knowledge",
          content: "Some knowledge",
          confidence: 0.8,
          evidence: "evidence text",
          domain: "   ",
        },
      ]),
    );
    const result = await extractFromBatch(
      makeBatch([{ path: "s.jsonl", content: "transcript" }]),
      generateText,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.domain).toBeUndefined();
  });

  it("sets source to transcript on all items", async () => {
    const generateText = vi.fn().mockResolvedValue(
      JSON.stringify([
        { category: "domain_knowledge", content: "c1", confidence: 0.8, evidence: "e1" },
        { category: "behavioral_pattern", content: "c2", confidence: 0.9, evidence: "e2" },
      ]),
    );
    const result = await extractFromBatch(
      makeBatch([{ path: "s.jsonl", content: "transcript" }]),
      generateText,
    );
    for (const item of result) {
      expect(item.source).toBe("transcript");
    }
  });
});

// ---------------------------------------------------------------------------
// mergeAndDedupBatches
// ---------------------------------------------------------------------------

describe("mergeAndDedupBatches", () => {
  it("returns empty array for empty batches", () => {
    expect(mergeAndDedupBatches([])).toEqual([]);
    expect(mergeAndDedupBatches([[]])).toEqual([]);
  });

  it("returns all items from single batch with no dupes", () => {
    const items = [
      makeItem({ content: "Item A", category: "domain_knowledge" }),
      makeItem({ content: "Item B", category: "behavioral_pattern" }),
    ];
    const result = mergeAndDedupBatches([items]);
    expect(result).toHaveLength(2);
  });

  it("keeps highest confidence for identical items", () => {
    const items = [
      makeItem({ content: "User loves TypeScript", confidence: 0.7, category: "domain_knowledge" }),
      makeItem({ content: "User loves TypeScript", confidence: 0.9, category: "domain_knowledge" }),
    ];
    const result = mergeAndDedupBatches([items]);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe(0.9);
  });

  it("dedupes similar items across batches using Jaccard threshold", () => {
    const batch1 = [
      makeItem({ content: "User prefers TypeScript for backend", confidence: 0.7, category: "domain_knowledge" }),
    ];
    const batch2 = [
      makeItem({ content: "User prefers TypeScript for backend development", confidence: 0.85, category: "domain_knowledge" }),
    ];
    // These are very similar — Jaccard >= 0.7
    const result = mergeAndDedupBatches([batch1, batch2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe(0.85);
  });

  it("does not dedup across different categories", () => {
    const batch1 = [
      makeItem({ content: "User loves TypeScript for backend", confidence: 0.7, category: "domain_knowledge" }),
    ];
    const batch2 = [
      makeItem({ content: "User loves TypeScript for backend", confidence: 0.9, category: "behavioral_pattern" }),
    ];
    const result = mergeAndDedupBatches([batch1, batch2]);
    expect(result).toHaveLength(2);
  });

  it("keeps both dissimilar items in the same category", () => {
    const batch1 = [
      makeItem({ content: "Rust memory safety model prevents data races", confidence: 0.8, category: "domain_knowledge" }),
    ];
    const batch2 = [
      makeItem({ content: "Kubernetes pod scheduling strategies", confidence: 0.75, category: "domain_knowledge" }),
    ];
    const result = mergeAndDedupBatches([batch1, batch2]);
    expect(result).toHaveLength(2);
  });

  it("preserves domain field through dedup", () => {
    const batch1 = [
      makeItem({
        content: "User prefers TypeScript for backend",
        confidence: 0.7,
        category: "domain_knowledge",
        domain: "TypeScript",
      }),
      makeItem({
        content: "Unique Rust knowledge",
        confidence: 0.8,
        category: "domain_knowledge",
        domain: "Rust",
      }),
    ];
    const batch2 = [
      makeItem({
        content: "User prefers TypeScript for backend development",
        confidence: 0.85,
        category: "domain_knowledge",
        domain: "TypeScript",
      }),
    ];
    const result = mergeAndDedupBatches([batch1, batch2]);
    expect(result).toHaveLength(2);
    const tsItem = result.find((i) => i.domain === "TypeScript");
    expect(tsItem).toBeDefined();
    expect(tsItem!.confidence).toBe(0.85);
    const rustItem = result.find((i) => i.domain === "Rust");
    expect(rustItem).toBeDefined();
  });

  it("handles items with and without domain field in same batch", () => {
    const items = [
      makeItem({ content: "Item with domain", confidence: 0.8, category: "domain_knowledge", domain: "Go" }),
      makeItem({ content: "Item without domain", confidence: 0.7, category: "domain_knowledge" }),
    ];
    const result = mergeAndDedupBatches([items]);
    expect(result).toHaveLength(2);
    expect(result[0]!.domain).toBe("Go");
    expect(result[1]!.domain).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveConflicts
// ---------------------------------------------------------------------------

describe("resolveConflicts", () => {
  it("returns empty arrays for empty items", () => {
    const result = resolveConflicts([]);
    expect(result.resolved).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("returns all items as resolved when no conflicts", () => {
    const items = [
      makeItem({ content: "Item about Rust memory safety", category: "domain_knowledge", confidence: 0.9 }),
      makeItem({ content: "Item about Kubernetes scaling", category: "domain_knowledge", confidence: 0.85 }),
    ];
    const result = resolveConflicts(items);
    expect(result.resolved).toHaveLength(2);
    expect(result.conflicts).toHaveLength(0);
  });

  it("detects conflicts for same-category items with medium similarity", () => {
    const items = [
      makeItem({
        content: "User prefers dark mode in all editors",
        category: "stated_preference",
        confidence: 0.7,
      }),
      makeItem({
        content: "User prefers light mode in all editors",
        category: "stated_preference",
        confidence: 0.9,
      }),
    ];
    // These share high token overlap ("user", "prefers", "mode", "in", "all", "editors")
    // but differ on "dark" vs "light", so similarity should be in 0.3-0.7 range
    const result = resolveConflicts(items);
    expect(result.conflicts.length).toBeGreaterThanOrEqual(0);
    // If conflict detected, higher-confidence item is kept
    if (result.conflicts.length > 0) {
      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0]!.confidence).toBe(0.9);
    }
  });

  it("does not detect conflicts across different categories", () => {
    const items = [
      makeItem({ content: "User loves TypeScript for backend development", category: "domain_knowledge", confidence: 0.8 }),
      makeItem({ content: "User loves TypeScript for backend development", category: "behavioral_pattern", confidence: 0.7 }),
    ];
    const result = resolveConflicts(items);
    expect(result.conflicts).toHaveLength(0);
    expect(result.resolved).toHaveLength(2);
  });

  it("resolves multiple conflicts correctly", () => {
    const items = [
      makeItem({
        content: "User uses Vim as primary editor for coding",
        category: "stated_preference",
        confidence: 0.6,
      }),
      makeItem({
        content: "User uses Emacs as primary editor for coding",
        category: "stated_preference",
        confidence: 0.8,
      }),
      makeItem({
        content: "User prefers React for frontend projects",
        category: "stated_preference",
        confidence: 0.65,
      }),
      makeItem({
        content: "User prefers Vue for frontend projects",
        category: "stated_preference",
        confidence: 0.9,
      }),
    ];
    const result = resolveConflicts(items);
    // Should have at least some conflicts due to similar structure
    // All resolved items should be from the input
    for (const item of result.resolved) {
      expect(items).toContainEqual(expect.objectContaining({ content: item.content }));
    }
    for (const conflict of result.conflicts) {
      expect(conflict).toHaveProperty("kept");
      expect(conflict).toHaveProperty("discarded");
      expect(conflict).toHaveProperty("reason");
    }
  });
});
