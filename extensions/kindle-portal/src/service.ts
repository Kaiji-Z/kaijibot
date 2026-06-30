import type { FleetState } from "./monitor/fleet-state.js";
import { attachAgentEventCollector, type SubscribeFn } from "./monitor/event-collector.js";
import type { KaijiBotPluginService, KaijiBotPluginServiceContext } from "../api.js";

export const KINDLE_PORTAL_SERVICE_ID = "kindle-portal";

export type ServiceLogger = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
};

export interface CreateServiceOpts {
  state: FleetState;
  subscribe: SubscribeFn;
  logger?: ServiceLogger;
  pruneIntervalMs?: number;
  staleAfterMs?: number;
  pruneMaxAgeMs?: number;
}

const DEFAULT_PRUNE_INTERVAL_MS = 60_000;
const DEFAULT_STALE_AFTER_MS = 120_000;
const DEFAULT_PRUNE_MAX_AGE_MS = 300_000;

export function createKindlePortalService(
  opts: CreateServiceOpts,
): KaijiBotPluginService {
  const pruneIntervalMs = opts.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
  const staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const pruneMaxAgeMs = opts.pruneMaxAgeMs ?? DEFAULT_PRUNE_MAX_AGE_MS;

  let started = false;
  let collectorUnsub: (() => void) | undefined;
  let pruneTimer: ReturnType<typeof setInterval> | undefined;

  async function start(_ctx: KaijiBotPluginServiceContext): Promise<void> {
    if (started) {return;}
    started = true;

    try {
      collectorUnsub = attachAgentEventCollector(opts.state, opts.subscribe, opts.logger);
    } catch (e) {
      opts.logger?.warn?.(
        `[kindle-portal] failed to attach event collector: ${String(e)}`,
      );
    }

    pruneTimer = setInterval(() => {
      opts.state.markStale(staleAfterMs);
      opts.state.pruneStale(pruneMaxAgeMs);
    }, pruneIntervalMs);

    try {
      (pruneTimer as unknown as { unref?: () => void })?.unref?.();
    } catch {
      // best-effort
    }

    opts.logger?.info?.("[kindle-portal] service started");
  }

  async function stop(_ctx: KaijiBotPluginServiceContext): Promise<void> {
    if (!started) {return;}

    try {
      collectorUnsub?.();
    } catch (e) {
      opts.logger?.warn?.(
        `[kindle-portal] failed to unsubscribe collector: ${String(e)}`,
      );
    }

    if (pruneTimer !== undefined) {
      clearInterval(pruneTimer);
    }

    opts.state.clear();

    started = false;
    collectorUnsub = undefined;
    pruneTimer = undefined;

    opts.logger?.info?.("[kindle-portal] service stopped");
  }

  return { id: KINDLE_PORTAL_SERVICE_ID, start, stop };
}
