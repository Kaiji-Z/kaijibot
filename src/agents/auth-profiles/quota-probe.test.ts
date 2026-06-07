import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderUsageSnapshot } from "../../infra/provider-usage.types.js";
import type { AuthProfileCredential, AuthProfileStore } from "./types.js";
import { probeQuotaForCooldown, shouldProbeQuotaForFailure } from "./quota-probe.js";

// --- Mocks ----------------------------------------------------------------

const fetchZaiUsageMock = vi.hoisted(() => vi.fn());
const fetchClaudeUsageMock = vi.hoisted(() => vi.fn());
const fetchMinimaxUsageMock = vi.hoisted(() => vi.fn());

vi.mock("../../infra/provider-usage.fetch.zai.js", () => ({
  fetchZaiUsage: fetchZaiUsageMock,
}));
vi.mock("../../infra/provider-usage.fetch.claude.js", () => ({
  fetchClaudeUsage: fetchClaudeUsageMock,
}));
vi.mock("../../infra/provider-usage.fetch.minimax.js", () => ({
  fetchMinimaxUsage: fetchMinimaxUsageMock,
}));

// --- Helpers --------------------------------------------------------------

const NOW = 1_700_000_000_000;

function makeSnapshot(
  overrides: Partial<ProviderUsageSnapshot> & { provider: ProviderUsageSnapshot["provider"] },
): ProviderUsageSnapshot {
  return {
    displayName: overrides.provider,
    windows: [],
    ...overrides,
  };
}

function makeApiKeyProfile(provider: string, key?: string): AuthProfileCredential {
  return { type: "api_key", provider, key };
}

function makeOAuthProfile(provider: string, access: string): AuthProfileCredential {
  return {
    type: "oauth",
    provider,
    access,
    refresh: "refresh-token",
    expires: NOW + 3_600_000,
  };
}

function makeTokenProfile(provider: string, token?: string): AuthProfileCredential {
  return { type: "token", provider, token };
}

function makeStore(): AuthProfileStore {
  return { version: 1, profiles: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchZaiUsageMock.mockReset();
  fetchClaudeUsageMock.mockReset();
  fetchMinimaxUsageMock.mockReset();
});

// --- shouldProbeQuotaForFailure -------------------------------------------

describe("shouldProbeQuotaForFailure", () => {
  it("returns true for probeable provider + reason combinations", () => {
    expect(shouldProbeQuotaForFailure("zai", "rate_limit")).toBe(true);
    expect(shouldProbeQuotaForFailure("zai", "billing")).toBe(true);
    expect(shouldProbeQuotaForFailure("zai", "overloaded")).toBe(true);
    expect(shouldProbeQuotaForFailure("zai", "unknown")).toBe(true);
  });

  it("returns false for supported provider but non-probeable reason", () => {
    expect(shouldProbeQuotaForFailure("zai", "auth")).toBe(false);
    expect(shouldProbeQuotaForFailure("zai", "auth_permanent")).toBe(false);
    expect(shouldProbeQuotaForFailure("zai", "timeout")).toBe(false);
    expect(shouldProbeQuotaForFailure("zai", "format")).toBe(false);
  });

  it("returns true for other probeable providers", () => {
    expect(shouldProbeQuotaForFailure("anthropic", "rate_limit")).toBe(true);
    expect(shouldProbeQuotaForFailure("minimax", "rate_limit")).toBe(true);
    expect(shouldProbeQuotaForFailure("openai-codex", "rate_limit")).toBe(true);
  });

  it("returns false for unsupported providers", () => {
    expect(shouldProbeQuotaForFailure("gemini", "rate_limit")).toBe(false);
    expect(shouldProbeQuotaForFailure("deepseek", "rate_limit")).toBe(false);
  });

  it("returns false for empty provider", () => {
    expect(shouldProbeQuotaForFailure("", "rate_limit")).toBe(false);
  });

  it("normalizes provider aliases (z.ai → zai)", () => {
    expect(shouldProbeQuotaForFailure("z.ai", "rate_limit")).toBe(true);
    expect(shouldProbeQuotaForFailure("ZAI", "rate_limit")).toBe(true);
  });
});

// --- probeQuotaForCooldown: ZAI -------------------------------------------

