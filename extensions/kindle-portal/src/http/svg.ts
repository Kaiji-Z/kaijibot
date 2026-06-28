/**
 * HTTP wrapper for `/kindle/api/map.svg`.
 *
 * Mirrors {@link handleMapPng} but streams a standalone SVG image instead of
 * a 16-gray PNG. Kindle Paperwhite ≤5.16.3 silently ignores inline `<svg>`
 * tags embedded in HTML, but it DOES render `<img src="*.svg">` — so the map
 * page references this endpoint via an `<img>` tag. The SVG carries explicit
 * width/height and a white background rect so it renders correctly inside an
 * `<img>` context where CSS backgrounds and percentage widths are ignored.
 *
 * URL query params:
 *   - `?wiki=1` — include the wiki concept layer in the rendered SVG. When
 *     absent, the wiki layer is omitted entirely (smaller payload, no wiki
 *     nodes / cross edges).
 *   - `?zoom=N` — physical SVG dimensions scale by N/100 while the viewBox
 *     stays fixed at "0 0 2400 3600". Range 25-400, default 50. At zoom=50
 *     the SVG is 1200x1800 (fits most of the graph on screen); at zoom=200
 *     the SVG is 4800x7200 and the map page's scroll container pans over it.
 *
 * SVG output is cacheable for 5 min to ease repeated refreshes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiHandlerContext } from "./api-json.js";
import { resolveActiveUser } from "../monitor/scope-resolver.js";
import { readPersona } from "../map/persona-reader.js";
import { readWikiGraph } from "../map/wiki-reader.js";
import { buildMapGraph } from "../map/graph-builder.js";
import { renderMapGraphSvg } from "../html/svg-graph.js";

const SVG_CONTENT_TYPE = "image/svg+xml; charset=utf-8";
const SVG_CACHE = "public, max-age=300";

/** Parse `?wiki=1` (or `?wiki=0`) from the request URL. Default true. */
function parseWikiFlag(req: IncomingMessage): boolean {
  const rawUrl = req.url ?? "";
  const q = rawUrl.indexOf("?");
  if (q === -1) {
    return true;
  }
  const search = rawUrl.slice(q + 1);
  for (const pair of search.split("&")) {
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    if (key !== "wiki") {
      continue;
    }
    const val = eq === -1 ? "" : pair.slice(eq + 1);
    // "0" / "false" → off; anything else (including empty) → on.
    return val !== "0" && val !== "false";
  }
  return true;
}

/**
 * Parse `?zoom=N` from the request URL. Default 50, clamped to [25, 400].
 *
 * Values outside the range are silently clamped — invalid input never causes
 * a 500, it just produces a sensible default-size SVG.
 */
function parseZoomLevel(req: IncomingMessage): number {
  const rawUrl = req.url ?? "";
  const q = rawUrl.indexOf("?");
  if (q === -1) {
    return 50;
  }
  const search = rawUrl.slice(q + 1);
  for (const pair of search.split("&")) {
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    if (key !== "zoom") {
      continue;
    }
    const val = eq === -1 ? "" : pair.slice(eq + 1);
    const parsed = parseInt(val, 10);
    if (Number.isNaN(parsed)) {
      return 50;
    }
    return Math.max(25, Math.min(400, parsed));
  }
  return 50;
}

export async function handleMapSvg(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiHandlerContext,
): Promise<void> {
  res.setHeader("Cache-Control", SVG_CACHE);
  try {
    // Always read the wiki flag from the URL so the page's toggle link can
    // request the wiki layer on demand even when global showWiki is true.
    const showWikiLayer = parseWikiFlag(req);
    const zoomLevel = parseZoomLevel(req);

    const user = await resolveActiveUser(ctx.loadStore, ctx.cfg.scope, {
      userId: ctx.cfg.userId,
    });
    if (!user) {
      // No active user → render an empty graph so the Kindle still gets a
      // valid image instead of a broken one.
      const svg = renderMapGraphSvg(
        { nodes: [], edges: [] },
        { wiki: showWikiLayer, zoom: zoomLevel },
      );
      res.setHeader("Content-Type", SVG_CONTENT_TYPE);
      res.end(svg);
      return;
    }
    const persona = await readPersona(ctx.stateDir, user.agentId, user.userId);
    // Only read the wiki vault when both the config and the URL flag enable
    // it. Skips disk I/O when the wiki layer is not requested.
    const wiki =
      ctx.cfg.showWiki && showWikiLayer
        ? await readWikiGraph(ctx.workspaceDir)
        : null;
    const graph = buildMapGraph(persona, wiki, {
      maxDomains: ctx.cfg.maxDomains,
      showWiki: ctx.cfg.showWiki,
    });
    const svg = renderMapGraphSvg(graph, { wiki: showWikiLayer, zoom: zoomLevel });
    res.setHeader("Content-Type", SVG_CONTENT_TYPE);
    res.end(svg);
  } catch (err) {
    console.warn("[kindle-portal] /api/map.svg error:", String(err));
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end("Render error");
  }
}
