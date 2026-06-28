/**
 * Standalone SVG renderer for the cognitive map graph.
 *
 * Converts a {@link MapGraph} into a crisp vector SVG string served as a
 * standalone image via `/kindle/api/map.svg` and referenced by the map page
 * through an `<img>` tag. Kindle Paperwhite ≤5.16.3 silently ignores inline
 * `<svg>` tags embedded in HTML but DOES render `<img src="*.svg">`, so the
 * SVG carries explicit width/height and a white background rect.
 *
 * Layout: Fruchterman-Reingold force-directed algorithm. Connected nodes
 * cluster together (attractive springs), all nodes repel each other (charged
 * particles). After 200 iterations with temperature cooling, the graph
 * settles into a natural Obsidian-like knowledge-graph layout where related
 * domains cluster and isolated concepts drift apart. Node positions are
 * deterministic (seeded PRNG) — same input always produces the same output.
 *
 * Canvas: 2400×3600 — much larger than the Kindle viewport (758px) for an
 * "infinite graph" feel. The page's scroll container pans over the SVG.
 *
 * The wiki layer can be omitted entirely via `opts.wiki === false` for a
 * lighter payload when the user has toggled wiki off.
 *
 * Pure function — no I/O, no side effects. All string assembly uses `+`
 * concatenation so the embedded output stays free of backticks.
 */
import type { MapGraph, MapNode, MapEdge } from "../types.js";

/**
 * Maximum wiki nodes rendered in the SVG.
 *
 * Wiki vaults can contain 400+ nodes; rendering all of them would overload
 * the Kindle's limited DOM. We slice to the first 60 and filter edges to
 * match. This prevents Kindle DOM overload.
 */
export const MAX_WIKI_NODES = 60;

// ── Canvas / layout constants ──
// Canvas is 2400×3600 — much larger than the Kindle viewport for an
// "infinite graph" feel. The page's scroll container pans over the SVG.
const CANVAS_W = 2400;
const CANVAS_H = 3600;

// ── Force-directed layout constants ──
// Seed for the deterministic PRNG — same input always produces same output.
const LAYOUT_SEED = 42;
// Number of Fruchterman-Reingold iterations. 200 balances quality and speed
// (~50ms for 80 nodes on a modern CPU).
const LAYOUT_ITERATIONS = 200;
// Margin from canvas edges to keep nodes from being clipped.
const LAYOUT_MARGIN = 80;
// Gravity strength — pulls nodes toward canvas center, preventing boundary
// clustering in sparse graphs (few edges → repulsion dominates without this).
const LAYOUT_GRAVITY = 0.12;
// Repulsion scale factor — reduces optimal distance so nodes pack tighter
// (default FR uses k=sqrt(area/n); we scale by 0.5 for denser clusters).
const K_SCALE = 0.3;

// ── Label limit for wiki nodes ──
const WIKI_LABEL_MAX = 12;

// ── Edge stroke styles ──
// Domain-to-domain: thick black (most important relationship).
const STYLE_DOMAIN_EDGE = 'stroke="#000" stroke-width="2"';
// Domain-to-wiki: medium dashed gray (cross-layer reference).
const STYLE_CROSS_EDGE = 'stroke="#666" stroke-width="1" stroke-dasharray="3,2"';
// Wiki-to-wiki: thin faint (secondary relationship).
const STYLE_WIKI_EDGE = 'stroke="#ccc" stroke-width="0.5"';

const EMPTY_MESSAGE =
  "No persona data yet. Chat with KaijiBot to build your cognitive map.";

/** Escape a string for safe inclusion in XML/SVG text content and attributes. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Truncate a label to `max` characters (no ellipsis — circles are small). */
function truncateLabel(label: string, max: number): string {
  return label.length > max ? label.substring(0, max) : label;
}

/** Clamp a number to [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Round to 1 decimal place and return as string (strips trailing zeros). */
function r1(v: number): string {
  return String(Math.round(v * 10) / 10);
}

interface Pt {
  readonly x: number;
  readonly y: number;
}

/**
 * Seeded pseudo-random number generator (Linear Congruential Generator).
 *
 * Produces a deterministic sequence of floats in [0, 1) from a fixed seed.
 * Used by {@link computeForceLayout} to initialize node positions so the
 * same input graph always produces the same layout.
 */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