describe("probeQuotaForCooldown — ZAI", () => {
  it("returns cooldown when one window is exhausted with a future resetAt", async () => {
    fetchZaiUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "zai",
        windows: [{ label: "5h", usedPercent: 100, resetAt: NOW + 5 * 3_600_000 }],
      }),
    );

    const result = await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai", "zai-key"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(result).not.toBeNull();
    expect(result!.cooldownMs).toBe(5 * 3_600_000);
    expect(result!.reason).toBe("quota_reset_zai");
    expect(result!.source).toBe("zai");
    expect(fetchZaiUsageMock).toHaveBeenCalledWith("zai-key", 3_000, fetch);
  });

  it("picks the exhausted window among multiple windows", async () => {
    fetchZaiUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "zai",
        windows: [
          { label: "5h", usedPercent: 50, resetAt: NOW + 2 * 3_600_000 },
          { label: "30d", usedPercent: 100, resetAt: NOW + 10 * 3_600_000 },
        ],
      }),
    );

    const result = await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai", "zai-key"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(result).not.toBeNull();
    // The 100% window's resetAt is used, not the 50% one
    expect(result!.cooldownMs).toBe(10 * 3_600_000);
  });

  it("returns null when no windows are exhausted", async () => {
    fetchZaiUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "zai",
        windows: [{ label: "5h", usedPercent: 50, resetAt: NOW + 3_600_000 }],
      }),
    );

    const result = await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai", "zai-key"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(result).toBeNull();
  });

  it("returns null when exhausted window has no resetAt", async () => {
    fetchZaiUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "zai",
        windows: [{ label: "5h", usedPercent: 100 }],
      }),
    );

    const result = await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai", "zai-key"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(result).toBeNull();
  });

  it("returns null when fetchZaiUsage throws", async () => {
    fetchZaiUsageMock.mockRejectedValue(new Error("network error"));

    const result = await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai", "zai-key"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(result).toBeNull();
  });

  it("returns null when snapshot has an error field", async () => {
    fetchZaiUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "zai",
        windows: [{ label: "5h", usedPercent: 100, resetAt: NOW + 5 * 3_600_000 }],
        error: "API error",
      }),
    );

    const result = await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai", "zai-key"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(result).toBeNull();
  });
});

// --- probeQuotaForCooldown: Claude ----------------------------------------

describe("probeQuotaForCooldown — Claude", () => {
  it("returns cooldown when exhausted window has a future resetAt", async () => {
    fetchClaudeUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "anthropic",
        windows: [{ label: "5h", usedPercent: 100, resetAt: NOW + 5 * 3_600_000 }],
      }),
    );

    const result = await probeQuotaForCooldown({
      provider: "anthropic",
      profile: makeTokenProfile("anthropic", "claude-token"),
      store: makeStore(),
      profileId: "anthropic:default",
      now: NOW,
    });

    expect(result).not.toBeNull();
    expect(result!.cooldownMs).toBe(5 * 3_600_000);
    expect(result!.reason).toBe("quota_reset_anthropic");
    expect(result!.source).toBe("anthropic");
    expect(fetchClaudeUsageMock).toHaveBeenCalledWith("claude-token", 3_000, fetch);
  });

  it("returns null when fetchClaudeUsage throws", async () => {
    fetchClaudeUsageMock.mockRejectedValue(new Error("timeout"));

    const result = await probeQuotaForCooldown({
      provider: "anthropic",
      profile: makeTokenProfile("anthropic", "claude-token"),
      store: makeStore(),
      profileId: "anthropic:default",
      now: NOW,
    });

    expect(result).toBeNull();
  });
});

// --- probeQuotaForCooldown: MiniMax ---------------------------------------

describe("probeQuotaForCooldown — MiniMax", () => {
  it("returns cooldown when exhausted window has a future resetAt", async () => {
    fetchMinimaxUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "minimax",
        windows: [{ label: "Weekly", usedPercent: 96, resetAt: NOW + 12 * 3_600_000 }],
      }),
    );

    const result = await probeQuotaForCooldown({
      provider: "minimax",
      profile: makeApiKeyProfile("minimax", "minimax-key"),
      store: makeStore(),
      profileId: "minimax:default",
      now: NOW,
    });

    expect(result).not.toBeNull();
    expect(result!.cooldownMs).toBe(12 * 3_600_000);
    expect(result!.reason).toBe("quota_reset_minimax");
    expect(result!.source).toBe("minimax");
    expect(fetchMinimaxUsageMock).toHaveBeenCalledWith("minimax-key", 3_000, fetch);
  });
});

// --- probeQuotaForCooldown: unsupported providers -------------------------

describe("probeQuotaForCooldown — unsupported providers", () => {
  it("returns null for gemini without calling any fetch", async () => {
    const result = await probeQuotaForCooldown({
      provider: "gemini",
      profile: makeApiKeyProfile("gemini", "gemini-key"),
      store: makeStore(),
      profileId: "gemini:default",
      now: NOW,
    });

    expect(result).toBeNull();
    expect(fetchZaiUsageMock).not.toHaveBeenCalled();
    expect(fetchClaudeUsageMock).not.toHaveBeenCalled();
    expect(fetchMinimaxUsageMock).not.toHaveBeenCalled();
  });

  it("returns null for deepseek without calling any fetch", async () => {
    const result = await probeQuotaForCooldown({
      provider: "deepseek",
      profile: makeApiKeyProfile("deepseek", "ds-key"),
      store: makeStore(),
      profileId: "deepseek:default",
      now: NOW,
    });

    expect(result).toBeNull();
    expect(fetchZaiUsageMock).not.toHaveBeenCalled();
    expect(fetchClaudeUsageMock).not.toHaveBeenCalled();
    expect(fetchMinimaxUsageMock).not.toHaveBeenCalled();
  });

  it("returns null for openai-codex (handled by WHAM, not here)", async () => {
    const result = await probeQuotaForCooldown({
      provider: "openai-codex",
      profile: makeOAuthProfile("openai-codex", "codex-access"),
      store: makeStore(),
      profileId: "openai-codex:default",
      now: NOW,
    });

    expect(result).toBeNull();
    expect(fetchZaiUsageMock).not.toHaveBeenCalled();
    expect(fetchClaudeUsageMock).not.toHaveBeenCalled();
    expect(fetchMinimaxUsageMock).not.toHaveBeenCalled();
  });
});

