/**
 * Cognitive map HTML template for Kindle Portal.
 *
 * Renders an ES5-compatible page with an inline SVG cognitive map. Vector
 * `<text>` elements stay crisp on Kindle WebKit at any zoom level — fixing
 * the blurry-PNG bug where the 16-gray quantization destroyed all labels.
 *
 * Features:
 *   - Inline SVG (rendered by `renderMapGraphSvg`) embedded in a container.
 *   - Zoom in/out buttons (A- / A+) that modify the SVG `viewBox`.
 *   - Wiki-layer toggle button that flips `<g id="wiki-layer">` visibility.
 *   - Auto-refresh via `<meta http-equiv="refresh">`.
 *
 * All HTML/script is built with `+` concatenation — no template literals —
 * so the rendered output passes `lintKindleHtml` (no backticks, no `=>`, no
 * `const`/`let`, no `fetch`). This page is self-contained: it does NOT use
 * shared-css.ts (the map has its own e-ink styling).
 */
import type { MapGraph } from "../types.js";
import type { KindleConfig } from "../config.js";
import { renderMapGraphSvg } from "./svg-graph.js";

/**
 * Build the cognitive-map HTML page for a graph.
 *
 * The SVG is rendered inline (not as an external PNG) so labels are crisp
 * vectors. The page reloads itself periodically via meta-refresh; zoom and
 * wiki-toggle are handled client-side in ES5.
 *
 * @param graph  The cognitive map graph (nodes + edges) to render.
 * @param cfg    Refresh interval and optional access token.
 */
export function renderMapHtml(
  graph: MapGraph,
  cfg: Pick<KindleConfig, "mapRefreshSeconds" | "accessToken">,
): string {
  var sec = String(cfg.mapRefreshSeconds);
  var tq = cfg.accessToken ? "?token=" + cfg.accessToken : "";

  // Node counts for the footer.
  var domainCount = 0;
  var wikiCount = 0;
  for (var i = 0; i < graph.nodes.length; i++) {
    if (graph.nodes[i].kind === "domain") domainCount++;
    else wikiCount++;
  }
  var edgeCount = graph.edges.length;

  var svg = renderMapGraphSvg(graph);

  return (
    "<!DOCTYPE html>"
    + '<html lang="en">'
    + "<head>"
    + '<meta charset="utf-8">'
    + '<meta http-equiv="refresh" content="' + sec + '">'
    + "<title>KaijiBot Cognitive Map</title>"
    + "<style>"
    + 'body { margin: 0; padding: 8px; background: #fff; color: #000;'
    + ' font-family: "Bookerly", "Palatino", serif; font-size: 18px;'
    + " line-height: 1.3; }"
    + ".head { border-bottom: 1px solid #000; padding: 4px 0; }"
    // clearfix for the floated tools — uses display:block (allowed on Kindle)
    + '.head::after { content: ""; display: block; clear: both; }'
    + ".title { font-size: 22px; font-weight: bold; }"
    + ".tools { float: right; margin-top: 4px; }"
    + '.tools button { font-size: 14px; margin-left: 4px; padding: 2px 8px;'
    + ' font-family: "Bookerly", "Palatino", serif; }'
    + "#svg-container { margin: 8px 0; }"
    + "#svg-container svg { width: 100%; height: auto; display: block;"
    + " border: 1px solid #999; }"
    + ".nav { margin: 8px 0; font-size: 14px; }"
    + ".nav a { color: #000; text-decoration: underline; }"
    + ".note { color: #555; font-size: 12px; margin-top: 8px; }"
    + ".footer { border-top: 1px solid #999; margin-top: 8px; padding-top: 4px;"
    + " font-size: 11px; color: #555; }"
    + "</style>"
    + "</head>"
    + "<body>"
    + '<div class="head">'
    // Floated tools come first in source order so the float clears correctly.
    + '<div class="tools">'
    + '<button onclick="zoomOut()">A-</button>'
    + '<button onclick="zoomIn()">A+</button>'
    + '<button onclick="toggleWiki()">Wiki</button>'
    + "</div>"
    + '<div class="title">Cognitive Map</div>'
    + "</div>"
    + '<div class="nav"><a href="/kindle/' + tq + '">Monitor</a></div>'
    + '<div id="svg-container">' + svg + "</div>"
    + '<div class="footer">'
    + domainCount + " domains, " + wikiCount + " wiki nodes, " + edgeCount + " edges"
    + " | Auto-refresh: " + sec + "s"
    + "</div>"
    + '<div class="note">Vector map. Use A-/A+ to zoom, Wiki to toggle concepts.'
    + " Read-only view of AI understanding.</div>"
    + "<script>"
    // ── Zoom: tracks a viewBox size ratio (1 = original).
    //    zoomIn multiplies ratio by 0.8 (see less → magnify), clamped so
    //    magnification never exceeds 2x (ratio floor 0.5).
    //    zoomOut multiplies by 1.25, clamped so magnification never drops
    //    below 0.3x (ratio ceiling 1/0.3 ≈ 3.333).
    + "var ORIG_W = 758;"
    + "var ORIG_H = 1024;"
    + "var ratio = 1;"
    + "function applyView() {"
    + 'var svgEl = document.getElementById("cogmap");'
    + "var w = ORIG_W * ratio;"
    + "var h = ORIG_H * ratio;"
    + "var x = (ORIG_W - w) / 2;"
    + "var y = (ORIG_H - h) / 2;"
    + 'svgEl.setAttribute("viewBox", x + " " + y + " " + w + " " + h);'
    + "}"
    + "function zoomIn() {"
    + "ratio = ratio * 0.8;"
    + "if (ratio < 0.5) ratio = 0.5;"
    + "applyView();"
    + "}"
    + "function zoomOut() {"
    + "ratio = ratio * 1.25;"
    + "if (ratio > 3.333) ratio = 3.333;"
    + "applyView();"
    + "}"
    // ── Wiki toggle: flips the wiki-layer group between hidden and visible.
    + "function toggleWiki() {"
    + 'var layer = document.getElementById("wiki-layer");'
    + 'if (layer.style.display === "none") {'
    + 'layer.style.display = "inline";'
    + "} else {"
    + 'layer.style.display = "none";'
    + "}"
    + "}"
    + "</script>"
    + "</body>"
    + "</html>"
  );
}
