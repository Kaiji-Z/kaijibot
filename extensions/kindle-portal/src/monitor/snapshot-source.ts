import type { FleetState } from "./fleet-state.js";
import type { FleetSnapshot, FleetAgent, PngCapability } from "../types.js";
import type { KindleConfig } from "../config.js";
import type { SessionStoreSnapshot, SessionStoreEntry, LoadSessionStore } from "./scope-resolver.js";

export type { PngCapability };

export interface SnapshotSourceOpts {
  readonly state: FleetState;
  readonly loadStore: LoadSessionStore;
  readonly cfg: KindleConfig;
  readonly pngCapability?: PngCapability;
}

/**
 * Build the `/kindle/api/fleet` snapshot.
 *
 * Strategy:
 * 1. Pull live active runs from `state.snapshot()` (already deep-cloned).
 * 2. Best-effort enrich each run with `sessionLabel`, `totalTokens`,
 *    `estimatedCostUsd` by looking up its `sessionKey` in the session store.
 * 3. Re-sort defensively by `startedAt` ascending.
 *
 * Resilience: this function never throws. If the session store is broken,
 * malformed, or rejects, the snapshot degrades to live runs with no
 * enrichment and a warning is logged.
 *
 * Under Option A (pure plugin boundary), `lanes` is always `[]` and
 * `laneSupport` is always `"unavailable"` — the queue/lane singletons are
 * core-internal and not exposed via the Plugin SDK.
 */
export async function buildFleetSnapshot(opts: SnapshotSourceOpts): Promise<FleetSnapshot> {
  const { active } = opts.state.snapshot();

  // Session store is untrusted runtime data — every read is defensive.
  let entries: ReadonlyMap<string, SessionStoreEntry> | null = null;
  try {
    const store: SessionStoreSnapshot = await opts.loadStore();
    entries = indexStoreBySessionKey(store);
  } catch (err) {
    console.warn("[kindle-portal] buildFleetSnapshot: session store load failed", err);
  }

  const enriched: FleetAgent[] = active.map((agent) => {
    if (agent.sessionKey === undefined) return agent;
    const entry = entries?.get(agent.sessionKey);
    if (entry === undefined) return agent;
    return {
      ...agent,
      sessionLabel: entry.label,
      totalTokens: entry.totalTokens,
      estimatedCostUsd: entry.estimatedCostUsd,
    };
  });

  enriched.sort((a, b) => a.startedAt - b.startedAt);

  return {
    agents: enriched,
    lanes: [],
    laneSupport: "unavailable",
    idle: enriched.length === 0,
    generatedAt: Date.now(),
    pngCapability: opts.pngCapability ?? "unknown",
  };
}

/**
 * Flatten a session store snapshot into a `sessionKey → entry` map.
 *
 * Tolerates non-array `agents`/`sessions` shapes by treating them as empty
 * — the runtime store contract is untrusted.
 */
function indexStoreBySessionKey(store: SessionStoreSnapshot): Map<string, SessionStoreEntry> {
  const out = new Map<string, SessionStoreEntry>();
  const agents = readArraySafe(store?.agents);
  for (const agent of agents) {
    if (agent === null || typeof agent !== "object") continue;
    const sessions = readArraySafe((agent as { sessions?: unknown }).sessions);
    for (const session of sessions) {
      if (session === null || typeof session !== "object") continue;
      const s = session as SessionStoreEntry;
      if (typeof s.sessionKey !== "string") continue;
      out.set(s.sessionKey, s);
    }
  }
  return out;
}

/** Returns `v` when it is an array, otherwise `[]`. Never throws. */
function readArraySafe<T>(v: unknown): readonly T[] {
  return Array.isArray(v) ? (v as readonly T[]) : [];
}
