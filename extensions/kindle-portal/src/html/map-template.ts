/**
 * Cognitive map HTML template for Kindle Portal.
 *
 * Renders a JavaScript-FREE page that displays the cognitive map as a
 * standalone SVG image via `<img src="/kindle/api/map.svg">`. Kindle
 * Paperwhite ≤5.16.3 silently ignores inline `<svg>` tags embedded in HTML,
 * but it DOES render `<img src="*.svg">` — so the SVG is served by a
 * separate endpoint and referenced here as a regular image.
 *
 * Interaction model — pure URL links, no JavaScript:
 *   - Tab bar: `<a href="/kindle/{?token}">Monitor</a>` + active "Map" span.
 *   - Zoom: `<a href="/kindle/map?zoom=N&...">` links for 100/150/200/300%.
 *     The current zoom level's link gets the `.active` class (bold + larger).
 *     Clicking reloads the page with a new `?zoom=N` query; the server
 *     regenerates the SVG at the requested physical dimensions and the
 *     scroll container pans over the larger image.
 *   - Wiki toggle: `<a href="/kindle/map?wiki=1&...">Wiki</a>` link.
 *
 * Kindle's old WebKit has unreliable `onclick` handlers on `<button>`, so
 * all interaction is via plain `<a>` links with URL query parameters. This
 * always works on Kindle.
 *
 * Auto-refresh via `<meta http-equiv="refresh">`. Meta refresh reloads the
 * current URL, which preserves any query params (zoom, wiki, token) that
 * the user navigated to — so the refresh honors the current view state.
 *
 * All HTML is built with `+` concatenation — no template literals — so the
 * rendered output passes `lintKindleHtml` (no backticks, no `=>`, no
 * `const`/`let`, no `fetch`). This page is self-contained: it does NOT use
 * shared-css.ts (the map has its own e-ink styling).
 */
import type { KindleConfig } from "../config.js";

/** Allowed zoom levels offered in the UI, in percent. */
const ZOOM_LEVELS: readonly number[] = [100, 150, 200, 300];

/** Escape a query-string value (alphanumeric + a few safe chars preserved). */
function escapeQueryParam(s: string): string {
  return encodeURIComponent(s);
}

/**
 * Append a key/value pair to a query-string buffer.
 *
 * `q` is either "" (no params yet) or starts with "?". New pairs are joined
 * with "&". Returns the updated buffer.
 */
function appendQuery(q: string, key: string, val: string): string {
  var pair = key + "=" + escapeQueryParam(val);
  return q === "" ? "?" + pair : q + "&" + pair;
}

/**
 * Build the cognitive-map HTML page.
 *
 * The SVG itself is built independently by the `/kindle/api/map.svg`
 * endpoint, so this template only needs the refresh interval, optional
 * access token, and the current view state (zoom / wiki) to assemble the
 * img URL, zoom links, and meta-refresh tag.
 *
 * @param cfg   Refresh interval and optional access token.
 * @param opts  Current view state: `zoom` (default 100) and `wiki`
 *              (default false). Used to highlight the active zoom link and
 *              to build the SVG img URL.
 */
