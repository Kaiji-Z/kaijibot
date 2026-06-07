import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProfileCredential, AuthProfileStore } from "../../auth-profiles/types.js";

// --- Mocks ----------------------------------------------------------------

const probeQuotaForCooldownMock = vi.hoisted(() => vi.fn());
const shouldProbeQuotaForFailureMock = vi.hoisted(() => vi.fn());
const consumeRetryAfterMsMock = vi.hoisted(() => vi.fn());
const consumeRateLimitResetMsMock = vi.hoisted(() => vi.fn());

vi.mock("../../auth-profiles/quota-probe.js", () => ({
  probeQuotaForCooldown: probeQuotaForCooldownMock,
  shouldProbeQuotaForFailure: shouldProbeQuotaForFailureMock,
}));

vi.mock("../../../infra/retry-after-capture.js", () => ({
  consumeRetryAfterMs: consumeRetryAfterMsMock,
  consumeRateLimitResetMs: consumeRateLimitResetMsMock,
}));

// Import AFTER mocks are set up.
const { buildCooldownOverride } = await import("./cooldown-override.js");

// --- Helpers --------------------------------------------------------------

function makeApiKeyProfile(provider: string, key?: string): AuthProfileCredential {
  return { type: "api_key", provider, key: key ?? "test-key" };
}

function makeStore(profiles: Record<string, AuthProfileCredential> = {}): AuthProfileStore {
  return { version: 1, profiles };
}

function resetMocks() {
  probeQuotaForCooldownMock.mockReset();
  shouldProbeQuotaForFailureMock.mockReset();
  consumeRetryAfterMsMock.mockReset();
  consumeRateLimitResetMsMock.mockReset();
  // Defaults: no cached headers, no probing.
  consumeRetryAfterMsMock.mockReturnValue(undefined);
  consumeRateLimitResetMsMock.mockReturnValue(undefined);
  shouldProbeQuotaForFailureMock.mockReturnValue(false);
}

beforeEach(() => {
  resetMocks();
});

// --- Tests ----------------------------------------------------------------

describe("buildCooldownOverride", () => {
  it("probes quota API when a rate_limit failure occurs for a probeable provider (zai)", async () => {
    const store = makeStore({ p1: makeApiKeyProfile("zai") });
    shouldProbeQuotaForFailureMock.mockReturnValue(true);
    probeQuotaForCooldownMock.mockResolvedValue({ cooldownMs: 120_000, reason: "quota_reset_zai", source: "zai" });

    const override = await buildCooldownOverride({
      profileId: "p1",
      reason: "rate_limit",
      store,
    });

    expect(probeQuotaForCooldownMock).toHaveBeenCalledWith({
      provider: "zai",
      profile: store.profiles.p1,
      store,
      profileId: "p1",
    });
    expect(override).toEqual({ quotaProbeMs: 120_000 });
  });

  it("includes retryAfterMs from header cache in the override", async () => {
    const store = makeStore({ p1: makeApiKeyProfile("zai") });
    consumeRetryAfterMsMock.mockReturnValue(5_000);

    const override = await buildCooldownOverride({
      profileId: "p1",
      reason: "rate_limit",
      store,
    });

    expect(consumeRetryAfterMsMock).toHaveBeenCalledWith("zai");
    expect(override).toEqual({ retryAfterMs: 5_000 });
  });

  it("includes rateLimitResetMs and quotaProbeMs alongside retryAfterMs", async () => {
    const store = makeStore({ p1: makeApiKeyProfile("anthropic") });
    consumeRetryAfterMsMock.mockReturnValue(10_000);
    consumeRateLimitResetMsMock.mockReturnValue(30_000);
    shouldProbeQuotaForFailureMock.mockReturnValue(true);
    probeQuotaForCooldownMock.mockResolvedValue({
      cooldownMs: 60_000,
      reason: "quota_reset_anthropic",
      source: "anthropic",
    });

    const override = await buildCooldownOverride({
      profileId: "p1",
      reason: "overloaded",
      store,
    });

    expect(override).toEqual({
      retryAfterMs: 10_000,
      rateLimitResetMs: 30_000,
      quotaProbeMs: 60_000,
    });
  });

  it("returns undefined when no signals are available (graceful fallback to fixed backoff)", async () => {
    const store = makeStore({ p1: makeApiKeyProfile("deepseek") });
    // No cached headers, provider not probeable.

    const override = await buildCooldownOverride({
      profileId: "p1",
      reason: "rate_limit",
      store,
    });

    expect(override).toBeUndefined();
    expect(probeQuotaForCooldownMock).not.toHaveBeenCalled();
  });

  it("returns undefined when profile is missing from store", async () => {
    const store = makeStore({});

    const override = await buildCooldownOverride({
      profileId: "nonexistent",
      reason: "rate_limit",
      store,
    });

    expect(override).toBeUndefined();
    expect(consumeRetryAfterMsMock).not.toHaveBeenCalled();
    expect(probeQuotaForCooldownMock).not.toHaveBeenCalled();
  });

  it("catches probe errors and still returns header signals (graceful degradation)", async () => {
    const store = makeStore({ p1: makeApiKeyProfile("zai") });
    consumeRetryAfterMsMock.mockReturnValue(8_000);
    shouldProbeQuotaForFailureMock.mockReturnValue(true);
    probeQuotaForCooldownMock.mockRejectedValue(new Error("network failure"));

    const override = await buildCooldownOverride({
      profileId: "p1",
      reason: "rate_limit",
      store,
    });

    // Probe threw, but header signals are preserved.
    expect(override).toEqual({ retryAfterMs: 8_000 });
  });

  it("catches probe errors and returns undefined when no other signals exist", async () => {
    const store = makeStore({ p1: makeApiKeyProfile("zai") });
    shouldProbeQuotaForFailureMock.mockReturnValue(true);
    probeQuotaForCooldownMock.mockRejectedValue(new Error("network failure"));

    const override = await buildCooldownOverride({
      profileId: "p1",
      reason: "rate_limit",
      store,
    });

    expect(override).toBeUndefined();
  });

  it("does not probe when shouldProbeQuotaForFailure returns false", async () => {
    const store = makeStore({ p1: makeApiKeyProfile("zai") });
    shouldProbeQuotaForFailureMock.mockReturnValue(false);

    const override = await buildCooldownOverride({
      profileId: "p1",
      reason: "auth",
      store,
    });

    expect(probeQuotaForCooldownMock).not.toHaveBeenCalled();
    expect(override).toBeUndefined();
  });

  it("passes correct reason to shouldProbeQuotaForFailure", async () => {
    const store = makeStore({ p1: makeApiKeyProfile("zai") });

    await buildCooldownOverride({
      profileId: "p1",
      reason: "billing",
      store,
    });

    expect(shouldProbeQuotaForFailureMock).toHaveBeenCalledWith("zai", "billing");
  });

  it("includes only rateLimitResetMs when retryAfter and probe are unavailable", async () => {
    const store = makeStore({ p1: makeApiKeyProfile("minimax") });
    consumeRateLimitResetMsMock.mockReturnValue(45_000);

    const override = await buildCooldownOverride({
      profileId: "p1",
      reason: "rate_limit",
      store,
    });

    expect(override).toEqual({ rateLimitResetMs: 45_000 });
  });
});
