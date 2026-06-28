/**
 * Unit tests for the inline SVG graph renderer.
 *
 * Verifies layout positioning, label truncation, strength-bar rendering,
 * edge classification, wiki-node slicing, and XML escaping — all without
 * touching the filesystem or the LLM.
 */
import { describe, it, expect } from "vitest";
import { renderMapGraphSvg, MAX_WIKI_NODES } from "./svg-graph.js";
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
  it("root svg has explicit width/height (standalone image), viewBox, background rect", () => {
    const svg = renderMapGraphSvg({
      nodes: [domain("a", "A", 0.5)],
      edges: [],
    });
    expect(svg).toContain('width="758"');
    expect(svg).toContain('height="1024"');
    expect(svg).toContain('viewBox="0 0 758 1024"');
    expect(svg).not.toContain('width="100%"');
    expect(svg).not.toContain('id="cogmap"');
    expect(svg).not.toContain("background:#fff");
  });

  it("emits a full-canvas white background rect as the first child", () => {
    const svg = renderMapGraphSvg({
      nodes: [domain("a", "A", 0.5)],
      edges: [],
    });
    expect(svg).toContain('<rect width="758" height="1024" fill="#fff"/>');
    const rootEnd = svg.indexOf('">') + 2;
    const firstChild = svg.slice(rootEnd, rootEnd + 40);
    expect(firstChild.startsWith('<rect width="758"')).toBe(true);
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
    expect(svg).not.toContain('stroke-dasharray="4,2"');
  });

  it("still emits domain-layer and background rect when wiki=false", () => {
    const g: MapGraph = {
      nodes: [domain("ai", "AI", 0.8)],
      edges: [],
    };
    const svg = renderMapGraphSvg(g, { wiki: false });
    expect(svg).toContain('<rect width="758" height="1024" fill="#fff"/>');
    expect(svg).toContain('<g id="domain-layer">');
    expect(svg).toContain("AI");
    expect(svg).toContain("</svg>");
  });

  it("empty-state SVG still includes background rect", () => {
    const svg = renderMapGraphSvg({ nodes: [], edges: [] });
    expect(svg).toContain('<rect width="758" height="1024" fill="#fff"/>');
    expect(svg).toContain("No persona data yet");
  });
});

describe("renderMapGraphSvg — node positioning", () => {
  it("places a single domain node at the top of the circle (379, 100)", () => {
    // angle = -PI/2 → x=379, y=400-300=100; box top-left = (279, 74)
    const g: MapGraph = { nodes: [domain("solo", "Solo", 0.5)], edges: [] };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('x="279"');
    expect(svg).toContain('y="74"');
  });

  it("places two domain nodes at top and bottom of the circle", () => {
    // node 0: angle -PI/2 → (379, 100); node 1: angle PI/2 → (379, 700)
    const g: MapGraph = {
      nodes: [domain("top", "Top", 0.9), domain("bot", "Bot", 0.8)],
      edges: [],
    };
    const svg = renderMapGraphSvg(g);
    // top node box y = 100 - 26 = 74
    expect(svg).toContain('y="74"');
    // bottom node box y = 700 - 26 = 674
    expect(svg).toContain('y="674"');
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

describe("renderMapGraphSvg — strength bar", () => {
  it("renders a 6px-wide strength bar with height 44 for strength 1.0", () => {
    const g: MapGraph = { nodes: [domain("s", "Strong", 1.0)], edges: [] };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('width="6"');
    expect(svg).toContain('height="44"');
  });

  it("renders a proportional bar (strength 0.5 → height 22)", () => {
    const g: MapGraph = { nodes: [domain("m", "Medium", 0.5)], edges: [] };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('height="22"');
  });

  it("renders height 0 for strength 0", () => {
    const g: MapGraph = { nodes: [domain("w", "Weak", 0)], edges: [] };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('height="0"');
  });

  it("clamps strength above 1.0 to bar height 44", () => {
    const g: MapGraph = { nodes: [domain("x", "X", 1.5)], edges: [] };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('height="44"');
  });
});

describe("renderMapGraphSvg — edge classification", () => {
  it("renders domain-domain edges as solid black (stroke-width 1.5)", () => {
    const g: MapGraph = {
      nodes: [domain("a", "A", 0.9), domain("b", "B", 0.9)],
      edges: [{ from: "a", to: "b" }],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('stroke="#000" stroke-width="1.5"');
    expect(svg).not.toContain("stroke-dasharray");
  });

  it("renders wiki-wiki edges as light gray (stroke #ccc, width 0.5)", () => {
    const g: MapGraph = {
      nodes: [domain("a", "A", 0.9), wiki("w1", "W1"), wiki("w2", "W2")],
      edges: [{ from: "w1", to: "w2" }],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('stroke="#ccc" stroke-width="0.5"');
  });

  it("renders domain-wiki edges as dashed gray (stroke-dasharray 4,2)", () => {
    const g: MapGraph = {
      nodes: [domain("a", "A", 0.9), wiki("w1", "W1")],
      edges: [{ from: "a", to: "w1" }],
    };
    const svg = renderMapGraphSvg(g);
    expect(svg).toContain('stroke-dasharray="4,2"');
    expect(svg).toContain('stroke="#666"');
  });

  it("drops edges that reference filtered wiki nodes", () => {
    // More than MAX_WIKI_NODES wiki nodes; edge targets a dropped one.
    const nodes: MapNode[] = [domain("d", "D", 0.9)];
    for (let i = 0; i < MAX_WIKI_NODES + 5; i++) {
      nodes.push(wiki("w" + i, "WL" + i));
    }
    const g: MapGraph = {
      nodes,
      edges: [{ from: "d", to: "w" + (MAX_WIKI_NODES + 1) }],
    };
    const svg = renderMapGraphSvg(g);
    // The dashed cross-edge should be absent (endpoint filtered out).
    expect(svg).not.toContain('stroke-dasharray="4,2"');
  });

  it("drops self-edges is the graph builder's job; renderer drops unknown endpoints", () => {
    const g: MapGraph = {
      nodes: [domain("a", "A", 0.5)],
      edges: [{ from: "a", to: "ghost" }], // "ghost" has no position
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
