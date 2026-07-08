/**
 * Identity constants and helpers for cognitive system user resolution.
 *
 * The local operator (Control UI / TUI) is a first-class user with userId
 * "operator". All cognitive subsystems (persona, correction, evolution,
 * fragments) store per-agent data under this userId, giving the operator a
 * fully isolated cognitive profile per agent.
 */

import {
  isCronSessionKey,
  isHeartbeatSessionKey,
  isSubagentSessionKey,
} from "../sessions/session-key-utils.js";

/** The canonical userId for local operator sessions (Control UI / TUI). */
export const OPERATOR_USER_ID = "operator";

/**
 * Gateway client IDs that represent the local machine operator.
 * When a session originates from one of these clients, the SenderId is
 * mapped to {@link OPERATOR_USER_ID} so the cognitive system treats it as
 * a stable, first-class user identity.
 *
 * These mirror GATEWAY_CLIENT_IDS.CONTROL_UI / TUI in
 * `src/gateway/protocol/client-info.ts`. Cognitive layer cannot import from
 * gateway protocol (architecture boundary), so the values are duplicated
 * here. A test in identity.test.ts verifies they match.
 */
const OPERATOR_CLIENT_IDS: ReadonlySet<string> = new Set([
  "kaijibot-control-ui",
  "kaijibot-tui",
  "kaijibot-macos",
  "kaijibot-ios",
  "kaijibot-android",
]);

/**
 * If the sender is a local operator client (Control UI / TUI), returns
 * the canonical operator userId. Otherwise returns undefined.
 *
 * Call sites should use the result as a fallback:
 * ```ts
 * SenderId: resolveOperatorSenderId(rawId) ?? rawId
 * ```
 */
export function resolveOperatorSenderId(senderId?: string | null): string | undefined {
  if (senderId && OPERATOR_CLIENT_IDS.has(senderId)) {
    return OPERATOR_USER_ID;
  }
  return undefined;
}

/**
 * Unified cognitive userId resolver. ALL cognitive subsystems should use this.
 *
 * Channel-agnostic: no ou_ prefix check, works with feishu, wechat, and any
 * future channel.
 *
 * Resolution priority:
 *  1. senderId (conversation-time path) — mapped via resolveOperatorSenderId,
 *     otherwise passed through as-is.
 *  2. sessionKey tail (background path) — "main" → operator, any other non-empty
 *     tail → returned as-is. System sessions (cron, heartbeat, subagent) and
 *     group sessions without :sender: → null (tail is not a user ID).
 */
export function resolveCognitiveUserId(
  sessionKey?: string,
  senderId?: string | null,
): string | null {
  if (senderId) {
    return resolveOperatorSenderId(senderId) ?? senderId;
  }
  if (!sessionKey) {
    return null;
  }
  if (
    isCronSessionKey(sessionKey) ||
    isHeartbeatSessionKey(sessionKey) ||
    isSubagentSessionKey(sessionKey)
  ) {
    return null;
  }
  const tail = sessionKey.split(":").pop();
  if (!tail) {
    return null;
  }
  if (sessionKey.includes(":group:") && !sessionKey.includes(":sender:")) {
    return null;
  }
  return tail === "main" ? OPERATOR_USER_ID : tail;
}
