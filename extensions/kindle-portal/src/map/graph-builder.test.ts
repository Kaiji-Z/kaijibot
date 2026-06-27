import { describe, expect, it } from "vitest";
import { buildMapGraph, type WikiData } from "./graph-builder.js";
import type {
  PersonaTree,
  PersonaDomainNode,
  InterestPhase,
  WikiNode,
  WikiEdge,
} from "../types.js";

/**
 * Build a PersonaDomainNode with sensible strength defaults.
 *
 * Default (no opts) → phase=stable, depth=5, recurrence=10 → strength ≈ 1.0.
 * Use `{ phase: "dormant", depth: 0, recurrence: 0 }` for low strength (~0.02).
 */
function makeDomain(
  opts: {
    phase?: InterestPhase;
    depth?: number;
    recurrence?: number;
    insights?: { category?: string }[];
    keyInsights?: unknown[];
  } = {},
): PersonaDomainNode {
  return {
    phase: opts.phase ?? "stable",
    depth: opts.depth ?? 5,
    recurrence: opts.recurrence ?? 10,
    insights: opts.insights,
    keyInsights: opts.keyInsights,
  };
}

function makePersona(domains: Record<string, PersonaDomainNode>): PersonaTree {
  return { domains };
}

function makeWiki(nodes: WikiNode[], edges: WikiEdge[] = []): WikiData {
  return { nodes, edges };
}

