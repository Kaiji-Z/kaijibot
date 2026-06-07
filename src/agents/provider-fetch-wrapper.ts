import { captureHeadersFromResponse } from "../infra/retry-after-capture.js";
import { normalizeProviderId } from "./model-selection.js";

/**
 * Wraps a fetch function to capture Retry-After and rate-limit headers
 * from provider API responses into the ephemeral cache.
 *
 * The wrapper is transparent — it passes the request and response through
 * unchanged. The only side-effect is capturing headers on every response
 * (both success and error) because rate-limit hints can appear on either
 * (e.g. `x-ratelimit-remaining: 0` on a 200, or `retry-after` on a 429).
 *
 * Header-capture errors are silently swallowed so they can never break the
 * actual fetch flow.
 */
export function createHeaderCapturingFetch(
	provider: string,
	baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
	const normalizedProvider = normalizeProviderId(provider);
	return async (input, init) => {
		const response = await baseFetch(input, init);
		try {
			captureHeadersFromResponse(normalizedProvider, response.headers);
		} catch {
			// Header capture must never break the actual fetch flow.
		}
		return response;
	};
}

/**
 * Creates a header-capturing fetch for `provider` when a provider is present.
 *
 * Returns the original `baseFetch` unchanged when `provider` is missing or
 * empty, so callers can unconditionally pipe through this helper without a
 * guard.
 */
export function maybeCreateHeaderCapturingFetch(
	provider: string | undefined,
	baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
	if (!provider) return baseFetch;
	return createHeaderCapturingFetch(provider, baseFetch);
}
