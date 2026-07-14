/**
 * Gateway `/api/status` fetcher with TTL cache.
 *
 * Replaces the old `quota-reader.ts` and `usage-reader.ts` by pulling the
 * unified status payload (agents, usage, providers, cognitive) from the
 * gateway's own `/api/status` endpoint.
 *
 * Contract: NEVER throws. On any error (non-200, network failure, malformed
 * JSON), returns null and caches null for the TTL window.
 */

import type { ProviderQuota, CognitiveStats } from "../types.js";

export interface GatewayStatus {
  readonly version: string;
  readonly uptime: number;
  readonly agents: readonly {
    readonly id: string;
    readonly model?: string;
    readonly default?: boolean;
  }[];
  readonly usage: {
    readonly today: { readonly totalTokens: number; readonly totalCost: number } | null;
    readonly month: { readonly totalTokens: number; readonly totalCost: number } | null;
  } | null;
  readonly providers: readonly ProviderQuota[] | null;
  readonly cognitive: CognitiveStats | null;
}

const DEFAULT_PORT = 18789;
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

interface CacheEntry {
  readonly data: GatewayStatus | null;
  readonly timestamp: number;
}

let cache: CacheEntry | null = null;

/**
 * Fetch the gateway `/api/status` payload. Results are cached for 5 minutes.
 *
 * Returns null on any error (non-200, network failure, malformed JSON).
 * Never throws.
 */
export async function fetchGatewayStatus(opts?: {
  gatewayPort?: number;
}): Promise<GatewayStatus | null> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  const port = opts?.gatewayPort ?? DEFAULT_PORT;
  const url = `http://127.0.0.1:${port}/api/status`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      cache = { data: null, timestamp: Date.now() };
      return null;
    }

    const data = (await resp.json()) as GatewayStatus;
    cache = { data, timestamp: Date.now() };
    return data;
  } catch {
    cache = { data: null, timestamp: Date.now() };
    return null;
  }
}

/**
 * Clear the status cache, forcing the next `fetchGatewayStatus` call to
 * hit the network.
 */
export function resetStatusCache(): void {
  cache = null;
}
