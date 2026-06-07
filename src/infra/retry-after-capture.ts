/**
 * Retry-After / rate-limit-reset capture.
 *
 * Parses `Retry-After` and provider-specific rate-limit-reset HTTP headers into
 * millisecond delays, and stores them in a provider-keyed ephemeral cache so
 * callers can consume the hint on their next request to the same provider.
 *
 * Pure standard library — no external dependencies.
 */

/** Output format for {@link parseRateLimitResetHeader}. */
export type RateLimitResetFormat = "rfc3339" | "duration" | "epoch-seconds";

/**
 * Parse a `Retry-After` header (RFC 7231) into a millisecond delay.
 *
 * - Delta-seconds (e.g. `"120"`): positive integer seconds → ms.
 *   `"0"` and negative values resolve to `undefined` (no delay).
 * - HTTP-date (e.g. `"Wed, 21 Oct 2025 07:28:00 GMT"`): clamped to `>= 0` delta
 *   from `now`. Invalid dates resolve to `undefined`.
 * - `null` / `undefined` / empty → `undefined`.
 *
 * @returns delay in ms, or `undefined` when there is nothing to wait for.
 */
export function parseRetryAfterHeader(
	value: string | null | undefined,
	now: number = Date.now(),
): number | undefined {
	if (value == null) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	// Delta-seconds: a (possibly negative) integer string. Match signed
	// integers explicitly so e.g. "-5" is rejected here rather than being
	// misread as an HTTP-date by Date.parse (which accepts some numeric forms).
	if (/^-?\d+$/.test(trimmed)) {
		const seconds = Number(trimmed);
		if (seconds <= 0) return undefined; // 0 or negative → no delay
		return seconds * 1000;
	}

	// Otherwise treat as an HTTP-date.
	const parsed = Date.parse(trimmed);
	if (Number.isNaN(parsed)) return undefined;
	return Math.max(0, parsed - now);
}

/**
 * Parse a Go-style duration string (e.g. `"6m0s"`, `"1h30m"`, `"500ms"`,
 * `"2m59.56s"`) into milliseconds.
 *
 * Supports `ns`, `us`/`µs`, `ms`, `s`, `m`, `h`. Returns `undefined` when the
 * input is not a valid duration.
 */
function parseGoDurationMs(input: string): number | undefined {
	// Validate that the whole string is a sequence of <number><unit> components.
	if (!/^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/.test(input)) {
		return undefined;
	}
	const re = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g;
	let totalMs = 0;
	let match: RegExpExecArray | null;
	while ((match = re.exec(input)) !== null) {
		const amount = Number(match[1]);
		switch (match[2]) {
			case "ns":
				totalMs += amount / 1_000_000;
				break;
			case "us":
			case "µs":
				totalMs += amount / 1_000;
				break;
			case "ms":
				totalMs += amount;
				break;
			case "s":
				totalMs += amount * 1_000;
				break;
			case "m":
				totalMs += amount * 60_000;
				break;
			case "h":
				totalMs += amount * 3_600_000;
				break;
		}
	}
	return Number.isFinite(totalMs) ? totalMs : undefined;
}

/**
 * Parse a rate-limit-reset header into a millisecond delay from `now`.
 *
 * - `"rfc3339"`: e.g. `"2025-10-21T07:28:00Z"` → clamped delta from `now`.
 * - `"duration"`: Go-style duration → ms.
 * - `"epoch-seconds"`: e.g. `"1718956800"` → clamped delta from `now`.
 *
 * @returns delay in ms, or `undefined` when the value is invalid.
 */
export function parseRateLimitResetHeader(
	value: string | null | undefined,
	format: RateLimitResetFormat,
	now: number = Date.now(),
): number | undefined {
	if (value == null) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	switch (format) {
		case "rfc3339": {
			const parsed = Date.parse(trimmed);
			if (Number.isNaN(parsed)) return undefined;
			return Math.max(0, parsed - now);
		}
		case "duration": {
			return parseGoDurationMs(trimmed);
		}
		case "epoch-seconds": {
			if (!/^\d+$/.test(trimmed)) return undefined;
			const seconds = Number(trimmed);
			return Math.max(0, seconds * 1000 - now);
		}
	}
}

// ---------------------------------------------------------------------------
// Provider-keyed ephemeral cache (TTL=60s, max 64 entries, FIFO eviction).
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 64;

type CacheEntry = { value: number; expiresAt: number };

const retryAfterCache = new Map<string, CacheEntry>();
const rateLimitResetCache = new Map<string, CacheEntry>();

