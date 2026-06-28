/**
 * HTTP wrappers for the two HTML pages (`/kindle/` and `/kindle/map`).
 *
 * These are thin adapters that set cache headers, build a snapshot when
 * needed, and stream the rendered HTML. No `api.runtime.*` calls — all
 * dependencies arrive via {@link ApiHandlerContext} so the handlers stay
 * unit-testable without a plugin runtime.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiHandlerContext } from "./api-json.js";
import { buildFleetSnapshot } from "../monitor/snapshot-source.js";
import { readAllAgents } from "../monitor/agent-reader.js";
import { renderMonitorHtml } from "../html/monitor-template.js";
import { renderMapHtml } from "../html/map-template.js";

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const NO_STORE = "no-store, max-age=0";

/** `/kindle/` — live agent monitor page (XHR-polled, ES5 HTML). */
export async function handleMonitorHtml(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiHandlerContext,
): Promise<void> {
  res.setHeader("Content-Type", HTML_CONTENT_TYPE);
  res.setHeader("Cache-Control", NO_STORE);
  const snapshot = await buildFleetSnapshot({
    state: ctx.state,
    loadStore: ctx.loadStore,
    cfg: ctx.cfg,
    pngCapability: ctx.pngCapability,
  });
  const registeredAgents = await readAllAgents(ctx.stateDir, ctx.loadStore);
  const html = renderMonitorHtml(
    snapshot,
    {
      refreshIntervalSeconds: ctx.cfg.refreshIntervalSeconds,
      accessToken: ctx.cfg.accessToken,
    },
    registeredAgents,
  );
  res.end(html);
}

/**
 * `/kindle/map` — cognitive map page.
 *
 * The page itself is a thin shell that references the standalone SVG image
 * at `/kindle/api/map.svg` via an `<img>` tag. Graph building happens inside
 * the SVG endpoint (see `handleMapSvg`), so this handler no longer needs to
 * resolve a user / read persona / build a graph.
 *
 * URL query params honored by this page:
 *   - `?zoom=N` — current zoom level (50-400, default 100). Passed to the
 *     template to highlight the active zoom link and to build the SVG img URL.
 *   - `?wiki=1` — current wiki-layer state (default off). Passed to the
 *     template to highlight the wiki toggle and to build the SVG img URL.
 *
 * The token param is handled by the gateway auth layer, not here.
 */
export async function handleMapHtml(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiHandlerContext,
): Promise<void> {
  res.setHeader("Content-Type", HTML_CONTENT_TYPE);
  res.setHeader("Cache-Control", NO_STORE);

  const url = new URL(req.url ?? "/", "http://localhost");
  const rawZoom = parseInt(url.searchParams.get("zoom") ?? "100", 10);
  const zoom = Number.isNaN(rawZoom) ? 100 : Math.max(50, Math.min(400, rawZoom));
  const wiki = url.searchParams.get("wiki") === "1";

  const html = renderMapHtml(
    { mapRefreshSeconds: ctx.cfg.mapRefreshSeconds, accessToken: ctx.cfg.accessToken },
    { zoom, wiki },
  );
  res.end(html);
}
