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
import { fetchGatewayStatus } from "../monitor/status-fetcher.js";
import { readCognitiveStats } from "../monitor/cognitive-reader.js";
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

  const gwStatus = await fetchGatewayStatus();
  const gwUsage = gwStatus?.usage;
  const enriched = {
    ...snapshot,
    usage: gwUsage
      ? {
          totalTokens: gwUsage.month?.totalTokens ?? 0,
          totalCostUsd: gwUsage.month?.totalCost ?? 0,
          sessionCount: 0,
          todayTokens: gwUsage.today?.totalTokens ?? 0,
          todayCostUsd: gwUsage.today?.totalCost ?? 0,
          todaySessions: 0,
        }
      : undefined,
    providerQuota: gwStatus?.providers?.[0] ?? null,
  };

  const html = renderMonitorHtml(
    enriched,
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
 * the SVG endpoint (see `handleMapSvg`), so this handler only resolves view
 * state (zoom / wiki) and cognitive stats for the template.
 *
 * URL query params honored by this page:
 *   - `?zoom=N` — current zoom level (25-400, default 50). Passed to the
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
  const rawZoom = parseInt(url.searchParams.get("zoom") ?? "50", 10);
  const zoom = Number.isNaN(rawZoom) ? 50 : Math.max(25, Math.min(400, rawZoom));
  const wiki = url.searchParams.get("wiki") === "1";
  const cognitive = await readCognitiveStats(ctx.stateDir);

  const html = renderMapHtml(
    { mapRefreshSeconds: ctx.cfg.mapRefreshSeconds, accessToken: ctx.cfg.accessToken },
    { zoom, wiki, cognitive },
  );
  res.end(html);
}