// --- probeQuotaForCooldown: credential extraction -------------------------

describe("probeQuotaForCooldown — credential extraction", () => {
  it("uses profile.key for api_key profiles", async () => {
    fetchZaiUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "zai",
        windows: [{ label: "5h", usedPercent: 100, resetAt: NOW + 3_600_000 }],
      }),
    );

    await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai", "the-api-key"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(fetchZaiUsageMock).toHaveBeenCalledWith("the-api-key", 3_000, fetch);
  });

  it("uses profile.access for oauth profiles", async () => {
    fetchZaiUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "zai",
        windows: [{ label: "5h", usedPercent: 100, resetAt: NOW + 3_600_000 }],
      }),
    );

    await probeQuotaForCooldown({
      provider: "zai",
      profile: makeOAuthProfile("zai", "oauth-access-token"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(fetchZaiUsageMock).toHaveBeenCalledWith("oauth-access-token", 3_000, fetch);
  });

  it("uses profile.token for token profiles", async () => {
    fetchClaudeUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "anthropic",
        windows: [{ label: "5h", usedPercent: 100, resetAt: NOW + 3_600_000 }],
      }),
    );

    await probeQuotaForCooldown({
      provider: "anthropic",
      profile: makeTokenProfile("anthropic", "static-token"),
      store: makeStore(),
      profileId: "anthropic:default",
      now: NOW,
    });

    expect(fetchClaudeUsageMock).toHaveBeenCalledWith("static-token", 3_000, fetch);
  });

  it("returns null when api_key profile has no key", async () => {
    const result = await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(result).toBeNull();
    expect(fetchZaiUsageMock).not.toHaveBeenCalled();
  });

  it("returns null when api_key profile has empty key", async () => {
    const result = await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai", ""),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(result).toBeNull();
    expect(fetchZaiUsageMock).not.toHaveBeenCalled();
  });

  it("returns null when token profile has no token", async () => {
    const result = await probeQuotaForCooldown({
      provider: "anthropic",
      profile: makeTokenProfile("anthropic"),
      store: makeStore(),
      profileId: "anthropic:default",
      now: NOW,
    });

    expect(result).toBeNull();
    expect(fetchClaudeUsageMock).not.toHaveBeenCalled();
  });
});

// --- probeQuotaForCooldown: cooldown capping ------------------------------

describe("probeQuotaForCooldown — cooldown capping", () => {
  it("caps cooldown at 24 hours when resetAt is far in the future", async () => {
    const fortyEightHoursMs = 48 * 60 * 60 * 1000;
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    fetchZaiUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "zai",
        windows: [
          { label: "30d", usedPercent: 100, resetAt: NOW + fortyEightHoursMs },
        ],
      }),
    );

    const result = await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai", "zai-key"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(result).not.toBeNull();
    expect(result!.cooldownMs).toBe(twentyFourHoursMs);
  });
});

// --- probeQuotaForCooldown: resetAt in the past ---------------------------

describe("probeQuotaForCooldown — resetAt in the past", () => {
  it("filters out exhausted windows whose resetAt is in the past", async () => {
    fetchZaiUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "zai",
        windows: [
          { label: "5h", usedPercent: 100, resetAt: NOW - 1_000 },
        ],
      }),
    );

    const result = await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai", "zai-key"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(result).toBeNull();
  });

  it("picks exhausted window with future resetAt even when another is in the past", async () => {
    fetchZaiUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "zai",
        windows: [
          { label: "5h", usedPercent: 100, resetAt: NOW - 5_000 },
          { label: "30d", usedPercent: 100, resetAt: NOW + 2 * 3_600_000 },
        ],
      }),
    );

    const result = await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai", "zai-key"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
    });

    expect(result).not.toBeNull();
    expect(result!.cooldownMs).toBe(2 * 3_600_000);
  });
});

// --- probeQuotaForCooldown: timeout passthrough ---------------------------

describe("probeQuotaForCooldown — timeout passthrough", () => {
  it("passes custom timeoutMs to the fetch function", async () => {
    fetchZaiUsageMock.mockResolvedValue(
      makeSnapshot({
        provider: "zai",
        windows: [{ label: "5h", usedPercent: 100, resetAt: NOW + 3_600_000 }],
      }),
    );

    await probeQuotaForCooldown({
      provider: "zai",
      profile: makeApiKeyProfile("zai", "zai-key"),
      store: makeStore(),
      profileId: "zai:default",
      now: NOW,
      timeoutMs: 8_000,
    });

    expect(fetchZaiUsageMock).toHaveBeenCalledWith("zai-key", 8_000, fetch);
  });
});
