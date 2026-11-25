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

/** Position of a scope marker in a session key, skipping the `agent:<agentId>` prefix. */
function findScopeSegment(segments: string[], marker: "sender" | "topic" | "thread"): number {
  return segments.indexOf(marker, 2);
}

/**
 * A session key without its topic or thread scope. A topic or thread session is keyed by the
 * thread id; this reduces it to the key of the conversation the thread belongs to.
 */
export function stripCognitiveThreadScope(sessionKey: string): string {
  const segments = sessionKey.split(":");
  const scopeStart = Math.max(
    findScopeSegment(segments, "topic"),
    findScopeSegment(segments, "thread"),
  );
  return scopeStart >= 0 ? segments.slice(0, scopeStart).join(":") : sessionKey;
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
 *  2. sessionKey (background path), most specific first:
 *     - a `:sender:<id>` segment names the person inside a group or topic session;
 *     - otherwise the key without its `:topic:` / `:thread:` scope: "main" → operator,
 *       any other non-empty tail → returned as-is.
 *     System sessions (cron, heartbeat, subagent) and group sessions without :sender:
 *     → null (nothing in the key is a user ID).
 */
export function resolveCognitiveUserId(
  sessionKey?: string,
  senderId?: string | null,
): string | null {
  if (senderId) {
    const operator = resolveOperatorSenderId(senderId);
    if (operator) {
      return operator;
    }
    return senderId.toLowerCase();
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
  const segments = sessionKey.split(":");
  const senderIndex = findScopeSegment(segments, "sender");
  const sender = senderIndex >= 0 ? segments[senderIndex + 1] : undefined;
  if (sender) {
    return resolveOperatorSenderId(sender) ?? sender.toLowerCase();
  }
  if (sessionKey.includes(":group:")) {
    return null;
  }
  const tail = stripCognitiveThreadScope(sessionKey).split(":").pop();
  if (!tail) {
    return null;
  }
  const normalized = tail.toLowerCase();
  return normalized === "main" ? OPERATOR_USER_ID : normalized;
}
