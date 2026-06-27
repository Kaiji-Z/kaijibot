/**
 * HTTP wrapper for `/kindle/api/map.png`.
 *
 * Resolves the active user, reads the persona (+ optional wiki), builds the
 * cognitive-map graph, and streams a server-rendered 16-gray PNG suitable
 * for Kindle's experimental browser. PNG output is cacheable for a short
 * window (5 min) to ease repeated refreshes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiHandlerContext } from "./api-json.js";
import { resolveActiveUser } from "../monitor/scope-resolver.js";
import { readPersona } from "../map/persona-reader.js";
import { readWikiGraph } from "../map/wiki-reader.js";
import { buildMapGraph } from "../map/graph-builder.js";
import { renderGraphPng } from "../map/png-renderer.js";

const PNG_CONTENT_TYPE = "image/png";
const PNG_CACHE = "public, max-age=300";

export async function handleMapPng(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiHandlerContext,
): Promise<void> {
  res.setHeader("Cache-Control", PNG_CACHE);
  try {
    const user = await resolveActiveUser(ctx.loadStore, ctx.cfg.scope, {
      userId: ctx.cfg.userId,
    });
    if (!user) {
      // No active user → render an empty graph so the Kindle still gets a
      // valid image instead of a broken one.
      const { buffer } = await renderGraphPng(
        { nodes: [], edges: [] },
        { pngWidth: ctx.cfg.pngWidth },
      );
      res.setHeader("Content-Type", PNG_CONTENT_TYPE);
      res.end(buffer);
      return;
    }
    const persona = await readPersona(ctx.stateDir, user.agentId, user.userId);
    const wiki = ctx.cfg.showWiki ? await readWikiGraph(ctx.workspaceDir) : null;
    const graph = buildMapGraph(persona, wiki, {
      maxDomains: ctx.cfg.maxDomains,
      showWiki: ctx.cfg.showWiki,
    });
    const { buffer } = await renderGraphPng(graph, { pngWidth: ctx.cfg.pngWidth });
    res.setHeader("Content-Type", PNG_CONTENT_TYPE);
    res.end(buffer);
  } catch (err) {
    console.warn("[kindle-portal] /api/map.png error:", String(err));
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end("Render error");
  }
}
