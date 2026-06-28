/**
 * Unit tests for the inline SVG graph renderer.
 *
 * Verifies force-directed layout positioning (within canvas bounds, not
 * exact coordinates — the layout is deterministic but positions float),
 * variable node sizes, label truncation, edge classification, wiki-node
 * slicing, XML escaping, zoom scaling, and determinism — all without
 * touching the filesystem or the LLM.
 */
import { describe, it, expect } from "vitest";
import { renderMapGraphSvg, computeForceLayout, MAX_WIKI_NODES } from "./svg-graph.js";
import type { MapGraph, MapNode } from "../types.js";

function domain(id: string, label: string, strength: number): MapNode {
  return { id, label, kind: "domain", strength };
}

function wiki(
  id: string,
  label: string,
  kind: "concept" | "entity" = "concept",
): MapNode {
  return { id, label, kind, strength: 0.5 };
}

/** Extract all cx/cy circle attributes from the SVG (for bounds checking). */
function extractCircleCenters(svg: string): Array<{ cx: number; cy: number }> {
  const re = /<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"/g;
  const out: Array<{ cx: number; cy: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    out.push({ cx: parseFloat(m[1]), cy: parseFloat(m[2]) });
  }
  return out;
}

describe("renderMapGraphSvg — empty state", () => {
  it("renders empty-state message when graph has no nodes", () => {
    const svg = renderMapGraphSvg({ nodes: [], edges: [] });
    expect(svg).toContain("No persona data yet");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("renders empty-state when only wiki nodes exist (no domains)", () => {
    const svg = renderMapGraphSvg({ nodes: [wiki("a", "Alpha")], edges: [] });
    expect(svg).toContain("No persona data yet");
  });
});

describe("renderMapGraphSvg — svg root", () => {
  it("root svg has explicit width/height (standalone image), viewBox 2400x3600, background rect", () => {
    const svg = renderMapGraphSvg({
      nodes: [domain("a", "A", 0.5)],
      edges: [],
    });
    expect(svg).toContain('width="2400"');
    expect(svg).toContain('height="3600"');
    expect(svg).toContain('viewBox="0 0 2400 3600"');
    expect(svg).not.toContain('width="100%"');
    expect(svg).not.toContain('id="cogmap"');
    expect(svg).not.toContain("background:#fff");
  });

  it("emits a full-canvas white background rect as the first child", () => {
    const svg = renderMapGraphSvg({
      nodes: [domain("a", "A", 0.5)],
      edges: [],
    });
    expect(svg).toContain('<rect width="2400" height="3600" fill="#fff"/>');
    const rootEnd = svg.indexOf('">') + 2;
    const firstChild = svg.slice(rootEnd, rootEnd + 40);
    expect(firstChild.startsWith('<rect width="2400"')).toBe(true);
  });

  it("scales physical dimensions with zoom (zoom=50 → 1200x1800)", () => {
    const svg = renderMapGraphSvg(
      { nodes: [domain("a", "A", 0.5)], edges: [] },
      { zoom: 50 },
    );
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="1800"');
    // viewBox stays fixed at the full canvas.
    expect(svg).toContain('viewBox="0 0 2400 3600"');
  });

  it("scales physical dimensions with zoom (zoom=200 → 4800x7200)", () => {
    const svg = renderMapGraphSvg(
      { nodes: [domain("a", "A", 0.5)], edges: [] },
      { zoom: 200 },
    );
    expect(svg).toContain('width="4800"');
    expect(svg).toContain('height="7200"');
  });
});

describe("renderMapGraphSvg — layer structure", () => {
  it("wraps domain nodes and edges in a domain-layer group", () => {
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.8), domain("ml", "ML", 0.6)],
      edges: [{ from: "ai", to: "ml", label: "related" }],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('<g id="domain-layer">');
    expect(svg).toContain("AI");
    expect(svg).toContain("ML");
  });

  it("wraps wiki nodes in a wiki-layer group (visible by default)", () => {
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.8), wiki("emb", "Embeddings")],
      edges: [],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('<g id="wiki-layer">');
    expect(svg).not.toContain('style="display:none"');
    expect(svg).toContain("Embeddings");
  });

  it("always emits a wiki-layer group even with no wiki nodes (default)", () => {
    const g: MapGraph = { nodes: [domain("ai", "AI", 0.8)], edges: [] };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('id="wiki-layer"');
  });
});

