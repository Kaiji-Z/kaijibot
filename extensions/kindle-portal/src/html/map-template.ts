/**
 * Cognitive map HTML template for Kindle Portal.
 *
 * Renders an ES5-compatible page that displays the cognitive map as a
 * standalone SVG image via `<img src="/kindle/api/map.svg">`. Kindle
 * Paperwhite ≤5.16.3 silently ignores inline `<svg>` tags embedded in HTML,
 * but it DOES render `<img src="*.svg">` — so the SVG is served by a
 * separate endpoint and referenced here as a regular image.
 *
 * Features:
 *   - `<img>` tag pointing at `/kindle/api/map.svg` (token-aware).
 *   - Zoom in/out buttons (A- / A+) that scale the image width via CSS.
 *   - Wiki-toggle button that rebuilds the img src with `?wiki=1`.
 *   - Auto-refresh via `<meta http-equiv="refresh">`.
 *
 * All HTML/script is built with `+` concatenation — no template literals —
 * so the rendered output passes `lintKindleHtml` (no backticks, no `=>`, no
 * `const`/`let`, no `fetch`). This page is self-contained: it does NOT use
 * shared-css.ts (the map has its own e-ink styling).
 */
import type { KindleConfig } from "../config.js";

/**
 * Build the cognitive-map HTML page.
 *
 * The SVG itself is built independently by the `/kindle/api/map.svg`
 * endpoint, so this template no longer receives a graph — it only needs the
 * refresh interval and optional access token to assemble the img URL and
 * meta-refresh tag.
 *
 * @param cfg  Refresh interval and optional access token.
 */
export function renderMapHtml(
  cfg: Pick<KindleConfig, "mapRefreshSeconds" | "accessToken">,
): string {
  var sec = String(cfg.mapRefreshSeconds);
  var tq = cfg.accessToken ? "?token=" + cfg.accessToken : "";

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
    + ".scroller { overflow: auto; width: 100%; height: 860px;"
    + " margin: 8px 0; }"
    + "#mapimg { width: 100%; border: 1px solid #999; }"
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
    + '<div class="scroller">'
    + '<img id="mapimg" src="/kindle/api/map.svg' + tq + '"'
    + ' style="width:100%; border:1px solid #999;"/>'
    + "</div>"
    + '<div class="footer">'
    + "Auto-refresh: " + sec + "s"
    + " | Vector map served as standalone SVG image."
    + "</div>"
    + '<div class="note">Use A-/A+ to zoom, Wiki to toggle concepts.'
    + " Read-only view of AI understanding.</div>"
    + "<script>"
    // ── Token query string injected for the toggleWiki URL builder. ──
    // Either "" or "?token=xxx".
    + "var TOKEN_Q = \"" + tq + "\";"
    // ── Zoom: tracks image width as a percentage. ──
    //    zoomIn adds 25 (max 300), zoomOut subtracts 20 (min 50).
    + "var zoomPct = 100;"
    + "function applyZoom() {"
    + 'document.getElementById("mapimg").style.width = zoomPct + "%";'
    + "}"
    + "function zoomIn() {"
    + "zoomPct = zoomPct + 25;"
    + "if (zoomPct > 300) zoomPct = 300;"
    + "applyZoom();"
    + "}"
    + "function zoomOut() {"
    + "zoomPct = zoomPct - 20;"
    + "if (zoomPct < 50) zoomPct = 50;"
    + "applyZoom();"
    + "}"
    // ── Wiki toggle: rebuilds the img src with/without ?wiki=1. ──
    //    Keeps any existing ?token=xxx (appended as &wiki=1).
    + "var wikiOn = 0;"
    + "function toggleWiki() {"
    + "wikiOn = wikiOn === 0 ? 1 : 0;"
    + 'var base = "/kindle/api/map.svg";'
    + "var q = TOKEN_Q;"
    + "if (wikiOn === 1) {"
    + 'q = q ? q + "&wiki=1" : "?wiki=1";'
    + "}"
    + 'document.getElementById("mapimg").setAttribute("src", base + q);'
    + "}"
    + "</script>"
    + "</body>"
    + "</html>"
  );
}