export function renderMapHtml(
  cfg: Pick<KindleConfig, "mapRefreshSeconds" | "accessToken">,
  opts?: { zoom?: number; wiki?: boolean },
): string {
  var sec = String(cfg.mapRefreshSeconds);
  var token = cfg.accessToken ?? "";
  var zoom = opts?.zoom ?? 100;
  var wiki = opts?.wiki === true;

  // Token query string for page links: "" or "?token=xxx".
  var tq = token === "" ? "" : "?token=" + escapeQueryParam(token);

  // Build the SVG img URL query: combines zoom + wiki + token.
  // Always includes zoom so the server renders at the requested size.
  // Wiki is only appended when enabled (default off — lighter payload).
  var svgQ = "";
  svgQ = appendQuery(svgQ, "zoom", String(zoom));
  if (wiki) {
    svgQ = appendQuery(svgQ, "wiki", "1");
  }
  if (token !== "") {
    svgQ = appendQuery(svgQ, "token", token);
  }
  var svgSrc = "/kindle/api/map.svg" + svgQ;

  // Build a reusable param suffix for the zoom/wiki nav links. Each link
  // carries the OPPOSITE state (e.g. zoom links preserve current wiki,
  // wiki link preserves current zoom) plus the token. We compose them per
  // link below rather than pre-computing, because each link overrides one
  // specific param.
  function linkHref(linkZoom: number, linkWiki: boolean): string {
    var q = "";
    q = appendQuery(q, "zoom", String(linkZoom));
    if (linkWiki) {
      q = appendQuery(q, "wiki", "1");
    }
    if (token !== "") {
      q = appendQuery(q, "token", token);
    }
    return "/kindle/map" + q;
  }

  // Build the zoom link list. The active level gets `.active` (bold).
  var zoomLinkParts: string[] = [];
  for (var i = 0; i < ZOOM_LEVELS.length; i++) {
    var lvl = ZOOM_LEVELS[i];
    var cls = lvl === zoom ? 'zoom-link active"' : 'zoom-link"';
    zoomLinkParts.push(
      '<a class="' + cls + ' href="' + linkHref(lvl, wiki) + '">' + lvl + "%</a>",
    );
  }
  var zoomLinks = zoomLinkParts.join(" ");

  // Wiki toggle link: shows the opposite of the current state.
  var wikiHref = linkHref(zoom, !wiki);
  var wikiLabel = wiki ? "Wiki ON" : "Wiki OFF";

  // Tab bar: Monitor (link) + Map (active span).
  var monitorTabHref = "/kindle/" + tq;

  return (
    "<!DOCTYPE html>"
    + '<html lang="en">'
    + "<head>"
    + '<meta charset="utf-8">'
    + '<meta http-equiv="refresh" content="' + sec + '">'
    + "<title>KaijiBot Cognitive Map</title>"
    + "<style>"
    + 'body { font-family: "Bookerly", "Palatino", serif; font-size: 24px;'
    + " margin: 0; padding: 8px; background: #fff; color: #000;"
    + " line-height: 1.3; }"
    + ".tabs { border-bottom: 3px solid #000; margin-bottom: 12px; padding: 0; }"
    + ".tab { display: inline-block; padding: 8px 20px; font-size: 16px;"
    + ' font-weight: bold; text-decoration: none; color: #666;'
    + " border: 2px solid #ccc; border-bottom: none; }"
    + ".tab-active { color: #000; border: 2px solid #000;"
    + " border-bottom: 3px solid #fff; }"
    + ".title { font-size: 22px; font-weight: bold; margin: 8px 0 4px 0; }"
    + ".zoom-links { margin: 8px 0; font-size: 18px; }"
    + '.zoom-links a { margin-right: 12px; color: #000; text-decoration: underline; }'
    + ".zoom-links .active { font-weight: bold; font-size: 22px; }"
    + ".scroller { overflow: auto; width: 100%; height: 800px;"
    + " border: 1px solid #999; background: #eee; }"
    + ".scroller img { display: block; }"
    + ".footer { border-top: 1px solid #999; margin-top: 8px; padding-top: 4px;"
    + " font-size: 14px; color: #555; }"
    + ".note { color: #555; font-size: 14px; margin-top: 4px; }"
    + "</style>"
    + "</head>"
    + "<body>"
    // ── Tab bar (Monitor | Map) ──
    + '<div class="tabs">'
    + '<a class="tab" href="' + monitorTabHref + '">Monitor</a>'
    + '<span class="tab tab-active">Map</span>'
    + "</div>"
    // ── Title ──
    + '<div class="title">Cognitive Map</div>'
    // ── Zoom + Wiki controls (all plain <a> links — no JS) ──
    + '<div class="zoom-links">'
    + zoomLinks
    + ' | <a class="zoom-link' + (wiki ? " active" : "") + '"'
    + ' href="' + wikiHref + '">' + wikiLabel + "</a>"
    + "</div>"
    // ── Scrollable SVG container ──
    // The img has NO width style — it uses the SVG's natural dimensions
    // (which change with the zoom param). At zoom=200 the SVG is 1516x2048
    // and this container scrolls.
    + '<div class="scroller">'
    + '<img src="' + svgSrc + '" alt="Cognitive map" />'
    + "</div>"
    // ── Footer ──
    + '<div class="footer">'
    + "Auto-refresh: " + sec + "s"
    + " | Vector map served as standalone SVG."
    + ' | <a href="' + monitorTabHref + '">Monitor</a>'
    + "</div>"
    + '<div class="note">Use the zoom links to enlarge.'
    + " Read-only view of AI understanding.</div>"
    + "</body>"
    + "</html>"
  );
}
