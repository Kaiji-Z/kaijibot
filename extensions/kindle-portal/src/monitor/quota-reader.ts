/**
 * Provider quota reader for the ZAI API.
 *
 * Calls https://api.z.ai/api/monitor/usage/quota/limit to fetch the current
 * account usage percentage. Results are cached for 5 minutes to avoid
 * hammering the API on every dashboard refresh.
 *
 * Contract: NEVER throws. On any error (network, parse, auth, timeout), the
 * function returns null — the dashboard renders "Provider quota
 * unavailable" in that case. The cache stores null results too, so a
 * failed lookup won't be retried within the TTL window.
 */

export interface ProviderQuota {
  /** Provider id (e.g. "zai"). */
  readonly provider: string;
  /** Human-readable name for display (e.g. "ZAI"). */
  readonly displayName: string;
  /** Usage percentage 0-100. */
  readonly usedPercent: number;
  /** Optional reset timestamp (Unix ms epoch). */
  readonly resetAt?: number;
  /** Present when the last fetch failed (for diagnostics). */
  readonly error?: string;
}

const QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 5000;

interface CachedEntry {
  readonly data: ProviderQuota | null;
  readonly timestamp: number;
}

let cachedQuota: CachedEntry | null = null;

/**
 * Extract a usage percentage (0-100) from an unknown API response shape.
 * Tries common field names and recursively descends into nested objects.
 * Values <= 1 are treated as ratios and multiplied by 100.
 */
function extractPercent(data: unknown): number {
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    for (const key of ["used_percent", "usedPercent", "percent", "ratio", "usage_percent"]) {
      const v = obj[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        return v <= 1 ? v * 100 : v;
      }
    }
    for (const nestedKey of ["data", "usage", "quota", "result"]) {
      const nested = obj[nestedKey];
      if (typeof nested === "object" && nested !== null) {
        const inner = extractPercent(nested);
        if (inner > 0) {
          return inner;
        }
      }
    }
  }
  return 0;
}

/**
 * Fetch the current ZAI provider quota usage percentage.
 *
 * @param apiKey  ZAI API key (Bearer token). When empty, returns null
 *                immediately without a network call.
 * @returns A ProviderQuota object, or null on any failure.
 *          Cached for 5 minutes.
 */
export async function readProviderQuota(apiKey: string): Promise<ProviderQuota | null> {
  if (!apiKey || apiKey.length === 0) {
    return null;
  }

  // Serve from cache if still fresh.
  if (cachedQuota !== null && Date.now() - cachedQuota.timestamp < CACHE_TTL_MS) {
    return cachedQuota.data;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(QUOTA_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      cachedQuota = { data: null, timestamp: Date.now() };
      return null;
    }

    const data: unknown = await resp.json();
    const percent = extractPercent(data);
    const quota: ProviderQuota = {
      provider: "zai",
      displayName: "ZAI",
      usedPercent: percent,
    };
    cachedQuota = { data: quota, timestamp: Date.now() };
    return quota;
  } catch {
    // Network error, timeout, or JSON parse failure — cache the null result.
    cachedQuota = { data: null, timestamp: Date.now() };
    return null;
  }
}

/**
 * Reset the in-memory quota cache. Exposed for testing.
 */
export function resetQuotaCache(): void {
  cachedQuota = null;
}
