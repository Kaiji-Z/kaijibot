/**
 * Cognitive map PNG renderer.
 *
 * Converts a `MapGraph` into a Kindle-friendly 16-grayscale PNG via a
 * three-tier fallback chain:
 *
 *   1. **graphviz-dot** — native `dot` binary (best quality, native fonts).
 *   2. **viz-js-wasm** — `@viz-js/viz` WASM build of Graphviz (no binary dep).
 *   3. **handrolled-svg** — minimal inline SVG with circular layout (degraded
 *      but always available; also used for the empty-graph onboarding screen).
 *
 * Whichever tier produces the SVG, sharp rasterizes it to a palette PNG
 * quantized to 16 grays — the optimal depth for Kindle e-ink displays.
 *
 * Design notes:
 * - The `dot` capability is probed once and cached module-level to avoid
 *   re-spawning on every render.
 * - `@viz-js/viz` is loaded via dynamic `import()` so the extension boots
 *   even when the package is absent; the import failure simply routes to
 *   the handrolled tier.
 * - Every tier boundary is wrapped so `renderGraphPng` never throws — a
 *   degraded image is always preferable to a broken map endpoint.
 */
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import type { MapEdge, MapGraph, MapNode, PngCapability } from "../types.js";

export interface RenderOpts {
  /** Output PNG width in pixels. Height auto-derived for Kindle aspect. */
  readonly pngWidth?: number;
}

export interface RenderResult {
  readonly buffer: Buffer;
  readonly capability: PngCapability;
}

/** Default PNG width (Kindle Paperwhite portrait viewport). */
const DEFAULT_WIDTH = 758;

/** Height/width ratio for Kindle e-ink portrait. */
const KINDLE_ASPECT = 1.334;

/** Hard cap on a single `dot` render to avoid hangs on pathological input. */
const DOT_RENDER_TIMEOUT_MS = 5000;

/** Probe timeout — shorter, since `dot -V` is near-instant when present. */
const DOT_PROBE_TIMEOUT_MS = 3000;

/** Allow up to 10 MB of SVG output from `dot`. */
const DOT_MAX_BUFFER = 10 * 1024 * 1024;

/** Max characters rendered in a handrolled node label before truncation. */
const LABEL_MAX_CHARS = 20;

/** Sentinel empty graph reused for onboarding / fallback paths. */
const EMPTY_GRAPH: MapGraph = { nodes: [], edges: [] };

/** Module-level cache for the `dot` binary probe. `null` = not yet probed. */
let dotAvailableCache: boolean | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// DOT source builder (pure, exported for unit testing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape a string for safe inclusion inside DOT double-quotes.
 * Per spec: `"` → `\"`. A literal backslash is escaped first so it cannot
 * swallow the following quote escape.
 */
function escapeDotString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Map a 0..1 strength to a Graphviz `gray<N>` level.
 * strength 1.0 → gray0 (black, strongest); strength 0.0 → gray15 (white).
 * Out-of-range / non-finite strength is clamped to [0, 1].
 */
function strengthToGray(strength: number): number {
  const s = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0.5;
  return Math.round((1 - s) * 15);
}

/**
 * Build a Graphviz DOT source string from a `MapGraph`. Pure — no I/O.
 *
 * Nodes are quoted (ids may contain spaces), strength drives `fillcolor`,
 * and edges are emitted as `->` pairs.
 */
export function buildDotSource(graph: MapGraph): string {
  const lines: string[] = [];
  lines.push("digraph kindle_map {");
  lines.push("  rankdir=LR;");
  lines.push('  node [shape=box, fontname="serif", fontsize=14, style=filled];');
  lines.push("  edge [color=gray70];");
  for (const node of graph.nodes) {
    if (node == null || typeof node.id !== "string" || typeof node.label !== "string") {continue;}
    const id = escapeDotString(node.id);
    const label = escapeDotString(node.label);
    const gray = strengthToGray(node.strength);
    lines.push(`  "${id}" [label="${label}", fillcolor="gray${gray}"];`);
  }
  for (const edge of graph.edges) {
    if (edge == null || typeof edge.from !== "string" || typeof edge.to !== "string") {continue;}
    if (edge.from === edge.to) {continue;}
    const from = escapeDotString(edge.from);
    const to = escapeDotString(edge.to);
    lines.push(`  "${from}" -> "${to}";`);
  }
  lines.push("}");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// dot binary capability probe (cached)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Probe whether the native `dot` binary is available. Result is cached for
 * the lifetime of the process — `dot -V` is deterministic and re-spawning
 * per render is wasteful.
 */
export function probeDotCapability(): boolean {
  if (dotAvailableCache !== null) {return dotAvailableCache;}
  try {
    execFileSync("dot", ["-V"], {
      timeout: DOT_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "ignore", "ignore"],
    });
    dotAvailableCache = true;
  } catch {
    dotAvailableCache = false;
  }
  return dotAvailableCache;
}

