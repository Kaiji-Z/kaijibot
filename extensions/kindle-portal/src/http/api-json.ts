/**
 * JSON API handlers for `/kindle/api/fleet` and `/kindle/api/map.json`.
 *
 * Thin wrappers that call existing builders (buildFleetSnapshot,
 * buildMapGraph) and serialize to JSON via an injectable `sendJson`
 * callback. No `api.runtime.*` calls — dependencies arrive via
 * `ApiHandlerContext`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { KindleConfig } from "../config.js";
import { buildMapGraph } from "../map/graph-builder.js";
import { readPersona } from "../map/persona-reader.js";
import { readWikiGraph } from "../map/wiki-reader.js";
import { readAllAgents } from "../monitor/agent-reader.js";
import { readCognitiveStats } from "../monitor/cognitive-reader.js";
import type { FleetState } from "../monitor/fleet-state.js";
import type { LoadSessionStore } from "../monitor/scope-resolver.js";
import { resolveActiveUser } from "../monitor/scope-resolver.js";
import { buildFleetSnapshot } from "../monitor/snapshot-source.js";
import { fetchGatewayStatus } from "../monitor/status-fetcher.js";
import type { PngCapability } from "../types.js";

// ── Public types ──

export interface ApiHandlerContext {
  readonly state: FleetState;
  readonly cfg: KindleConfig;
  readonly loadStore: LoadSessionStore;
  readonly pngCapability?: PngCapability;
  readonly stateDir: string;
  readonly workspaceDir: string;
}

export interface SendJsonFn {
  (res: ServerResponse, status: number, body: unknown): void;
}

// ── Default sendJson ──

export const defaultSendJson: SendJsonFn = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

// ── Cache-Control helper ──

const NO_STORE = "no-store, max-age=0";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function setNoStore(res: ServerResponse): void {
  try {
    res.setHeader("Cache-Control", NO_STORE);
  } catch {
    // Headers may already be sent in error cases — swallow.
  }
}

// ── /kindle/api/fleet ──

export async function handleFleetJson(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiHandlerContext,
  sendJson?: SendJsonFn,
): Promise<void> {
  const send = sendJson ?? defaultSendJson;

  setNoStore(res);

  try {
    const snapshot = await buildFleetSnapshot({
      state: ctx.state,
      loadStore: ctx.loadStore,
      cfg: ctx.cfg,
      pngCapability: ctx.pngCapability,
    });

    // Aggregate usage + provider quota from gateway /api/status (5-min cached).
    const gwStatus = await fetchGatewayStatus();

    // Cognitive stats best-effort; kept for the map page, monitor doesn't show them.
    const cognitive = await readCognitiveStats(ctx.stateDir);

    const registeredAgents = await readAllAgents(ctx.stateDir, ctx.loadStore);

    const activeAgentIds = new Set<string>();
    for (const a of snapshot.agents) {
      if (a.agentId) {
        activeAgentIds.add(a.agentId);
      }
    }
    const mergedAgents = registeredAgents.map((ra) => ({
      ...ra,
      status: activeAgentIds.has(ra.id) ? ("active" as const) : ra.status,
    }));

    const gwUsage = gwStatus?.usage;
    const payload = {
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
      cognitive,
      registeredAgents: mergedAgents,
    };
    send(res, 200, payload);
  } catch (err) {
    send(res, 500, { error: String(err) });
    console.warn("[kindle-portal] /api/fleet error:", String(err));
  }
}

// ── /kindle/api/map.json ──

export async function handleMapJson(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiHandlerContext,
  sendJson?: SendJsonFn,
): Promise<void> {
  const send = sendJson ?? defaultSendJson;

  setNoStore(res);

  try {
    const user = await resolveActiveUser(ctx.loadStore, ctx.cfg.scope, {
      userId: ctx.cfg.userId,
    });

    if (user === null) {
      send(res, 200, { nodes: [], edges: [], warning: "No active user found" });
      return;
    }

    const persona = await readPersona(ctx.stateDir, user.agentId, user.userId);

    const wiki = ctx.cfg.showWiki ? await readWikiGraph(ctx.workspaceDir) : null;

    const graph = buildMapGraph(persona, wiki, {
      maxDomains: ctx.cfg.maxDomains,
      showWiki: ctx.cfg.showWiki,
    });

    send(res, 200, graph);
  } catch (err) {
    send(res, 500, { error: String(err) });
    console.warn("[kindle-portal] /api/map.json error:", String(err));
  }
}

// ── /kindle/api/cognitive.json ──

export async function handleCognitiveJson(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiHandlerContext,
): Promise<void> {
  res.setHeader("Content-Type", JSON_CONTENT_TYPE);
  setNoStore(res);
  try {
    const stats = await readCognitiveStats(ctx.stateDir);
    res.end(JSON.stringify(stats));
  } catch {
    res.statusCode = 500;
    res.end('{"error":"failed"}');
  }
}
