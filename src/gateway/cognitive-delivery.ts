import type { KaijiBotConfig } from "../config/config.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store-load.js";
import { isCronSessionKey, isSubagentSessionKey } from "../sessions/session-key-utils.js";

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

  return undefined;
}