/** Reset the probe cache. Test-only — keeps tier assertions deterministic. */
export function __resetDotProbeCacheForTesting(): void {
  dotAvailableCache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 1: native `dot` binary
// ─────────────────────────────────────────────────────────────────────────────

/** Render DOT → SVG buffer via the native `dot` binary. Throws on failure. */
function renderWithDot(dotSource: string): Buffer {
  return execFileSync("dot", ["-Tsvg"], {
    input: dotSource,
    encoding: "buffer",
    timeout: DOT_RENDER_TIMEOUT_MS,
    maxBuffer: DOT_MAX_BUFFER,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 2: @viz-js/viz WASM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal shape of the `@viz-js/viz` API surface this renderer consumes.
 * Declared locally (rather than imported) because `@viz-js/viz` is an
 * optional dependency that may be absent at type-check time; the runtime
 * import degrades gracefully to the handrolled tier when the package is
 * missing.
 */
interface VizRenderer {
  renderString(input: string, options?: { readonly format?: string }): string;
}
interface VizModule {
  instance(): Promise<VizRenderer>;
}

/**
 * Module specifier for `@viz-js/viz`, intentionally typed as a widened
 * `string` (not the literal) so TypeScript treats `import(VIZ_MODULE)` as a
 * non-literal dynamic import. Non-literal dynamic imports return
 * `Promise<any>` without attempting module resolution, which means tsgo
 * does not require the package to be installed. The result is cast to the
 * local `VizModule` interface for type-safe usage.
 */
const VIZ_MODULE: string = "@viz-js/viz";

/**
 * Render DOT → SVG buffer via the `@viz-js/viz` WASM build. Returns `null`
 * if the package is unavailable or rendering fails (caller falls through).
 *
 * The dynamic import keeps the (sizeable) WASM module out of the boot path
 * and lets the extension run even when the package is not installed.
 */
async function renderWithVizJs(dotSource: string): Promise<Buffer | null> {
  try {
    const mod = (await import(VIZ_MODULE)) as VizModule;
    const viz = await mod.instance();
    const svgString = viz.renderString(dotSource, { format: "svg" });
    return Buffer.from(svgString, "utf-8");
  } catch (err) {
    console.warn(
      "png-renderer: @viz-js/viz unavailable or render failed, falling back —",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 3: handrolled SVG (also used for onboarding)
// ─────────────────────────────────────────────────────────────────────────────

/** Escape a string for safe inclusion in XML/SVG text content. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Truncate to `max` Unicode code points, appending an ellipsis if shortened. */
function truncateLabel(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) {return s;}
  return chars.slice(0, Math.max(0, max - 1)).join("") + "\u2026";
}

/** Build the empty-graph onboarding SVG. */
function buildOnboardingSvg(width: number, height: number): string {
  const cx = Math.round(width / 2);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<rect width="100%" height="100%" fill="white"/>`,
    `<text x="${cx}" y="500" text-anchor="middle" font-family="serif" font-size="20" fill="black">No persona yet.</text>`,
    `<text x="${cx}" y="540" text-anchor="middle" font-family="serif" font-size="16" fill="gray">Chat with KaijiBot to build your cognitive map.</text>`,
    `</svg>`,
  ].join("\n");
}

/**
 * Build a minimal SVG by hand. Nodes are placed on a circle around the
 * canvas centre; edges are straight lines between node centres. No layout
 * engine — this is the degraded-but-always-works tier. Also backs the
 * empty-graph onboarding screen.
 */
export function buildHandrolledSvg(graph: MapGraph, width = DEFAULT_WIDTH): string {
  const height = Math.round(width * KINDLE_ASPECT);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const validNodes = nodes.filter(
    (n): n is MapNode => n != null && typeof n.id === "string" && typeof n.label === "string",
  );

  if (validNodes.length === 0) {
    return buildOnboardingSvg(width, height);
  }

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 80;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`);
  parts.push(`<rect width="100%" height="100%" fill="white"/>`);

  const pos = new Map<string, { x: number; y: number }>();
  validNodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / validNodes.length - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    pos.set(node.id, { x: Math.round(x), y: Math.round(y) });
  });

  // Edges first so node boxes draw on top.
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  for (const edge of edges) {
    if (edge == null || typeof edge.from !== "string" || typeof edge.to !== "string") {continue;}
    const a = pos.get(edge.from);
    const b = pos.get(edge.to);
    if (a === undefined || b === undefined) {continue;}
    parts.push(
      `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="gray" stroke-width="1"/>`,
    );
  }

  for (const node of validNodes) {
    const p = pos.get(node.id);
    if (p === undefined) {continue;}
    const gray = strengthToGray(node.strength);
    const label = escapeXml(truncateLabel(node.label, LABEL_MAX_CHARS));
    const boxW = 120;
    const boxH = 30;
    const textColor = gray < 8 ? "white" : "black";
    parts.push(
      `<rect x="${p.x - boxW / 2}" y="${p.y - boxH / 2}" width="${boxW}" height="${boxH}" fill="gray${gray}" stroke="black" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${p.x}" y="${p.y + 5}" text-anchor="middle" font-family="serif" font-size="12" fill="${textColor}">${label}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Rasterize SVG → 16-gray PNG via sharp
// ─────────────────────────────────────────────────────────────────────────────

/** Sharp pipeline: resize + grayscale + quantize to 16 palette entries. */
async function rasterize(svgBuffer: Buffer, width: number): Promise<Buffer> {
  return sharp(svgBuffer)
    .resize({ width })
    .grayscale()
    .png({ colours: 16, palette: true, dither: 0 })
    .toBuffer();
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph sanitization (defensive — malformed input must not throw)
// ─────────────────────────────────────────────────────────────────────────────

/** Coerce arbitrary input into a well-formed (possibly empty) MapGraph. */
function sanitizeGraph(graph: MapGraph): MapGraph {
  if (graph == null || typeof graph !== "object") {return EMPTY_GRAPH;}
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const nodes = rawNodes.filter(
    (n): n is MapNode => n != null && typeof n.id === "string" && typeof n.label === "string",
  );
  const edges = rawEdges.filter(
    (e): e is MapEdge => e != null && typeof e.from === "string" && typeof e.to === "string",
  );
  return { nodes, edges };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry: renderGraphPng
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the best SVG tier for the (sanitized) graph. Returns the SVG
 * buffer and the tier that produced it.
 */
async function resolveSvg(
  graph: MapGraph,
  width: number,
): Promise<{ svg: Buffer; capability: PngCapability }> {
  if (graph.nodes.length === 0) {
    return {
      svg: Buffer.from(buildHandrolledSvg(EMPTY_GRAPH, width), "utf-8"),
      capability: "handrolled-svg",
    };
  }

  const dotSource = buildDotSource(graph);

  // Tier 1: native dot.
  if (probeDotCapability()) {
    try {
      return { svg: renderWithDot(dotSource), capability: "graphviz-dot" };
    } catch (err) {
      console.warn(
        "png-renderer: native dot render failed, trying viz-js —",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Tier 2: viz-js wasm.
  const vizSvg = await renderWithVizJs(dotSource);
  if (vizSvg !== null) {
    return { svg: vizSvg, capability: "viz-js-wasm" };
  }

  // Tier 3: handrolled.
  return {
    svg: Buffer.from(buildHandrolledSvg(graph, width), "utf-8"),
    capability: "handrolled-svg",
  };
}

/**
 * Render a `MapGraph` to a 16-gray PNG buffer suitable for Kindle e-ink.
 *
 * Never throws: malformed graphs, missing binaries, and failed WASM all
 * degrade gracefully to the handrolled SVG (or the onboarding screen for
 * empty graphs). The returned `capability` records which tier produced the
 * final image for operator visibility.
 */
export async function renderGraphPng(
  graph: MapGraph,
  opts?: RenderOpts,
): Promise<RenderResult> {
  const width = opts?.pngWidth ?? DEFAULT_WIDTH;
  const safeGraph = sanitizeGraph(graph);

  try {
    const { svg, capability } = await resolveSvg(safeGraph, width);
    const buffer = await rasterize(svg, width);
    return { buffer, capability };
  } catch (err) {
    // Absolute last resort: onboarding SVG → PNG. If even sharp fails we
    // return the raw SVG buffer so the caller still gets bytes.
    console.warn(
      "png-renderer: render pipeline failed, returning onboarding fallback —",
      err instanceof Error ? err.message : String(err),
    );
    const fallbackSvg = Buffer.from(buildHandrolledSvg(EMPTY_GRAPH, width), "utf-8");
    try {
      const buffer = await rasterize(fallbackSvg, width);
      return { buffer, capability: "handrolled-svg" };
    } catch {
      return { buffer: fallbackSvg, capability: "handrolled-svg" };
    }
  }
}