describe("renderMapGraphSvg — wiki option", () => {
  it("emits wiki-layer when wiki option is true (explicit)", () => {
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.8), wiki("emb", "Embeddings")],
      edges: [],
    };
    const svg = renderMapGraphSvg(g, { wiki: true });
    expect(svg).toContain('<g id="wiki-layer">');
    expect(svg).toContain("Embeddings");
  });

  it("defaults to wiki=true when option is omitted (backward compatible)", () => {
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.8), wiki("emb", "Embeddings")],
      edges: [],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('<g id="wiki-layer">');
  });

  it("omits the entire wiki-layer group when wiki=false", () => {
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.8), wiki("emb", "Embeddings")],
      edges: [],
    };
    const svg = renderMapGraphSvg(g, { wiki: false });
    expect(svg).not.toContain('<g id="wiki-layer"');
    expect(svg).not.toContain('id="wiki-layer"');
  });

  it("omits wiki node labels when wiki=false", () => {
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.8), wiki("emb", "Embeddings")],
      edges: [],
    };
    const svg = renderMapGraphSvg(g, { wiki: false });
    expect(svg).not.toContain("Embeddings");
    expect(svg).toContain("AI");
  });

  it("omits cross edges when wiki=false", () => {
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.9), wiki("w1", "W1")],
      edges: [{ from: "ai", to: "w1" }],
    };
    const svg = renderMapGraphSvg(g, { wiki: false });
    expect(svg).not.toContain('stroke-dasharray="3,2"');
  });

  it("still emits domain-layer and background rect when wiki=false", () => {
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.8)],
      edges: [],
    };
    const svg = renderMapGraphSvg(g, { wiki: false });
    expect(svg).toContain('<rect width="2400" height="3600" fill="#fff"/>');
    expect(svg).toContain('<g id="domain-layer">');
    expect(svg).toContain("AI");
    expect(svg).toContain("</svg>");
  });

  it("empty-state SVG still includes background rect", () => {
    const svg = renderMapGraphSvg({ nodes: [], edges: [] });
    expect(svg).toContain('<rect width="2400" height="3600" fill="#fff"/>');
    expect(svg).toContain("No persona data yet");
  });
});

describe("renderMapGraphSvg — force-directed positioning", () => {
  it("places all domain nodes within canvas bounds [50, 2350] x [50, 3550]", () => {
    const nodes: MapNode[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push(domain("d" + i, "D" + i, 0.5));
    }
    const g: MapGraph = { nodes, edges: [] };
    const svg = renderMapGraphSvg(g);
    const centers = extractCircleCenters(svg);
    expect(centers.length).toBe(10);
    for (const c of centers) {
      expect(c.cx).toBeGreaterThanOrEqual(50);
      expect(c.cx).toBeLessThanOrEqual(2350);
      expect(c.cy).toBeGreaterThanOrEqual(50);
      expect(c.cy).toBeLessThanOrEqual(3550);
    }
  });

  it("produces deterministic output (same input → same SVG)", () => {
    const g: MapGraph = {
      nodes: [domain("a", "A", 0.8), domain("b", "B", 0.6), domain("c", "C", 0.4)],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    };
    const svg1 = renderMapGraphSvg(g);
    const svg2 = renderMapGraphSvg(g);
    expect(svg1).toBe(svg2);
  });

  it("produces different layouts for different edge sets", () => {
    const nodes: MapNode[] = [domain("a", "A", 0.5), domain("b", "B", 0.5), domain("c", "C", 0.5)];
    const g1: MapGraph = { nodes, edges: [{ from: "a", to: "b" }] };
    const g2: MapGraph = { nodes, edges: [{ from: "a", to: "c" }] };
    const svg1 = renderMapGraphSvg(g1);
    const svg2 = renderMapGraphSvg(g2);
    // Different edges → different attractive forces → different positions.
    // The circle cx values should not all be identical between the two.
    const centers1 = extractCircleCenters(svg1).map((c) => c.cx);
    const centers2 = extractCircleCenters(svg2).map((c) => c.cx);
    expect(centers1).not.toEqual(centers2);
  });
});

