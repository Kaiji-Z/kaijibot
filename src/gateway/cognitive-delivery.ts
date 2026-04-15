import type { KaijiBotConfig } from "../config/config.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store-load.js";
import { isCronSessionKey, isSubagentSessionKey } from "../sessions/session-key-utils.js";

export type CognitiveDeliveryTarget = {
  sessionKey: string;
  channel: string;
  to: string;
  accountId?: string;
};

export function findSessionKeyForUserId(
  cfg: KaijiBotConfig | undefined,
  userId: string,
): string | undefined {
  if (!cfg) return undefined;

  const storePath = resolveStorePath(cfg.session?.store, { agentId: "main" });
  const store = loadSessionStore(storePath);

  const directKey = `agent:main:${userId}`;
  if (store[directKey] && !isSubagentSessionKey(directKey) && !isCronSessionKey(directKey)) {
    return directKey;
  }

  for (const key of Object.keys(store)) {
    if (isSubagentSessionKey(key) || isCronSessionKey(key)) continue;
    if (key.endsWith(`:${userId}`)) return key;
  }

  // Fallback: use the default main session if no user-specific session exists.
  // Feishu DMs route to "agent:main:main" rather than "agent:main:<open_id>".
  const mainKey = "agent:main:main";
  if (store[mainKey]) return mainKey;

  return undefined;
}

/**
 * Resolve the full delivery target for a cognitive insight: session key,
 * channel, and recipient address. Returns undefined if no routable session
 * exists or if the session has no channel binding (e.g. lastChannel missing).
 */
export function resolveCognitiveDeliveryTarget(
  cfg: KaijiBotConfig | undefined,
  userId: string,
): CognitiveDeliveryTarget | undefined {
  if (!cfg) return undefined;

  const storePath = resolveStorePath(cfg.session?.store, { agentId: "main" });
  const store = loadSessionStore(storePath);

  const sessionKey = findSessionKeyForUserId(cfg, userId);
  if (!sessionKey) return undefined;

  const entry = store[sessionKey];
  if (!entry) return undefined;

  const channel = entry.lastChannel;
  const to = entry.lastTo;
  if (!channel || channel === "none" || !to) return undefined;

  return {
    sessionKey,
    channel,
    to,
    accountId: entry.lastAccountId ?? undefined,
  };
}
