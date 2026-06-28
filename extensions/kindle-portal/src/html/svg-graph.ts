/**
 * Standalone SVG renderer for the cognitive map graph.
 *
 * Converts a {@link MapGraph} into a crisp vector SVG string served as a
 * standalone image via `/kindle/api/map.svg` and referenced by the map page
 * through an `<img>` tag. Kindle Paperwhite ≤5.16.3 silently ignores inline
 * `<svg>` tags embedded in HTML but DOES render `<img src="*.svg">`, so the
 * SVG carries explicit width/height (758x1024) and a white background rect.
 *
 * Layout: domain nodes on an inner circle, wiki nodes on an outer ring.
 * The wiki layer can be omitted entirely via `opts.wiki === false` for a
 * lighter payload when the user has toggled wiki off.
 *
 * Pure function — no I/O, no side effects. All string assembly uses `+`
 * concatenation so the embedded output stays free of backticks.
 */
import type { MapGraph, MapNode } from "../types.js";

/**
 * Maximum wiki nodes rendered in the SVG.
 *
 * Wiki vaults can contain 400+ nodes; rendering all of them would overload
 * the Kindle's limited DOM. We slice to the first 60 and filter edges to
 * match. This prevents Kindle DOM overload.
 */
export const MAX_WIKI_NODES = 60;

// ── Canvas / layout constants ──
// Canvas is 758 x 1024 (Kindle Paperwhite portrait, minus header space).
const CANVAS_W = 758;
const CANVAS_H = 1024;
const CENTER_X = 379;
const CENTER_Y = 400;
const DOMAIN_RADIUS = 300;
const WIKI_RADIUS = 430;

// ── Node box dimensions ──
// Boxes are sized to fit the larger label fonts (20px domain / 14px wiki)
// so text doesn't overflow at 100% zoom. Scaling happens at the SVG root
// via the `zoom` option, not inside these constants.
const DOMAIN_W = 200;
const DOMAIN_H = 52;
const WIKI_W = 120;
const WIKI_H = 32;

// ── Label limit for wiki nodes ──
const WIKI_LABEL_MAX = 12;

// ── Edge stroke styles ──
const STYLE_DOMAIN_EDGE = 'stroke="#000" stroke-width="1.5"';
const STYLE_WIKI_EDGE = 'stroke="#ccc" stroke-width="0.5"';
const STYLE_CROSS_EDGE = 'stroke="#666" stroke-width="1" stroke-dasharray="4,2"';

/**
 * Build an `<svg>` root opening tag with physical dimensions scaled by
 * `zoomFactor` while keeping the viewBox fixed at "0 0 758 1024".
 *
 * The browser scales the rendered SVG to the specified width/height, which
 * is what Kindle's `<img src="*.svg">` renderer honors. A zoom of 200
 * produces a 1516x2048 SVG that the surrounding scroll container pans over.
 */