describe("renderMapGraphSvg — variable node sizes", () => {
  it("renders domain circles with radius scaling by strength (20 + strength*30)", () => {
    const g: MapGraph = {
      nodes: [domain("weak", "Weak", 0.0), domain("strong", "Strong", 1.0)],
      edges: [],
    };
    const svg = renderMapGraphSvg(g);
    // strength 0.0 → radius 20; strength 1.0 → radius 50
    expect(svg).toContain('r="20"');
    expect(svg).toContain('r="50"');
  });

  it("renders domain circles with radius 35 for strength 0.5", () => {
    const g: MapGraph = { nodes: [domain("mid", "Mid", 0.5)], edges: [] };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('r="35"');
  });

  it("uses black fill (#000) for strong domains (strength >= 0.5)", () => {
    const g: MapGraph = { nodes: [domain("s", "Strong", 0.8)], edges: [] };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('fill="#000"');
  });

  it("uses lighter fill (#333) for weak domains (strength < 0.5)", () => {
    const g: MapGraph = { nodes: [domain("w", "Weak", 0.2)], edges: [] };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('fill="#333"');
  });

  it("renders wiki nodes with fixed radius 12 and gray fill (#999)", () => {
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.8), wiki("emb", "Embeddings")],
      edges: [],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('r="12"');
    expect(svg).toContain('fill="#999"');
  });

  it("renders domain labels with font-size 20 and bold", () => {
    const g: MapGraph = { nodes: [domain("ai", "AI", 0.8)], edges: [] };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('font-size="20"');
    expect(svg).toContain('font-weight="bold"');
  });

  it("renders wiki labels with font-size 12 and fill #666", () => {
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.8), wiki("emb", "Go")],
      edges: [],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('font-size="12"');
    expect(svg).toContain('fill="#666"');
  });
});

describe("renderMapGraphSvg — label truncation", () => {
  it("truncates wiki labels to 12 characters", () => {
    const longLabel = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 26 chars
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.8), wiki("long", longLabel)],
      edges: [],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain("ABCDEFGHIJKL"); // first 12 chars
    expect(svg).not.toContain("ABCDEFGHIJKLM"); // 13th char absent
  });

  it("does not truncate short wiki labels", () => {
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.8), wiki("short", "Go")],
      edges: [],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain(">Go<");
  });

  it("does not truncate domain labels (only wiki is truncated)", () => {
    const longLabel = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 26 chars
    const g: MapGraph = {
      nodes: [domain("long", longLabel, 0.8)],
      edges: [],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });
});