/**
 * Fruchterman-Reingold force-directed graph layout.
 *
 * Repulsive forces push all node pairs apart (like charged particles);
 * attractive forces pull connected nodes together (like springs). After
 * {@link LAYOUT_ITERATIONS} iterations with temperature cooling, the graph
 * settles into a natural layout where related nodes cluster and isolated
 * concepts drift apart — an Obsidian-like knowledge graph.
 *
 * Deterministic: same input always produces the same output (seeded PRNG
 * with fixed seed {@link LAYOUT_SEED}).
 *
 * Complexity: O(iterations × (N² + E)) where N = node count, E = edge count.
 * For N=80, E=100, iterations=200: ~1.3M operations, completes in <50ms.
 *
 * @param nodes   All nodes participating in the layout.
 * @param edges   Edges (attractive forces). Endpoints not in `nodes` are
 *                silently dropped. Self-edges are ignored.
 * @param width   Canvas width for the layout area.
 * @param height  Canvas height for the layout area.
 * @returns Map of node id → settled {x, y} position. Empty if no nodes.
 */
export function computeForceLayout(
  nodes: readonly MapNode[],
  edges: readonly MapEdge[],
  width: number,
  height: number,
): Map<string, Pt> {
  const result = new Map<string, Pt>();
  const n = nodes.length;
  if (n === 0) return result;

  // Optimal distance between nodes — balances repulsion and attraction.
  const k = Math.sqrt((width * height) / n) * K_SCALE;
  // Initial max displacement — controls how far nodes can move per iteration.
  let temperature = width / 10;

  // Initialize positions with seeded random across the full canvas.
  const rng = createSeededRandom(LAYOUT_SEED);
  const xs: number[] = new Array(n);
  const ys: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = rng() * width;
    ys[i] = rng() * height;
  }

  // Build id → array-index lookup and resolve edges to index pairs.
  const idToIdx = new Map<string, number>();
  for (let i = 0; i < n; i++) idToIdx.set(nodes[i].id, i);
  const edgePairs: Array<[number, number]> = [];
  for (const e of edges) {
    const a = idToIdx.get(e.from);
    const b = idToIdx.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) {
      edgePairs.push([a, b]);
    }
  }

  // Displacement accumulators (reused per iteration to avoid GC pressure).
  const dispX: number[] = new Array(n);
  const dispY: number[] = new Array(n);

  for (let iter = 0; iter < LAYOUT_ITERATIONS; iter++) {
    // Reset displacements.
    for (let i = 0; i < n; i++) {
      dispX[i] = 0;
      dispY[i] = 0;
    }

    // ── Repulsive forces (all pairs) ──
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = xs[i] - xs[j];
        const dy = ys[i] - ys[j];
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.1) dist = 0.1; // avoid division by zero
        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        dispX[i] += fx;
        dispY[i] += fy;
        dispX[j] -= fx;
        dispY[j] -= fy;
      }
    }

    // ── Attractive forces (connected pairs only) ──
    for (let p = 0; p < edgePairs.length; p++) {
      const i = edgePairs[p][0];
      const j = edgePairs[p][1];
      const dx = xs[i] - xs[j];
      const dy = ys[i] - ys[j];
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.1) dist = 0.1;
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      dispX[i] -= fx;
      dispY[i] -= fy;
      dispX[j] += fx;
      dispY[j] += fy;
    }

    // ── Gravity (pull toward center — prevents boundary clustering) ──
    const gcx = width / 2;
    const gcy = height / 2;
    for (let i = 0; i < n; i++) {
      dispX[i] += LAYOUT_GRAVITY * (gcx - xs[i]);
      dispY[i] += LAYOUT_GRAVITY * (gcy - ys[i]);
    }

    // ── Apply displacements with temperature limit ──
    for (let i = 0; i < n; i++) {
      const dx = dispX[i];
      const dy = dispY[i];
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.1) dist = 0.1;
      const limited = Math.min(dist, temperature);
      xs[i] += (dx / dist) * limited;
      ys[i] += (dy / dist) * limited;
      // Keep within canvas bounds (with margin so labels aren't clipped).
      xs[i] = clamp(xs[i], LAYOUT_MARGIN, width - LAYOUT_MARGIN);
      ys[i] = clamp(ys[i], LAYOUT_MARGIN, height - LAYOUT_MARGIN);
    }

    // ── Cool down (reduce max displacement each iteration) ──
    temperature = temperature * (1 - iter / LAYOUT_ITERATIONS);
  }

  // Freeze results into the output map.
  for (let i = 0; i < n; i++) {
    result.set(nodes[i].id, { x: xs[i], y: ys[i] });
  }
  return result;
}

/**
 * Build an `<svg>` root opening tag with physical dimensions scaled by
 * `zoomFactor` while keeping the viewBox fixed at "0 0 2400 3600".
 *
 * The browser scales the rendered SVG to the specified width/height, which
 * is what Kindle's `<img src="*.svg">` renderer honors. A zoom of 50
 * produces a 1200×1800 SVG that fits more of the graph on screen; zoom=200
 * produces a 4800×7200 SVG that the scroll container pans over.
 */
