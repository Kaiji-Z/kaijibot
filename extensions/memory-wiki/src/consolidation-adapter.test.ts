import { describe, expect, it } from "vitest";
import {
  mapConsolidationItemsToWikiSynthesis,
  type WikiConsolidationInput,
} from "./consolidation-adapter.js";

function makeItem(overrides: Partial<WikiConsolidationInput> = {}): WikiConsolidationInput {
  return {
    category: "domain_knowledge",
    domains: ["distributed-systems"],
    content: "eBPF enables low-overhead tracing in kernel space",
    confidence: 0.85,
    ...overrides,
  };
}

describe("mapConsolidationItemsToWikiSynthesis", () => {
  it("returns empty array for empty input", () => {
    const result = mapConsolidationItemsToWikiSynthesis([]);
    expect(result).toEqual([]);
  });

  it("filters out items below minConfidence", () => {
    const items = [
      makeItem({ confidence: 0.9 }),
      makeItem({ confidence: 0.6 }),
      makeItem({ confidence: 0.71 }),
    ];
    const result = mapConsolidationItemsToWikiSynthesis(items, { minConfidence: 0.7 });
    // All 3 pass the default 0.7 threshold; only 0.6 would be filtered with minConfidence=0.7
    expect(result).toHaveLength(1);
    expect(result[0]!.claims).toHaveLength(2);
  });

  it("filters out items below default minConfidence (0.7)", () => {
    const items = [makeItem({ confidence: 0.5 }), makeItem({ confidence: 0.69 })];
    const result = mapConsolidationItemsToWikiSynthesis(items);
    expect(result).toEqual([]);
  });

  it("groups items by domains[0]", () => {
    const items = [
      makeItem({ domains: ["rust"], content: "Rust ownership model" }),
      makeItem({ domains: ["distributed-systems"], content: "CAP theorem" }),
      makeItem({ domains: ["rust"], content: "Rust async/await" }),
    ];
    const result = mapConsolidationItemsToWikiSynthesis(items);
    expect(result).toHaveLength(2);
    const rustPage = result.find((r) => r.title.includes("rust"))!;
    const dsPage = result.find((r) => r.title.includes("distributed-systems"))!;
    expect(rustPage.claims).toHaveLength(2);
    expect(dsPage.claims).toHaveLength(1);
  });

  it("groups items with empty domains as 'general'", () => {
    const items = [makeItem({ domains: [], content: "general knowledge" })];
    const result = mapConsolidationItemsToWikiSynthesis(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toMatch(/^general — /);
    expect(result[0]!.sourceIds[0]).toMatch(/^consolidation:.*:general$/);
  });

  it("formats title as '${domain} — ${date}'", () => {
    const items = [makeItem({ domains: ["machine-learning"] })];
    const result = mapConsolidationItemsToWikiSynthesis(items, {
      date: "2026-06-18",
    });
    expect(result[0]!.title).toBe("machine-learning — 2026-06-18");
  });

  it("formats sourceIds as 'consolidation:${date}:${slug}'", () => {
    const items = [makeItem({ domains: ["C++ Programming"] })];
    const result = mapConsolidationItemsToWikiSynthesis(items, {
      date: "2026-06-18",
    });
    expect(result[0]!.sourceIds).toEqual(["consolidation:2026-06-18:c-programming"]);
  });

  it("sets page confidence to max of group confidences", () => {
    const items = [
      makeItem({ confidence: 0.75, content: "low" }),
      makeItem({ confidence: 0.95, content: "high" }),
    ];
    const result = mapConsolidationItemsToWikiSynthesis(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe(0.95);
  });

  it("respects maxPages truncation", () => {
    const items = [
      makeItem({ domains: ["a"], content: "a1" }),
      makeItem({ domains: ["b"], content: "b1" }),
      makeItem({ domains: ["c"], content: "c1" }),
    ];
    const result = mapConsolidationItemsToWikiSynthesis(items, {
      maxPages: 2,
    });
    expect(result).toHaveLength(2);
  });

  it("renders evidence as bullets in body", () => {
    const items = [
      makeItem({
        evidence: ["Paper A (2024)", "Experiment B"],
      }),
    ];
    const result = mapConsolidationItemsToWikiSynthesis(items);
    expect(result[0]!.body).toContain("**Evidence:**");
    expect(result[0]!.body).toContain("- Paper A (2024)");
    expect(result[0]!.body).toContain("- Experiment B");
  });

  it("produces separate mutations per domain", () => {
    const items = [
      makeItem({ domains: ["ai"], content: "LLM basics" }),
      makeItem({ domains: ["web"], content: "HTTP/3" }),
      makeItem({ domains: ["devops"], content: "K8s pods" }),
    ];
    const result = mapConsolidationItemsToWikiSynthesis(items);
    expect(result).toHaveLength(3);
    const domains = result.map((r) => r.sourceIds[0]!.split(":")[2]);
    expect(domains).toContain("ai");
    expect(domains).toContain("web");
    expect(domains).toContain("devops");
  });

  it("caps claims at 10 per page", () => {
    const items = Array.from({ length: 15 }, (_, i) => makeItem({ content: `item-${i}` }));
    const result = mapConsolidationItemsToWikiSynthesis(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.claims).toHaveLength(10);
    expect(result[0]!.claims![9]!.text).toBe("item-9");
  });

  it("respects custom minConfidence option", () => {
    const items = [
      makeItem({ confidence: 0.5 }),
      makeItem({ confidence: 0.6 }),
      makeItem({ confidence: 0.8 }),
    ];
    const result = mapConsolidationItemsToWikiSynthesis(items, {
      minConfidence: 0.55,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.claims).toHaveLength(2);
  });

  it("sets op to 'create_synthesis' and status to 'active'", () => {
    const items = [makeItem()];
    const result = mapConsolidationItemsToWikiSynthesis(items);
    expect(result[0]!.op).toBe("create_synthesis");
    expect(result[0]!.status).toBe("active");
  });

  it("maps evidence strings to WikiClaim.evidence as note objects", () => {
    const items = [
      makeItem({
        evidence: ["source-1", "source-2"],
      }),
    ];
    const result = mapConsolidationItemsToWikiSynthesis(items);
    expect(result[0]!.claims).toHaveLength(1);
    expect(result[0]!.claims![0]!.evidence).toEqual([{ note: "source-1" }, { note: "source-2" }]);
  });

  it("handles items with no evidence gracefully", () => {
    const items = [makeItem({ evidence: undefined })];
    const result = mapConsolidationItemsToWikiSynthesis(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.claims![0]!.evidence).toEqual([]);
    expect(result[0]!.body).not.toContain("**Evidence:**");
  });
});
