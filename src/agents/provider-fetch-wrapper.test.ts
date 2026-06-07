import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__testing,
	consumeRateLimitResetMs,
	consumeRetryAfterMs,
} from "../infra/retry-after-capture.js";
import {
	createHeaderCapturingFetch,
	maybeCreateHeaderCapturingFetch,
} from "./provider-fetch-wrapper.js";

/** Build a mock Response with the given headers and status. */
function mockResponse(headers: Record<string, string>, status = 200): Response {
	return new Response("ok", { status, headers: new Headers(headers) });
}

/** A Response-like object whose `.headers` getter throws — used to verify the
 *  wrapper never lets capture errors escape into the fetch flow. */
function responseWithThrowingHeaders(status = 200): Response {
	const res = { status } as Response;
	Object.defineProperty(res, "headers", {
		get() {
			throw new Error("headers access failed");
		},
	});
	return res;
}

describe("provider-fetch-wrapper", () => {
	afterEach(() => {
		__testing.clearAll();
	});

	describe("createHeaderCapturingFetch — basic capture", () => {
		it("passes the response through unchanged (same status, same body)", async () => {
			const baseFetch = vi.fn(async () => mockResponse({}, 200));
			const wrapped = createHeaderCapturingFetch("zai", baseFetch);

			const res = await wrapped("https://example.com");

			expect(res.status).toBe(200);
			expect(await res.text()).toBe("ok");
		});

		it("captures retry-after (delta-seconds) into the cache", async () => {
			const baseFetch = vi.fn(async () => mockResponse({ "retry-after": "60" }, 429));
			const wrapped = createHeaderCapturingFetch("zai", baseFetch);

			await wrapped("https://example.com");

			expect(consumeRetryAfterMs("zai")).toBe(60_000);
		});

		it("captures retry-after-ms (raw ms) into the cache", async () => {
			const baseFetch = vi.fn(async () => mockResponse({ "retry-after-ms": "30000" }));
			const wrapped = createHeaderCapturingFetch("zai", baseFetch);

			await wrapped("https://example.com");

			expect(consumeRetryAfterMs("zai")).toBe(30_000);
		});

		it("captures anthropic rate-limit reset header", async () => {
			// A far-future RFC3339 timestamp → positive delta.
			const future = "2099-01-01T00:00:00Z";
			const baseFetch = vi.fn(async () =>
				mockResponse({ "anthropic-ratelimit-tokens-reset": future }),
			);
			const wrapped = createHeaderCapturingFetch("anthropic", baseFetch);

			await wrapped("https://example.com");

			const delta = consumeRateLimitResetMs("anthropic");
			expect(delta).not.toBeUndefined();
			expect(delta as number).toBeGreaterThan(0);
			expect(delta).toBe(Math.max(0, Date.parse(future) - Date.now()));
		});

		it("captures from error responses (429) just like success", async () => {
			const baseFetch = vi.fn(async () =>
				mockResponse({ "retry-after": "5" }, 429),
			);
			const wrapped = createHeaderCapturingFetch("zai", baseFetch);

			await wrapped("https://example.com");

			expect(consumeRetryAfterMs("zai")).toBe(5_000);
		});

		it("captures from success responses (200) just like error", async () => {
			const baseFetch = vi.fn(async () =>
				mockResponse({ "retry-after": "8" }, 200),
			);
			const wrapped = createHeaderCapturingFetch("zai", baseFetch);

			await wrapped("https://example.com");

			expect(consumeRetryAfterMs("zai")).toBe(8_000);
		});

		it("normalizes the provider id for the cache key", async () => {
			const baseFetch = vi.fn(async () => mockResponse({ "retry-after": "10" }));
			// "z.ai" normalizes to "zai".
			const wrapped = createHeaderCapturingFetch("z.ai", baseFetch);

			await wrapped("https://example.com");

			expect(consumeRetryAfterMs("zai")).toBe(10_000);
			// The raw, un-normalized key is never used.
			expect(consumeRetryAfterMs("z.ai")).toBeUndefined();
		});

		it("never throws when header capture fails — returns the response", async () => {
			const broken = responseWithThrowingHeaders(503);
			const baseFetch = vi.fn(async () => broken);
			const wrapped = createHeaderCapturingFetch("zai", baseFetch);

			const res = await wrapped("https://example.com");

			expect(res).toBe(broken);
			expect(res.status).toBe(503);
			// Nothing captured.
			expect(consumeRetryAfterMs("zai")).toBeUndefined();
		});
	});

	describe("createHeaderCapturingFetch — transparency", () => {
		it("forwards the request url and init unchanged", async () => {
			const baseFetch = vi.fn(async () => mockResponse({}));
			const wrapped = createHeaderCapturingFetch("zai", baseFetch);

			const url = "https://api.example.com/v1/chat";
			const init: RequestInit = {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ hello: "world" }),
			};

			await wrapped(url, init);

			expect(baseFetch).toHaveBeenCalledOnce();
			expect(baseFetch).toHaveBeenCalledWith(url, init);
		});

		it("captures headers on each of multiple sequential calls", async () => {
			const baseFetch = vi.fn(async () => mockResponse({ "retry-after": "3" }));
			const wrapped = createHeaderCapturingFetch("zai", baseFetch);

			await wrapped("https://example.com");
			// First consume drains the cache.
			expect(consumeRetryAfterMs("zai")).toBe(3_000);

			await wrapped("https://example.com");
			expect(consumeRetryAfterMs("zai")).toBe(3_000);
		});

		it("does nothing when no relevant headers are present", async () => {
			const baseFetch = vi.fn(async () =>
				mockResponse({ "content-type": "application/json" }),
			);
			const wrapped = createHeaderCapturingFetch("zai", baseFetch);

			await wrapped("https://example.com");

			expect(consumeRetryAfterMs("zai")).toBeUndefined();
			expect(consumeRateLimitResetMs("zai")).toBeUndefined();
		});

		it("returns the exact same response object (no clone)", async () => {
			const original = mockResponse({ "retry-after": "2" });
			const baseFetch = vi.fn(async () => original);
			const wrapped = createHeaderCapturingFetch("zai", baseFetch);

			const res = await wrapped("https://example.com");

			expect(res).toBe(original);
		});

		it("uses globalThis.fetch when no base is provided", async () => {
			const realFetch = globalThis.fetch;
			const stub = vi.fn(async () => mockResponse({}));
			globalThis.fetch = stub as typeof globalThis.fetch;
			try {
				const wrapped = createHeaderCapturingFetch("zai");
				await wrapped("https://example.com");
				expect(stub).toHaveBeenCalledOnce();
			} finally {
				globalThis.fetch = realFetch;
			}
		});
	});

	describe("maybeCreateHeaderCapturingFetch", () => {
		it("returns a capturing fetch for a valid provider", async () => {
			const baseFetch = vi.fn(async () => mockResponse({ "retry-after": "12" }));
			const wrapped = maybeCreateHeaderCapturingFetch("zai", baseFetch);

			await wrapped("https://example.com");

			expect(consumeRetryAfterMs("zai")).toBe(12_000);
		});

		it("returns the original baseFetch for an undefined provider", () => {
			const baseFetch = vi.fn(async () => mockResponse({}));
			const wrapped = maybeCreateHeaderCapturingFetch(undefined, baseFetch);

			expect(wrapped).toBe(baseFetch);
		});

		it("returns the original baseFetch for an empty-string provider", () => {
			const baseFetch = vi.fn(async () => mockResponse({}));
			const wrapped = maybeCreateHeaderCapturingFetch("", baseFetch);

			expect(wrapped).toBe(baseFetch);
		});

		it("does not capture when provider is absent", async () => {
			const baseFetch = vi.fn(async () => mockResponse({ "retry-after": "20" }));
			const wrapped = maybeCreateHeaderCapturingFetch(undefined, baseFetch);

			await wrapped("https://example.com");

			expect(consumeRetryAfterMs("zai")).toBeUndefined();
		});
	});

	describe("real fetch integration", () => {
		it("returns the same response object and captures headers", async () => {
			const response = mockResponse(
				{ "retry-after": "15", "x-ratelimit-reset-requests": "30s" },
				429,
			);
			const baseFetch = vi.fn(async () => response);

			const wrapped = createHeaderCapturingFetch("deepseek", baseFetch);
			const result = await wrapped("https://api.deepseek.com/chat");

			expect(result).toBe(response);
			expect(result.status).toBe(429);
			expect(consumeRetryAfterMs("deepseek")).toBe(15_000);
			expect(consumeRateLimitResetMs("deepseek")).toBe(30_000);
		});
	});
});