function buildSvgRootOpen(zoomFactor: number): string {
  const w = Math.round(CANVAS_W * zoomFactor);
  const h = Math.round(CANVAS_H * zoomFactor);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    w +
    '" height="' +
    h +
    '" viewBox="0 0 ' +
    CANVAS_W +
    " " +
    CANVAS_H +
    '">'
  );
}

// White background rect — the FIRST child of the SVG root. Kindle's SVG
// renderer (used when the SVG is loaded via <img src="...svg">) ignores CSS
// `background:#fff` on the root element, so we paint a full-canvas rect.
const SVG_BG_RECT =
  '<rect width="' + CANVAS_W + '" height="' + CANVAS_H + '" fill="#fff"/>';

/**
 * Render a domain node as an SVG fragment: filled circle + bold label.
 *
 * Circle radius scales with strength: `20 + strength × 30` (range 20–50px).
 * Stronger domains render as larger circles. Fill is solid black (`#000`)
 * for strength ≥ 0.5, lighter (`#333`) for weaker domains.
 *
 * Label is 20px bold black, horizontally centered, positioned below the
 * circle (y = center + radius + 18).
 */
function renderDomainNode(n: MapNode, cx: number, cy: number): string {
  const strength = clamp(n.strength, 0, 1);
  const radius = 20 + strength * 30;
  const fill = strength < 0.5 ? "#333" : "#000";
  const labelY = Math.round(cy + radius + 18);
  return (
    '<circle cx="' +
    r1(cx) +
    '" cy="' +
    r1(cy) +
    '" r="' +
    r1(radius) +
    '" fill="' +
    fill +
    '"/>' +
    '<text x="' +
    r1(cx) +
    '" y="' +
    labelY +
    '" text-anchor="middle" font-size="20" font-weight="bold" fill="#000" font-family="serif">' +
    escapeXml(n.label) +
    "</text>"
  );
}

/**
 * Render a wiki node as an SVG fragment: small gray circle + label.
 *
 * Fixed radius 12px (secondary, smaller than domain nodes). Fill `#999`
 * (gray). Label is 12px `#666`, truncated to {@link WIKI_LABEL_MAX} chars,
 * positioned below the circle.
 */
function renderWikiNode(n: MapNode, cx: number, cy: number): string {
  const radius = 12;
  const labelY = Math.round(cy + radius + 18);
  const label = escapeXml(truncateLabel(n.label, WIKI_LABEL_MAX));
  return (
    '<circle cx="' +
    r1(cx) +
    '" cy="' +
    r1(cy) +
    '" r="' +
    radius +
    '" fill="#999"/>' +
    '<text x="' +
    r1(cx) +
    '" y="' +
    labelY +
    '" text-anchor="middle" font-size="12" fill="#666" font-family="serif">' +
    label +
    "</text>"
  );
}

/** Render an edge `<line>` between two points with the given style fragment. */
function renderLine(a: Pt, b: Pt, style: string): string {
  return (
    '<line x1="' +
    r1(a.x) +
    '" y1="' +
    r1(a.y) +
    '" x2="' +
    r1(b.x) +
    '" y2="' +
    r1(b.y) +
    '" ' +
    style +
    "/>"
  );
}

/**
 * Convert a {@link MapGraph} into a standalone SVG string.
 *
 * Node positions are computed by the Fruchterman-Reingold force-directed
 * algorithm ({@link computeForceLayout}). All visible nodes (domain + wiki,
 * or domain-only when wiki is off) participate in a single simulation so
 * connected nodes cluster together regardless of kind.
 *
 * Node kinds:
 *   - `domain`: large circle (radius 20–50px by strength), black fill, bold
 *     20px label. The primary visual layer.
 *   - `concept` / `entity` (collectively "wiki"): small 12px gray circle,
 *     12px label. The secondary layer.
 *
 * Edge styles (classified by endpoint kinds):
 *   - domain ↔ domain: thick solid black (`stroke-width=2`).
 *   - domain ↔ wiki: medium dashed gray (`stroke-dasharray=3,2`).
 *   - wiki ↔ wiki: thin faint gray (`stroke-width=0.5`).
 *
 * When wiki nodes exceed {@link MAX_WIKI_NODES}, only the first 60 are
 * rendered and edges referencing dropped nodes are filtered out.
 *
 * When `opts.wiki === false`, the wiki layer (wiki nodes, wiki-wiki edges,
 * and cross-domain-wiki edges) is omitted entirely — producing a lighter
 * SVG and a domain-only force layout. Default is `wiki: true`.
 *
 * When `opts.zoom` is provided (e.g. 50), the SVG root's physical width and
 * height are scaled proportionally while the viewBox stays fixed at
 * "0 0 2400 3600". The browser scales the rendered SVG to the new size,
 * producing a zoom effect for the Kindle `<img>` renderer.
 *
 * @param graph   The cognitive map graph (nodes + edges).
 * @param opts    Optional: `width` (reserved), `wiki` (boolean, default true)
 *                controlling wiki-layer emission, and `zoom` (number, default
 *                100) controlling physical SVG dimensions.
 * @returns A complete `<svg>...</svg>` string with a white background rect
 *          as the first child.
 */
