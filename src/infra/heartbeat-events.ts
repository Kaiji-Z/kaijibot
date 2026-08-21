import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { notifyListeners, registerListener } from "../shared/listeners.js";

const log = createSubsystemLogger("gateway/heartbeat");

export type HeartbeatIndicatorType = "ok" | "alert" | "error";

export type HeartbeatEventPayload = {
  ts: number;
  status: "sent" | "ok-empty" | "ok-token" | "skipped" | "failed";
  to?: string;
  accountId?: string;
  preview?: string;
  durationMs?: number;
  hasMedia?: boolean;
  reason?: string;
  /** The channel this heartbeat was sent to. */
  channel?: string;
  /** Whether the message was silently suppressed (showOk: false). */
  silent?: boolean;
  /** Indicator type for UI status display. */
  indicatorType?: HeartbeatIndicatorType;
  /** Length of the delivered reply text (incident forensics: 2026-08 events had no size trail). */
  replyChars?: number;
  /** Set when the degeneration guard replaced the reply with a bounded fallback. */
  degenerateBlocked?: "length" | "repetition";
  /** Length of the original (blocked) reply when the guard fired. */
  blockedReplyChars?: number;
};

export function resolveIndicatorType(
  status: HeartbeatEventPayload["status"],
): HeartbeatIndicatorType | undefined {
  switch (status) {
    case "ok-empty":
    case "ok-token":
      return "ok";
    case "sent":
      return "alert";
    case "failed":
      return "error";
    case "skipped":
      return undefined;
  }
}

type HeartbeatEventState = {
  lastHeartbeat: HeartbeatEventPayload | null;
  listeners: Set<(evt: HeartbeatEventPayload) => void>;
};

const HEARTBEAT_EVENT_STATE_KEY = Symbol.for("kaijibot.heartbeatEvents.state");

const state = resolveGlobalSingleton<HeartbeatEventState>(HEARTBEAT_EVENT_STATE_KEY, () => ({
  lastHeartbeat: null,
  listeners: new Set<(evt: HeartbeatEventPayload) => void>(),
}));

export function emitHeartbeatEvent(evt: Omit<HeartbeatEventPayload, "ts">) {
  const enriched: HeartbeatEventPayload = { ts: Date.now(), ...evt };
  state.lastHeartbeat = enriched;
  // Skip logging transient "requests-in-flight" skips: the wake layer retries
  // every second while a turn streams, which would flood the rolling log.
  const isTransientSkip = enriched.status === "skipped" && enriched.reason === "requests-in-flight";
  if (!isTransientSkip) {
    const message = `heartbeat ${enriched.status}${enriched.reason ? ` (${enriched.reason})` : ""}`;
    const meta = {
      status: enriched.status,
      to: enriched.to,
      channel: enriched.channel,
      durationMs: enriched.durationMs,
      replyChars: enriched.replyChars,
      ...(enriched.degenerateBlocked
        ? {
            degenerateBlocked: enriched.degenerateBlocked,
            blockedReplyChars: enriched.blockedReplyChars,
          }
        : {}),
    };
    if (enriched.status === "failed") {
      log.warn(message, meta);
    } else {
      log.info(message, meta);
    }
  }
  notifyListeners(state.listeners, enriched);
}

export function onHeartbeatEvent(listener: (evt: HeartbeatEventPayload) => void): () => void {
  return registerListener(state.listeners, listener);
}

export function getLastHeartbeatEvent(): HeartbeatEventPayload | null {
  return state.lastHeartbeat;
}

export function resetHeartbeatEventsForTest(): void {
  state.lastHeartbeat = null;
  state.listeners.clear();
}
