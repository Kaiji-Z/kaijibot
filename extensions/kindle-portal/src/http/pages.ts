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
  const html = renderMonitorHtml(snapshot, {
    refreshIntervalSeconds: ctx.cfg.refreshIntervalSeconds,
    accessToken: ctx.cfg.accessToken,
  });
  res.end(html);
}

/**
 * `/kindle/map` — cognitive map page.
 *
 * The page itself is a thin shell that references the standalone SVG image
 * at `/kindle/api/map.svg` via an `<img>` tag. Graph building happens inside
 * the SVG endpoint (see `handleMapSvg`), so this handler no longer needs to
 * resolve a user / read persona / build a graph.
 */
export async function handleMapHtml(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiHandlerContext,
): Promise<void> {
  res.setHeader("Content-Type", HTML_CONTENT_TYPE);
  res.setHeader("Cache-Control", NO_STORE);
  const html = renderMapHtml({
    mapRefreshSeconds: ctx.cfg.mapRefreshSeconds,
    accessToken: ctx.cfg.accessToken,
  });
  res.end(html);
}
