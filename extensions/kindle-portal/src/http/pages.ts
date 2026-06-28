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
import type { MapGraph } from "../types.js";
import { buildFleetSnapshot } from "../monitor/snapshot-source.js";
import { resolveActiveUser } from "../monitor/scope-resolver.js";
import { readPersona } from "../map/persona-reader.js";
import { readWikiGraph } from "../map/wiki-reader.js";
import { buildMapGraph } from "../map/graph-builder.js";
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

/** `/kindle/map` — cognitive map page (inline SVG, meta-refresh, ES5 zoom). */
export async function handleMapHtml(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiHandlerContext,
): Promise<void> {
  res.setHeader("Content-Type", HTML_CONTENT_TYPE);
  res.setHeader("Cache-Control", NO_STORE);

  // readPersona/readWikiGraph never throw, but the page must always render —
  // guard against unexpected rejections so we degrade to an empty graph.
  let graph: MapGraph;
  try {
    const user = await resolveActiveUser(ctx.loadStore, ctx.cfg.scope, {
      userId: ctx.cfg.userId,
    });
    if (user === null) {
      graph = { nodes: [], edges: [] };
    } else {
      const persona = await readPersona(ctx.stateDir, user.agentId, user.userId);
      const wiki = ctx.cfg.showWiki ? await readWikiGraph(ctx.workspaceDir) : null;
      graph = buildMapGraph(persona, wiki, {
        maxDomains: ctx.cfg.maxDomains,
        showWiki: ctx.cfg.showWiki,
      });
    }
  } catch (err) {
    console.warn("[kindle-portal] /map graph build error:", String(err));
    graph = { nodes: [], edges: [] };
  }

  const html = renderMapHtml(graph, {
    mapRefreshSeconds: ctx.cfg.mapRefreshSeconds,
    accessToken: ctx.cfg.accessToken,
  });
  res.end(html);
}
