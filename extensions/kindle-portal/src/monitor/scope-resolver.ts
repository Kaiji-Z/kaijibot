import type { KindleConfig } from "../config.js";

/**
 * A single entry from the session store (the gateway's persisted record of
 * recent chat sessions). We declare only the fields this module consumes —
 * the real shape has additional runtime fields we intentionally ignore.
 *
 * Kept here rather than in `types.ts` because it is an input contract owned
 * by the scope resolver, not part of the public monitor payload contract.
 */
export interface SessionStoreEntry {
  readonly sessionKey: string;
  readonly agentId?: string;
  readonly updatedAt: number;
  readonly origin?: { readonly from?: string };
  readonly totalTokens?: number;
  readonly estimatedCostUsd?: number;
  readonly model?: string;
  readonly label?: string;
}

/**
 * Top-level session store snapshot. The `agents` array groups session entries
 * by the agent that owns them.
 */
export interface SessionStoreSnapshot {
  readonly agents: ReadonlyArray<{
    readonly agentId: string;
    readonly sessions: readonly SessionStoreEntry[];
  }>;
}

/** Function that loads a session store snapshot. Injected for testability. */
export type LoadSessionStore = () => Promise<SessionStoreSnapshot>;

/** Result of resolving which user's persona to surface. */
export interface ActiveUser {
  readonly agentId: string;
  readonly userId: string;
}

/**
 * Extracts the `ou_...` userId token from a session key.
 *
 * Session keys look like:
 *   - `agent:main:feishu:direct:ou_xxx@feishu` (`ou_xxx` after a `:`)
 *   - `ou_xxx@feishu` (`ou_xxx` at start of string)
 *
 * The pattern requires `ou_` to appear either at the start of the string or
 * immediately after a separator character (`:` or `@`), to avoid matching
 * `ou_` substrings inside unrelated tokens like `about_xyz`.
 *
 * Spec listed `/^(ou_[A-Za-z0-9_]+)/`, but that pattern fails on the primary
 * `agent:main:feishu:direct:ou_xxx@feishu` shape because `^` anchors to start
 * of string. The separator-aware pattern below honors both test cases.
 */
const O_USER_ID_PATTERN = /(?:^|[:@])(ou_[A-Za-z0-9_]+)/;

export function extractUserId(sessionKey: string): string | undefined {
  const match = O_USER_ID_PATTERN.exec(sessionKey);
  return match?.[1];
}

/**
 * Resolve which user's persona to visualize on the cognitive map.
 *
 * - `"last-active"`: scan all agents' session stores, find the entry with the
 *   largest `updatedAt`, extract the userId from its sessionKey (with
 *   `origin.from` fallback). Return that `{agentId, userId}`.
 * - `"specific-user"`: scan all agents' sessions for one whose sessionKey
 *   contains `cfg.userId`. Return `{agentId: <first match>, userId: cfg.userId}`.
 * - `"all-users"`: return `null` — the caller handles user enumeration.
 *
 * Returns `null` when no user can be resolved, when the scope is `"all-users"`,
 * or when the session store cannot be loaded (degrades gracefully).
 */
export async function resolveActiveUser(
  loadStore: LoadSessionStore,
  scope: KindleConfig["scope"],
  cfg: { readonly userId?: string },
): Promise<ActiveUser | null> {
  // "all-users" never needs the store — the caller enumerates independently.
  if (scope === "all-users") {return null;}

  let store: SessionStoreSnapshot;
  try {
    store = await loadStore();
  } catch (err) {
    console.warn("[kindle-portal] resolveActiveUser: session store load failed", err);
    return null;
  }

  if (scope === "specific-user") {
    return resolveSpecific(store, cfg.userId);
  }

  // scope === "last-active"
  return resolveLastActive(store);
}

/** Iterate all sessions and find the most recently updated one with a userId. */
function resolveLastActive(store: SessionStoreSnapshot): ActiveUser | null {
  let best: { agentId: string; userId: string; updatedAt: number } | null = null;

  for (const agent of store.agents ?? []) {
    for (const session of agent.sessions ?? []) {
      const userId = extractUserId(session.sessionKey) ?? session.origin?.from;
      if (userId === undefined) {continue;}
      if (best === null || session.updatedAt > best.updatedAt) {
        best = { agentId: agent.agentId, userId, updatedAt: session.updatedAt };
      }
    }
  }

  return best === null ? null : { agentId: best.agentId, userId: best.userId };
}

/** Find the first agent whose sessions reference the configured userId. */
function resolveSpecific(
  store: SessionStoreSnapshot,
  userId: string | undefined,
): ActiveUser | null {
  if (userId === undefined) {return null;}

  for (const agent of store.agents ?? []) {
    for (const session of agent.sessions ?? []) {
      if (session.sessionKey.includes(userId)) {
        return { agentId: agent.agentId, userId };
      }
    }
  }
  return null;
}
