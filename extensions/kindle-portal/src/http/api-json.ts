/**
 * JSON API handlers for `/kindle/api/fleet` and `/kindle/api/map.json`.
 *
 * Thin wrappers that call existing builders (buildFleetSnapshot,
 * buildMapGraph) and serialize to JSON via an injectable `sendJson`
 * callback. No `api.runtime.*` calls — dependencies arrive via
 * `ApiHandlerContext`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FleetState } from "../monitor/fleet-state.js";
import type { KindleConfig } from "../config.js";
import type { PngCapability } from "../types.js";
import type { LoadSessionStore } from "../monitor/scope-resolver.js";
import { buildFleetSnapshot } from "../monitor/snapshot-source.js";
import { resolveActiveUser } from "../monitor/scope-resolver.js";
import { buildMapGraph } from "../map/graph-builder.js";
import { readPersona } from "../map/persona-reader.js";
import { readWikiGraph } from "../map/wiki-reader.js";
import { readCognitiveStats, type CognitiveStats } from "../monitor/cognitive-reader.js";
import { readAllAgents } from "../monitor/agent-reader.js";

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

    // Aggregate usage across all agents for the dashboard metrics row.
    let totalTokens = 0;
    let estimatedCostUsd = 0;
    let totalToolCalls = 0;
    for (const a of snapshot.agents) {
      if (a.totalTokens !== undefined) {
        totalTokens += a.totalTokens;
      }
      if (a.estimatedCostUsd !== undefined) {
        estimatedCostUsd += a.estimatedCostUsd;
      }
      totalToolCalls += a.toolCallCount;
    }

    // Cognitive stats are best-effort; failure yields zeros, never throws.
    const cognitive: CognitiveStats = await readCognitiveStats(ctx.stateDir);

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

    const payload = {
      ...snapshot,
      usage: { totalTokens, estimatedCostUsd, totalToolCalls },
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

    const wiki = ctx.cfg.showWiki
      ? await readWikiGraph(ctx.workspaceDir)
      : null;

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
