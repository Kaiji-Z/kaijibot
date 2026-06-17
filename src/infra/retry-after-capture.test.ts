import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  captureHeadersFromResponse,
  consumeRateLimitResetMs,
  consumeRetryAfterMs,
  parseRateLimitResetHeader,
  parseRetryAfterHeader,
  recordRateLimitResetMs,
  recordRetryAfterMs,
} from "./retry-after-capture.js";

// Fixed reference instants so date-relative assertions never depend on the
// real wall clock.
const REF_NOW = Date.parse("2025-01-01T00:00:00Z"); // before all "future" fixtures above
const PAST_NOW = Date.parse("2025-12-31T23:59:59Z"); // after most fixtures, so they look "past"

describe("parseRetryAfterHeader", () => {
  it("parses delta-seconds into milliseconds", () => {
    expect(parseRetryAfterHeader("120")).toBe(120_000);
  });

  it("treats zero as no delay", () => {
    expect(parseRetryAfterHeader("0")).toBeUndefined();
  });

  it("rejects negative integers", () => {
    expect(parseRetryAfterHeader("-5")).toBeUndefined();
  });

  it("rejects non-numeric strings", () => {
    expect(parseRetryAfterHeader("abc")).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(parseRetryAfterHeader(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(parseRetryAfterHeader(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseRetryAfterHeader("")).toBeUndefined();
  });

  it("parses a future HTTP-date into a positive delta", () => {
    // "2025-10-21" is in the future relative to REF_NOW.
    const delta = parseRetryAfterHeader("Wed, 21 Oct 2025 07:28:00 GMT", REF_NOW);
    expect(delta).not.toBeUndefined();
    expect(delta as number).toBeGreaterThan(0);
    expect(delta).toBe(Math.max(0, Date.parse("Wed, 21 Oct 2025 07:28:00 GMT") - REF_NOW));
  });

  it("clamps a past HTTP-date to zero", () => {
    // 2020 is in the past relative to REF_NOW.
    expect(parseRetryAfterHeader("Wed, 21 Oct 2020 07:28:00 GMT", REF_NOW)).toBe(0);
  });

  it("returns undefined for an invalid HTTP-date", () => {
    expect(parseRetryAfterHeader("invalid date")).toBeUndefined();
  });
});

describe("parseRateLimitResetHeader", () => {
  describe("rfc3339", () => {
    it("parses a future rfc3339 timestamp into a positive delta", () => {
      // 2025-12-31 is in the future relative to REF_NOW.
      const delta = parseRateLimitResetHeader("2025-12-31T23:59:59Z", "rfc3339", REF_NOW);
      expect(delta).not.toBeUndefined();
      expect(delta as number).toBeGreaterThan(0);
    });

    it("returns undefined for an invalid rfc3339 value", () => {
      expect(parseRateLimitResetHeader("invalid", "rfc3339")).toBeUndefined();
    });

    it("clamps a past timestamp to zero", () => {
      expect(parseRateLimitResetHeader("2020-01-01T00:00:00Z", "rfc3339", PAST_NOW)).toBe(0);
    });
  });

  describe("duration", () => {
    it("parses 6m0s", () => {
      expect(parseRateLimitResetHeader("6m0s", "duration")).toBe(360_000);
    });

    it("parses 1s", () => {
      expect(parseRateLimitResetHeader("1s", "duration")).toBe(1_000);
    });

    it("parses 2m59.56s", () => {
      // 2 minutes (120_000ms) + 59.56 seconds (59_560ms) = 179_560ms.
      expect(parseRateLimitResetHeader("2m59.56s", "duration")).toBe(179_560);
    });

    it("parses 500ms", () => {
      expect(parseRateLimitResetHeader("500ms", "duration")).toBe(500);
    });

    it("parses 1h30m", () => {
      expect(parseRateLimitResetHeader("1h30m", "duration")).toBe(5_400_000);
    });

    it("returns undefined for an invalid duration", () => {
      expect(parseRateLimitResetHeader("invalid", "duration")).toBeUndefined();
    });
  });

  describe("epoch-seconds", () => {
    it("parses epoch-seconds into a delta from now", () => {
      // 1718956800 = 2024-06-21. Future relative to REF_NOW (2025-01-01)? No —
      // it's before 2025-01-01, so use an earlier reference now.
      const earlierNow = Date.parse("2024-01-01T00:00:00Z");
      const delta = parseRateLimitResetHeader("1718956800", "epoch-seconds", earlierNow);
      expect(delta).not.toBeUndefined();
      expect(delta).toBe(Math.max(0, 1_718_956_800_000 - earlierNow));
    });

    it("returns undefined for an invalid epoch-seconds value", () => {
      expect(parseRateLimitResetHeader("invalid", "epoch-seconds")).toBeUndefined();
    });

    it("clamps a past epoch to zero", () => {
      expect(parseRateLimitResetHeader("1", "epoch-seconds", PAST_NOW)).toBe(0);
    });
  });
});

describe("retry-after cache", () => {
  beforeEach(() => __testing.clearAll());

  it("records and consumes a value", () => {
    recordRetryAfterMs("zai", 5000);
    expect(consumeRetryAfterMs("zai")).toBe(5000);
  });

  it("consumes only once", () => {
    recordRetryAfterMs("zai", 5000);
    consumeRetryAfterMs("zai");
    expect(consumeRetryAfterMs("zai")).toBeUndefined();
  });

  it("returns undefined for a missing provider", () => {
    expect(consumeRetryAfterMs("nonexistent")).toBeUndefined();
  });

  it("returns undefined once the entry has expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      recordRetryAfterMs("zai", 5000);
      vi.setSystemTime(61_000); // past the 60s TTL
      expect(consumeRetryAfterMs("zai")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts the oldest entry past 64 via FIFO", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      for (let i = 0; i < 65; i++) {
        recordRetryAfterMs(`p${i}`, i);
      }
      expect(__testing.getCacheSize().retryAfter).toBe(64);
      // Oldest (p0) was evicted; the rest survive.
      expect(consumeRetryAfterMs("p0")).toBeUndefined();
      expect(consumeRetryAfterMs("p64")).toBe(64);
      expect(consumeRetryAfterMs("p1")).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("rate-limit-reset cache", () => {
  beforeEach(() => __testing.clearAll());

  it("records and consumes a value", () => {
    recordRateLimitResetMs("zai", 7000);
    expect(consumeRateLimitResetMs("zai")).toBe(7000);
  });

  it("consumes only once", () => {
    recordRateLimitResetMs("zai", 7000);
    consumeRateLimitResetMs("zai");
    expect(consumeRateLimitResetMs("zai")).toBeUndefined();
  });

  it("returns undefined for a missing provider", () => {
    expect(consumeRateLimitResetMs("nonexistent")).toBeUndefined();
  });

  it("returns undefined once the entry has expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      recordRateLimitResetMs("zai", 7000);
      vi.setSystemTime(61_000);
      expect(consumeRateLimitResetMs("zai")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts the oldest entry past 64 via FIFO", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      for (let i = 0; i < 65; i++) {
        recordRateLimitResetMs(`p${i}`, i);
      }
      expect(__testing.getCacheSize().rateLimitReset).toBe(64);
      expect(consumeRateLimitResetMs("p0")).toBeUndefined();
      expect(consumeRateLimitResetMs("p64")).toBe(64);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("cache independence", () => {
  beforeEach(() => __testing.clearAll());

  it("retry-after and rate-limit caches do not cross-contaminate", () => {
    recordRetryAfterMs("zai", 5000);
    expect(consumeRateLimitResetMs("zai")).toBeUndefined();

    recordRateLimitResetMs("zai", 9000);
    expect(consumeRetryAfterMs("zai")).toBe(5000);
    expect(consumeRateLimitResetMs("zai")).toBe(9000);
  });
});

describe("captureHeadersFromResponse", () => {
  beforeEach(() => __testing.clearAll());

  it("captures retry-after (delta-seconds)", () => {
    captureHeadersFromResponse("zai", new Headers({ "retry-after": "60" }));
    expect(consumeRetryAfterMs("zai")).toBe(60_000);
  });

  it("captures retry-after-ms (raw ms)", () => {
    captureHeadersFromResponse("zai", new Headers({ "retry-after-ms": "30000" }));
    expect(consumeRetryAfterMs("zai")).toBe(30_000);
  });

  it("captures anthropic-ratelimit-tokens-reset (rfc3339) as a positive delta", () => {
    vi.useFakeTimers();
    vi.setSystemTime(REF_NOW);
    try {
      captureHeadersFromResponse(
        "anthropic",
        new Headers({ "anthropic-ratelimit-tokens-reset": "2025-12-31T23:59:59Z" }),
      );
      const delta = consumeRateLimitResetMs("anthropic");
      expect(delta).not.toBeUndefined();
      expect(delta as number).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stores the MAX across multiple rate-limit-reset headers", () => {
    // 6m0s = 360_000ms; 1h = 3_600_000ms → max is 3_600_000.
    captureHeadersFromResponse(
      "openai",
      new Headers({
        "x-ratelimit-reset-requests": "6m0s",
        "x-ratelimit-reset-tokens": "1h",
      }),
    );
    expect(consumeRateLimitResetMs("openai")).toBe(3_600_000);
  });

  it("leaves both caches empty when no relevant headers are present", () => {
    captureHeadersFromResponse("zai", new Headers({ "content-type": "application/json" }));
    expect(consumeRetryAfterMs("zai")).toBeUndefined();
    expect(consumeRateLimitResetMs("zai")).toBeUndefined();
  });

  it("ignores an invalid retry-after value", () => {
    captureHeadersFromResponse("zai", new Headers({ "retry-after": "garbage" }));
    expect(consumeRetryAfterMs("zai")).toBeUndefined();
  });

  it("ignores a zero retry-after-ms value", () => {
    captureHeadersFromResponse("zai", new Headers({ "retry-after-ms": "0" }));
    expect(consumeRetryAfterMs("zai")).toBeUndefined();
  });
});

afterEach(() => {
  __testing.clearAll();
});