function buildSvgRootOpen(zoomFactor: number): string {
  var w = Math.round(CANVAS_W * zoomFactor);
  var h = Math.round(CANVAS_H * zoomFactor);
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

/** Truncate a label to `max` characters (no ellipsis — boxes are small). */
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
 * Render a domain node as an SVG fragment: box + strength bar + label.
 *
 * The strength bar is a 6px-wide black rect on the left edge of the box,
 * with height proportional to the node's strength (0..1 → 0..36px).
 * Label is 16px bold black, horizontally centered.
 */
function renderDomainNode(n: MapNode, cx: number, cy: number): string {
  const left = cx - DOMAIN_W / 2;
  const top = cy - DOMAIN_H / 2;
  const barH = Math.round(clamp(n.strength, 0, 1) * 44);
  const barY = top + (DOMAIN_H - barH) / 2;
  const textY = Math.round(cy + 7); // baseline offset for ~vertical centering of 20px font
  return (
    '<rect x="' +
    r1(left) +
    '" y="' +
    r1(top) +
    '" width="' +
    DOMAIN_W +
    '" height="' +
    DOMAIN_H +
    '" fill="#fff" stroke="#000" stroke-width="2"/>' +
    '<rect x="' +
    r1(left) +
    '" y="' +
    r1(barY) +
    '" width="6" height="' +
    barH +
    '" fill="#000"/>' +
    '<text x="' +
    r1(cx) +
    '" y="' +
    textY +
    '" text-anchor="middle" font-size="20" font-weight="bold" fill="#000" font-family="serif">' +
    escapeXml(n.label) +
    "</text>"
  );
}

/** Render a wiki node as an SVG fragment: box + truncated label. */
function renderWikiNode(n: MapNode, cx: number, cy: number): string {
  const left = cx - WIKI_W / 2;
  const top = cy - WIKI_H / 2;
  const textY = Math.round(cy + 5); // baseline offset for 14px font
  const label = escapeXml(truncateLabel(n.label, WIKI_LABEL_MAX));
  return (
    '<rect x="' +
    r1(left) +
    '" y="' +
    r1(top) +
    '" width="' +
    WIKI_W +
    '" height="' +
    WIKI_H +
    '" fill="#f0f0f0" stroke="#999" stroke-width="1"/>' +
    '<text x="' +
    r1(cx) +
    '" y="' +
    textY +
    '" text-anchor="middle" font-size="14" fill="#333" font-family="serif">' +
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
 * Domain nodes (kind="domain") are placed on an inner circle of radius 300
 * centered at (379, 400). Wiki nodes (kind="concept"|"entity") are placed on
 * an outer ring of radius 430. Edges are classified by endpoint kinds into
 * three styles.
 *
 * When wiki nodes exceed {@link MAX_WIKI_NODES}, only the first 60 are
 * rendered and edges referencing dropped nodes are filtered out.
 *
 * When `opts.wiki === false`, the wiki layer (wiki nodes, wiki-wiki edges,
 * and cross-domain-wiki edges) is omitted entirely — producing a lighter
 * SVG for the toggle-off case. Default is `wiki: true` (backward compatible).
 *
 * When `opts.zoom` is provided (e.g. 200), the SVG root's physical width and
 * height are scaled proportionally while the viewBox stays fixed at
 * "0 0 758 1024". The browser scales the rendered SVG to the new size,
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

  // Position lookup: id → center point. Kind set for edge classification.
  const pos = new Map<string, Pt>();
  const isDomainId = new Set<string>();
  for (const d of domainNodes) isDomainId.add(d.id);

  const dn = domainNodes.length;
  for (let i = 0; i < dn; i++) {
    // Start at top (12 o'clock), proceed clockwise.
    const angle = (i / dn) * 2 * Math.PI - Math.PI / 2;
    pos.set(domainNodes[i].id, {
      x: CENTER_X + DOMAIN_RADIUS * Math.cos(angle),
      y: CENTER_Y + DOMAIN_RADIUS * Math.sin(angle),
    });
  }

  const wn = wikiNodes.length;
  for (let i = 0; i < wn; i++) {
    // Start at right (3 o'clock), proceed counterclockwise around outer ring.
    const angle = (i / wn) * 2 * Math.PI;
    pos.set(wikiNodes[i].id, {
      x: CENTER_X + WIKI_RADIUS * Math.cos(angle),
      y: CENTER_Y + WIKI_RADIUS * Math.sin(angle),
    });
  }

  // ── Empty state: no domain nodes → centered message ──
  if (dn === 0) {
    return (
      svgOpen +
      SVG_BG_RECT +
      '<text x="' +
      CENTER_X +
      '" y="512" text-anchor="middle" font-size="18" fill="#333" font-family="serif">' +
      escapeXml(EMPTY_MESSAGE) +
      "</text></svg>"
    );
  }

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
  for (let i = 0; i < dn; i++) {
    const p = pos.get(domainNodes[i].id);
    if (p !== undefined) domainNodeSvg.push(renderDomainNode(domainNodes[i], p.x, p.y));
  }

  // ── Render wiki node fragments ──
  const wikiNodeSvg: string[] = [];
  for (let i = 0; i < wn; i++) {
    const p = pos.get(wikiNodes[i].id);
    if (p !== undefined) wikiNodeSvg.push(renderWikiNode(wikiNodes[i], p.x, p.y));
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
