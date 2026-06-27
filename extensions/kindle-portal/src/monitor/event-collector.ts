import type { FleetState, AgentEventPayload } from "./fleet-state.js";

/** Subscriber contract — returns an unsubscribe function. */
export type SubscribeFn = (listener: (payload: AgentEventPayload) => void) => () => void;

/** Optional logger surface; only `warn` is used by the collector. */
export interface CollectorLogger {
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

/**
 * Wire the live agent event stream into {@link FleetState}.
 *
 * `subscribe` is injected (rather than reading
 * `api.runtime.events.onAgentEvent` directly) so tests can drive synthetic
 * events and production code can bind the real subscriber at the call site.
 *
 * Any exception thrown by `state.applyEvent` is swallowed and reported via
 * `logger.warn` — a single malformed event must never tear down the live
 * monitor.
 *
 * @returns The unsubscribe function returned by `subscribe`.
 */
export function attachAgentEventCollector(
  state: FleetState,
  subscribe: SubscribeFn,
  logger?: CollectorLogger,
): () => void {
  return subscribe((payload) => {
    try {
      state.applyEvent(payload);
    } catch (e) {
      logger?.warn?.(`[kindle-portal] fleet state applyEvent threw: ${String(e)}`);
    }
  });
}