export function renderMapGraphSvg(
  graph: MapGraph,
  opts?: { width?: number; wiki?: boolean; zoom?: number },
): string {
  const includeWiki = opts?.wiki !== false;
  const zoomFactor = (opts?.zoom ?? 100) / 100;
  const svgOpen = buildSvgRootOpen(zoomFactor);
  const nodes = graph.nodes;

  // Partition nodes by kind.
  const domainNodes: MapNode[] = [];
  const wikiNodesAll: MapNode[] = [];
  for (const n of nodes) {
    if (n.kind === "domain") domainNodes.push(n);
    else wikiNodesAll.push(n);
  }

  // Slice wiki nodes to prevent Kindle DOM overload (see MAX_WIKI_NODES).
  const wikiNodes = wikiNodesAll.slice(0, MAX_WIKI_NODES);

  // ── Empty state: no domain nodes → centered message ──
  if (domainNodes.length === 0) {
    return (
      svgOpen +
      SVG_BG_RECT +
      '<text x="' +
      CANVAS_W / 2 +
      '" y="' +
      CANVAS_H / 2 +
      '" text-anchor="middle" font-size="18" fill="#333" font-family="serif">' +
      escapeXml(EMPTY_MESSAGE) +
      "</text></svg>"
    );
  }

  // ── Compute force-directed layout ──
  // All visible nodes participate in one simulation so connected nodes
  // cluster together regardless of kind. When wiki is off, only domain
  // nodes participate (lighter layout, fewer repulsive pairs).
  const layoutNodes: MapNode[] = includeWiki
    ? [...domainNodes, ...wikiNodes]
    : domainNodes;
  const pos = computeForceLayout(layoutNodes, graph.edges, CANVAS_W, CANVAS_H);

  // Kind set for edge classification.
  const isDomainId = new Set<string>();
  for (const d of domainNodes) isDomainId.add(d.id);

  // ── Classify edges by endpoint kinds, dropping any that reference
  //    filtered (out-of-cap) wiki nodes. ──
  const domainEdges: string[] = [];
  const wikiEdges: string[] = [];
  const crossEdges: string[] = [];
  for (const e of graph.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (a === undefined || b === undefined) continue; // dropped node
    const aDom = isDomainId.has(e.from);
    const bDom = isDomainId.has(e.to);
    if (aDom && bDom) {
      domainEdges.push(renderLine(a, b, STYLE_DOMAIN_EDGE));
    } else if (!aDom && !bDom) {
      wikiEdges.push(renderLine(a, b, STYLE_WIKI_EDGE));
    } else {
      crossEdges.push(renderLine(a, b, STYLE_CROSS_EDGE));
    }
  }

  // ── Render domain node fragments ──
  const domainNodeSvg: string[] = [];
  for (const d of domainNodes) {
    const p = pos.get(d.id);
    if (p !== undefined) domainNodeSvg.push(renderDomainNode(d, p.x, p.y));
  }

  // ── Render wiki node fragments ──
  const wikiNodeSvg: string[] = [];
  for (const w of wikiNodes) {
    const p = pos.get(w.id);
    if (p !== undefined) wikiNodeSvg.push(renderWikiNode(w, p.x, p.y));
  }

  // Domain layer: edges first (under nodes), then nodes.
  const domainLayer =
    '<g id="domain-layer">' + domainEdges.join("") + domainNodeSvg.join("") + "</g>";

  if (!includeWiki) {
    return svgOpen + SVG_BG_RECT + domainLayer + "</svg>";
  }

  const wikiLayer =
    '<g id="wiki-layer">' +
    wikiEdges.join("") +
    crossEdges.join("") +
    wikiNodeSvg.join("") +
    "</g>";

  return svgOpen + SVG_BG_RECT + domainLayer + wikiLayer + "</svg>";
}
