/**
 * Plugin wiring: connect the Kindle Portal's state, service, and HTTP routes
 * to the KaijiBot plugin runtime.
 *
 * This is the only file that calls `api.runtime.*`. All route handlers receive
 * their dependencies via {@link RouterContext}, keeping them runtime-free and
 * unit-testable.
 *
 * Runtime API notes (verified against `src/plugins/runtime/types-core.ts`):
 *   - `api.runtime.state.resolveStateDir()` exists and returns the state dir.
 *   - The spec's `api.runtime.state.resolveWorkspaceDir()` and
 *     `api.runtime.state.session.loadSessionStore()` do **not** exist. The real
 *     surfaces live under `api.runtime.agent.*`:
 *       • `agent.resolveAgentWorkspaceDir(cfg, agentId)` → workspace dir
 *       • `agent.session.resolveStorePath()` → default agent's sessions.json
 *       • `agent.session.loadSessionStore(path)` → `Record<string, SessionEntry>`
 *     The core store is a flat map keyed by sessionKey; we adapt it into the
 *     grouped `{ agents: [{ agentId, sessions }] }` shape the portal expects.
 */
import path from "node:path";
import type { KaijiBotPluginApi } from "../api.js";
import type { KindleConfig } from "./config.js";
import {
  createKindleHttpHandler,
  createRootRedirectHandler,
  createShortPathHandler,
} from "./http/router.js";
import type { AgentEventPayload } from "./monitor/fleet-state.js";
import { FleetState } from "./monitor/fleet-state.js";
import type {
  LoadSessionStore,
  SessionStoreSnapshot,
  SessionStoreEntry,
} from "./monitor/scope-resolver.js";
import { createKindlePortalService } from "./service.js";
import { createKindleSetupTool, createKindleStatusTool } from "./tools.js";

/** Conventional default agent id used to resolve workspace + session store. */
const DEFAULT_AGENT_ID = "main";

/**
 * Register the Kindle Portal plugin: HTTP route `/kindle/*` + a background
 * service that feeds the live fleet state from the agent event stream.
 */
export function registerKindlePortalPlugin(api: KaijiBotPluginApi, cfg: KindleConfig): void {
  // 1. Resolve directories from the runtime.
  const stateDir = api.runtime.state.resolveStateDir();
  const workspaceDir = resolveWorkspaceDir(api);

  // 2. Live fleet state — populated by the service's event collector.
  const state = new FleetState();

  // 3. Session store loader: adapt the core flat store into the grouped
  //    snapshot shape. Falls back to an empty snapshot on any failure so the
  //    monitor degrades gracefully rather than 500-ing every poll.
  const loadStore: LoadSessionStore = async () => {
    try {
      const resolveStorePath = api.runtime.agent.session.resolveStorePath;
      const loadSessionStore = api.runtime.agent.session.loadSessionStore;
      const storePath = resolveStorePath();
      const raw = loadSessionStore(storePath);
      return adaptSessionStore(raw);
    } catch (err) {
      api.logger.warn?.(`[kindle-portal] session store load failed: ${String(err)}`);
      return { agents: [] };
    }
  };

  // 4. Service: subscribes to agent events + runs periodic stale-prune.
  const service = createKindlePortalService({
    state,
    subscribe: (listener) =>
      // Bridge core event payload → extension-local typed payload. The two
      // `AgentEventPayload` types describe the same runtime event but differ
      // in how strictly `data` is typed; the cast is a boundary narrowing.
      api.runtime.events.onAgentEvent((evt) => {
        listener(evt as unknown as AgentEventPayload);
      }),
    logger: api.logger,
  });

  // 5. HTTP route (prefix match so /kindle, /kindle/, /kindle/api/* all land here).
  const routeCtx = { state, cfg, loadStore, stateDir, workspaceDir };
  api.registerHttpRoute({
    path: "/kindle",
    auth: "plugin",
    match: "prefix",
    replaceExisting: true,
    handler: createKindleHttpHandler(routeCtx),
  });

  // 5b. Root path: Kindle UA → 302 redirect to /kindle/ (saves typing on Kindle).
  api.registerHttpRoute({
    path: "/",
    auth: "plugin",
    match: "exact",
    handler: createRootRedirectHandler(routeCtx),
  });

  // 5c. Short path: /k serves monitor HTML (shorter URL for Kindle keyboard).
  api.registerHttpRoute({
    path: "/k",
    auth: "plugin",
    match: "exact",
    handler: createShortPathHandler(routeCtx),
  });

  // 6. Agent tools: let users configure Kindle Portal by chatting.
  api.registerTool(() => createKindleSetupTool({ logger: api.logger }), { name: "kindle_setup" });
  api.registerTool(() => createKindleStatusTool({ logger: api.logger }), { name: "kindle_status" });

  // 7. Register the background service.
  api.registerService(service);

  api.logger.info?.("[kindle-portal] registered: HTTP route /kindle/* + service");
}

// ── Helpers ──

function resolveWorkspaceDir(api: KaijiBotPluginApi): string {
  const fallback = path.join(api.runtime.state.resolveStateDir(), "workspace");
  try {
    return api.runtime.agent.resolveAgentWorkspaceDir(api.config, DEFAULT_AGENT_ID);
  } catch {
    return fallback;
  }
}

/**
 * Convert the core session store (`Record<sessionKey, SessionEntry>`) into the
 * grouped snapshot the portal consumes. The core entry's structural type is
 * imported transitively via the runtime API; we read its fields defensively.
 */
function adaptSessionStore(raw: Record<string, Record<string, unknown>>): SessionStoreSnapshot {
  const byAgent = new Map<string, SessionStoreEntry[]>();

  for (const [sessionKey, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const agentId = extractAgentId(sessionKey) ?? DEFAULT_AGENT_ID;
    const record: SessionStoreEntry = {
      sessionKey,
      agentId,
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
      origin: isObj(entry.origin) ? entry.origin : undefined,
      totalTokens: numOrUndef(entry.totalTokens),
      estimatedCostUsd: numOrUndef(entry.estimatedCostUsd),
      model: strOrUndef(entry.model),
      label: strOrUndef(entry.label),
    };
    const bucket = byAgent.get(agentId);
    if (bucket) {
      bucket.push(record);
    } else {
      byAgent.set(agentId, [record]);
    }
  }

  return {
    agents: Array.from(byAgent, ([agentId, sessions]) => ({ agentId, sessions })),
  };
}

/** Extract the agent id from a `agent:<id>:...` session key. */
function extractAgentId(sessionKey: string): string | undefined {
  if (!sessionKey.startsWith("agent:")) {
    return undefined;
  }
  const rest = sessionKey.slice("agent:".length);
  const colon = rest.indexOf(":");
  return colon === -1 ? rest : rest.slice(0, colon);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