describe("buildMapGraph", () => {
  it("persona null → empty graph with no warning (when showWiki false)", () => {
    const g = buildMapGraph(null, null, { maxDomains: 20, showWiki: false });
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.truncated).toBeUndefined();
    expect(g.warning).toBeUndefined();
  });

  it("persona with 3 domains → 3 domain nodes sorted by strength desc", () => {
    const persona = makePersona({
      Alpha: makeDomain({ phase: "emergent", depth: 1, recurrence: 1 }), // ~0.25
      Beta: makeDomain({ phase: "stable", depth: 5, recurrence: 10 }), // ~1.0
      Gamma: makeDomain({ phase: "stable", depth: 3, recurrence: 5 }), // ~0.65
    });
    const g = buildMapGraph(persona, null, { maxDomains: 20, showWiki: false });
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes.every((n) => n.kind === "domain")).toBe(true);
    const strengths = g.nodes.map((n) => n.strength);
    expect(strengths[0]).toBeGreaterThanOrEqual(strengths[1]);
    expect(strengths[1]).toBeGreaterThanOrEqual(strengths[2]);
    // Sorted by strength desc → Beta (1.0), Gamma (0.65), Alpha (0.25)
    expect(g.nodes.map((n) => n.id)).toEqual(["beta", "gamma", "alpha"]);
  });

  it("excludes tool_config and contextual_fact from insightCount", () => {
    const persona = makePersona({
      Rust: makeDomain({
        insights: [
          { category: "domain_knowledge" },
          { category: "tool_config" },
          { category: "contextual_fact" },
          { category: "behavioral_pattern" },
        ],
      }),
    });
    const g = buildMapGraph(persona, null, { maxDomains: 20, showWiki: false });
    expect(g.nodes[0].insightCount).toBe(2);
  });

  it("falls back to keyInsights.length when insights undefined", () => {
    const persona = makePersona({
      Rust: makeDomain({ keyInsights: [1, 2, 3] }),
    });
    const g = buildMapGraph(persona, null, { maxDomains: 20, showWiki: false });
    expect(g.nodes[0].insightCount).toBe(3);
  });

  it("truncates to maxDomains", () => {
    const domains: Record<string, PersonaDomainNode> = {};
    for (let i = 0; i < 25; i++) {
      domains[`D${i.toString().padStart(2, "0")}`] = makeDomain();
    }
    const persona = makePersona(domains);
    const g = buildMapGraph(persona, null, { maxDomains: 20, showWiki: false });
    expect(g.nodes).toHaveLength(20);
    expect(g.truncated).toEqual({ shown: 20, total: 25 });
  });

  it("lowercased domain ids", () => {
    const persona = makePersona({
      "Rust Programming": makeDomain(),
    });
    const g = buildMapGraph(persona, null, { maxDomains: 20, showWiki: false });
    expect(g.nodes[0].id).toBe("rust programming");
    expect(g.nodes[0].label).toBe("Rust Programming");
  });

  it("wiki present → adds concept/entity nodes", () => {
    const persona = makePersona({ Rust: makeDomain() });
    const wiki = makeWiki([
      { id: "tokio", label: "Tokio", kind: "concept" },
      { id: "async", label: "Async", kind: "entity" },
    ]);
    const g = buildMapGraph(persona, wiki, { maxDomains: 20, showWiki: true });
    expect(g.nodes).toHaveLength(3);
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toContain("rust");
    expect(ids).toContain("tokio");
    expect(ids).toContain("async");
  });

  it("wiki absent + showWiki true → warning set", () => {
    const g = buildMapGraph(null, null, { maxDomains: 20, showWiki: true });
    expect(g.warning).toBe("knowledge-wiki vault not found or empty");
  });

  it("wiki absent + showWiki false → no warning", () => {
    const g = buildMapGraph(null, null, { maxDomains: 20, showWiki: false });
    expect(g.warning).toBeUndefined();
  });

  it("wiki nodes get strength 0.5", () => {
    const wiki = makeWiki([{ id: "x", label: "X Entity", kind: "entity" }]);
    const g = buildMapGraph(null, wiki, { maxDomains: 20, showWiki: true });
    const wikiNode = g.nodes.find((n) => n.id === "x");
    expect(wikiNode?.strength).toBe(0.5);
  });

  it("persona-wiki cross edge via Jaccard label overlap", () => {
    // domain label "Rust Programming" → tokens {rust, programming}
    // wiki label "Rust" → tokens {rust}
    // Jaccard = 1 / 2 = 0.5 → edge added
    const persona = makePersona({ "Rust Programming": makeDomain() });
    const wiki = makeWiki([{ id: "rust", label: "Rust", kind: "entity" }]);
    const g = buildMapGraph(persona, wiki, { maxDomains: 20, showWiki: true });
    const edge = g.edges.find(
      (e) =>
        e.from === "rust programming" && e.to === "rust" && e.label === "wiki",
    );
    expect(edge).toBeDefined();
  });

  it("no persona-wiki edge when Jaccard < 0.5", () => {
    // domain "Rust" → {rust}; wiki "Python" → {python}; Jaccard 0
    const persona = makePersona({ Rust: makeDomain() });
    const wiki = makeWiki([{ id: "python", label: "Python", kind: "entity" }]);
    const g = buildMapGraph(persona, wiki, { maxDomains: 20, showWiki: true });
    const edge = g.edges.find((e) => e.label === "wiki");
    expect(edge).toBeUndefined();
  });

  it("cross-domain edges between high-strength related domains", () => {
    // Both strength ~1.0 (>0.4). Labels share "rust" and "programming":
    //   "Rust Programming" → {rust, programming}
    //   "Advanced Rust Programming" → {advanced, rust, programming}
    //   Jaccard = 2/3 ≈ 0.67 ≥ 0.5 → edge
    const persona = makePersona({
      "Rust Programming": makeDomain(),
      "Advanced Rust Programming": makeDomain(),
    });
    const g = buildMapGraph(persona, null, { maxDomains: 20, showWiki: false });
    const edge = g.edges.find((e) => e.label === "related");
    expect(edge).toBeDefined();
  });

  it("no cross-domain edge when strength too low", () => {
    // Both dormant + depth 0 + rec 0 → strength ≈ 0.02 (≤ 0.4)
    const persona = makePersona({
      "Rust Programming": makeDomain({ phase: "dormant", depth: 0, recurrence: 0 }),
      "Advanced Rust Programming": makeDomain({
        phase: "dormant",
        depth: 0,
        recurrence: 0,
      }),
    });
    const g = buildMapGraph(persona, null, { maxDomains: 20, showWiki: false });
    const edge = g.edges.find((e) => e.label === "related");
    expect(edge).toBeUndefined();
  });

  it("dedupes wiki edges (unordered)", () => {
    // a→b and b→a collapse to 1 edge (unordered pair dedup)
    const wiki = makeWiki(
      [
        { id: "a", label: "Alpha Beta", kind: "entity" },
        { id: "b", label: "Beta Gamma", kind: "entity" },
      ],
      [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    );
    const g = buildMapGraph(null, wiki, { maxDomains: 20, showWiki: true });
    expect(g.edges).toHaveLength(1);
  });

  it("drops self-edges", () => {
    const wiki = makeWiki(
      [{ id: "a", label: "Alpha Beta", kind: "entity" }],
      [{ from: "a", to: "a" }],
    );
    const g = buildMapGraph(null, wiki, { maxDomains: 20, showWiki: true });
    expect(g.edges).toHaveLength(0);
  });

  it("domain wins when wiki has same id", () => {
    const persona = makePersona({ Rust: makeDomain() });
    const wiki = makeWiki([{ id: "rust", label: "Rust", kind: "entity" }]);
    const g = buildMapGraph(persona, wiki, { maxDomains: 20, showWiki: true });
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].kind).toBe("domain");
  });

  it("empty persona domains → empty graph (no nodes)", () => {
    const persona = makePersona({});
    const g = buildMapGraph(persona, null, { maxDomains: 20, showWiki: false });
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it("preserve CJK tokens in Jaccard", () => {
    // Domain "机器学习" tokenizes to {机器学习} (CJK chars preserved as a single
    // token, length 4 — passes the length≥2 filter). Wiki label identical.
    // Jaccard = 1.0 ≥ 0.5 → persona-wiki edge added.
    // If the tokenizer stripped CJK, both token sets would be empty → no edge.
    const persona = makePersona({ 机器学习: makeDomain() });
    const wiki = makeWiki([{ id: "ml", label: "机器学习", kind: "concept" }]);
    const g = buildMapGraph(persona, wiki, { maxDomains: 20, showWiki: true });
    const edge = g.edges.find(
      (e) => e.from === "机器学习" && e.to === "ml" && e.label === "wiki",
    );
    expect(edge).toBeDefined();
  });
});