describe("renderMapGraphSvg — edge classification", () => {
  it("renders domain-domain edges as solid black (stroke-width 2)", () => {
    const g: MapGraph = {
      nodes: [domain("a", "A", 0.9), domain("b", "B", 0.9)],
      edges: [{ from: "a", to: "b" }],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('stroke="#000" stroke-width="2"');
  });

  it("renders wiki-wiki edges as light gray (stroke #ccc, width 0.5)", () => {
    const g: MapGraph = {
      nodes: [domain("a", "A", 0.9), wiki("w1", "W1"), wiki("w2", "W2")],
      edges: [{ from: "w1", to: "w2" }],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('stroke="#ccc" stroke-width="0.5"');
  });

  it("renders domain-wiki edges as dashed gray (stroke-dasharray 3,2)", () => {
    const g: MapGraph = {
      nodes: [domain("a", "A", 0.9), wiki("w1", "W1")],
      edges: [{ from: "a", to: "w1" }],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('stroke-dasharray="3,2"');
    expect(svg).toContain('stroke="#666"');
  });

  it("drops edges that reference filtered wiki nodes", () => {
    const nodes: MapNode[] = [domain("d", "D", 0.9)];
    for (let i = 0; i < MAX_WIKI_NODES + 5; i++) {
      nodes.push(wiki("w" + i, "WL" + i));
    }
    const g: MapGraph = {
      nodes,
      edges: [{ from: "d", to: "w" + (MAX_WIKI_NODES + 1) }],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).not.toContain('stroke-dasharray="3,2"');
  });

  it("drops edges that reference unknown endpoints", () => {
    const g: MapGraph = {
      nodes: [domain("a", "A", 0.5)],
      edges: [{ from: "a", to: "ghost" }],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).not.toContain("<line");
  });
});

describe("renderMapGraphSvg — wiki slicing", () => {
  it("slices wiki nodes to MAX_WIKI_NODES (60)", () => {
    const nodes: MapNode[] = [domain("d", "D", 0.9)];
    for (let i = 0; i < MAX_WIKI_NODES + 10; i++) {
      nodes.push(wiki("wnode" + i, "WN" + i));
    }
    const g: MapGraph = { nodes, edges: [] };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain("WN0");
    expect(svg).toContain("WN59");
    expect(svg).not.toContain("WN60");
  });

  it("exports MAX_WIKI_NODES = 60", () => {
    expect(MAX_WIKI_NODES).toBe(60);
  });
});

describe("renderMapGraphSvg — XML escaping", () => {
  it("escapes &, <, > in labels", () => {
    const g: MapGraph = {
      nodes: [domain("x", "A&B<C>", 0.5)],
      edges: [],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain("A&amp;B&lt;C&gt;");
    expect(svg).not.toContain("A&B<C>");
  });

  it("escapes quotes in labels", () => {
    const g: MapGraph = {
      nodes: [domain("q", 'Say "hi"', 0.5)],
      edges: [],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain("&quot;");
  });
});

describe("computeForceLayout — unit tests", () => {
  it("returns empty map for no nodes", () => {
    const pos = computeForceLayout([], [], 2400, 3600);
    expect(pos.size).toBe(0);
  });

  it("returns a position for each node", () => {
    const nodes = [domain("a", "A", 0.5), domain("b", "B", 0.5), domain("c", "C", 0.5)];
    const pos = computeForceLayout(nodes, [], 2400, 3600);
    expect(pos.size).toBe(3);
    expect(pos.has("a")).toBe(true);
    expect(pos.has("b")).toBe(true);
    expect(pos.has("c")).toBe(true);
  });

  it("places all nodes within canvas bounds", () => {
    const nodes: MapNode[] = [];
    for (let i = 0; i < 20; i++) {
      nodes.push(domain("n" + i, "N" + i, 0.5));
    }
    const pos = computeForceLayout(nodes, [], 2400, 3600);
    for (const p of pos.values()) {
      expect(p.x).toBeGreaterThanOrEqual(50);
      expect(p.x).toBeLessThanOrEqual(2350);
      expect(p.y).toBeGreaterThanOrEqual(50);
      expect(p.y).toBeLessThanOrEqual(3550);
    }
  });

  it("is deterministic (same input → same output)", () => {
    const nodes = [domain("a", "A", 0.5), domain("b", "B", 0.5)];
    const edges = [{ from: "a", to: "b" }];
    const pos1 = computeForceLayout(nodes, edges, 2400, 3600);
    const pos2 = computeForceLayout(nodes, edges, 2400, 3600);
    expect(pos1.get("a")).toEqual(pos2.get("a"));
    expect(pos1.get("b")).toEqual(pos2.get("b"));
  });

  it("completes in reasonable time for 80 nodes (performance)", () => {
    const nodes: MapNode[] = [];
    for (let i = 0; i < 80; i++) {
      nodes.push(domain("n" + i, "N" + i, 0.5));
    }
    const edges: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < 100; i++) {
      edges.push({ from: "n" + (i % 80), to: "n" + ((i + 1) % 80) });
    }
    const start = Date.now();
    computeForceLayout(nodes, edges, 2400, 3600);
    const elapsed = Date.now() - start;
    // Should complete in well under 100ms; allow generous headroom for CI.
    expect(elapsed).toBeLessThan(500);
  });
});