function evictIfNeeded(cache: Map<string, CacheEntry>): void {
	while (cache.size > CACHE_MAX_SIZE) {
		let oldestKey: string | undefined;
		let oldestExpiry = Infinity;
		for (const [key, entry] of cache) {
			if (entry.expiresAt < oldestExpiry) {
				oldestExpiry = entry.expiresAt;
				oldestKey = key;
			}
		}
		if (oldestKey === undefined) break;
		cache.delete(oldestKey);
	}
}

function recordEntry(cache: Map<string, CacheEntry>, provider: string, ms: number): void {
	cache.set(provider, { value: ms, expiresAt: Date.now() + CACHE_TTL_MS });
	evictIfNeeded(cache);
}

function consumeEntry(cache: Map<string, CacheEntry>, provider: string): number | undefined {
	const entry = cache.get(provider);
	if (entry === undefined) return undefined;
	// Always remove on consume (ephemeral, single-use).
	cache.delete(provider);
	if (Date.now() >= entry.expiresAt) return undefined; // expired
	return entry.value;
}

/** Store a `Retry-After` delay (ms) for `provider`. */
export function recordRetryAfterMs(provider: string, ms: number): void {
	recordEntry(retryAfterCache, provider, ms);
}

/** Return and delete the stored `Retry-After` delay for `provider` (if fresh). */
export function consumeRetryAfterMs(provider: string): number | undefined {
	return consumeEntry(retryAfterCache, provider);
}

/** Store a rate-limit-reset delay (ms) for `provider`. */
export function recordRateLimitResetMs(provider: string, ms: number): void {
	recordEntry(rateLimitResetCache, provider, ms);
}

/** Return and delete the stored rate-limit-reset delay for `provider` (if fresh). */
export function consumeRateLimitResetMs(provider: string): number | undefined {
	return consumeEntry(rateLimitResetCache, provider);
}

// ---------------------------------------------------------------------------
// Combined capture from a Headers object.
// ---------------------------------------------------------------------------

/** Headers that map to a rate-limit-reset delay, with their parse format. */
const RATE_LIMIT_RESET_HEADERS: ReadonlyArray<readonly [string, RateLimitResetFormat]> = [
	["anthropic-ratelimit-tokens-reset", "rfc3339"],
	["anthropic-ratelimit-requests-reset", "rfc3339"],
	["x-ratelimit-reset-requests", "duration"],
	["x-ratelimit-reset-tokens", "duration"],
];

/**
 * Inspect a response's headers and record any `Retry-After` / rate-limit-reset
 * hints into the ephemeral cache keyed by `provider`.
 *
 * - `retry-after` (delta-seconds or HTTP-date) and `retry-after-ms` (raw ms)
 *   feed {@link recordRetryAfterMs}.
 * - Multiple rate-limit-reset headers are parsed; the longest reset wins
 *   (stored via {@link recordRateLimitResetMs}).
 */
export function captureHeadersFromResponse(provider: string, headers: Headers): void {
	const retryAfter = headers.get("retry-after");
	if (retryAfter !== null) {
		const ms = parseRetryAfterHeader(retryAfter);
		if (ms !== undefined) recordRetryAfterMs(provider, ms);
	}

	const retryAfterMsRaw = headers.get("retry-after-ms");
	if (retryAfterMsRaw !== null) {
		const trimmed = retryAfterMsRaw.trim();
		if (/^\d+$/.test(trimmed)) {
			const ms = Number(trimmed);
			if (ms > 0) recordRetryAfterMs(provider, ms);
		}
	}

	const resetCandidates: number[] = [];
	for (const [name, format] of RATE_LIMIT_RESET_HEADERS) {
		const raw = headers.get(name);
		if (raw === null) continue;
		const ms = parseRateLimitResetHeader(raw, format);
		if (ms !== undefined) resetCandidates.push(ms);
	}
	if (resetCandidates.length > 0) {
		recordRateLimitResetMs(provider, Math.max(...resetCandidates));
	}
}

// ---------------------------------------------------------------------------
// Test utilities.
// ---------------------------------------------------------------------------

export const __testing = {
	/** Clear both ephemeral caches. */
	clearAll(): void {
		retryAfterCache.clear();
		rateLimitResetCache.clear();
	},
	/** Report the size of each cache (used for eviction tests). */
	getCacheSize(): { retryAfter: number; rateLimitReset: number } {
		return { retryAfter: retryAfterCache.size, rateLimitReset: rateLimitResetCache.size };
	},
};
