/**
 * Generalized quota probe module.
 *
 * On failure, queries provider quota APIs to obtain real reset times for
 * cooldown calculation. Supports zai, anthropic (Claude), and minimax.
 * openai-codex (WHAM) is tracked separately and returns `null` here — its
 * refactor is a later task (T6).
 */
import { fetchClaudeUsage } from "../../infra/provider-usage.fetch.claude.js";
import { fetchMinimaxUsage } from "../../infra/provider-usage.fetch.minimax.js";
import { fetchZaiUsage } from "../../infra/provider-usage.fetch.zai.js";
import type { ProviderUsageSnapshot } from "../../infra/provider-usage.types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { normalizeProviderId } from "../model-selection.js";
import type { AuthProfileCredential, AuthProfileStore } from "./types.js";

const log = createSubsystemLogger("auth-profiles:quota-probe");

/** Maximum cooldown derived from a quota probe (24 hours). */
const MAX_QUOTA_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Default timeout for the quota probe HTTP call. */
const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
/** A window is considered "exhausted" when usedPercent >= this value. */
const EXHAUSTED_THRESHOLD = 95;

/** Providers whose quota APIs are supported by this module. */
const PROBEABLE_PROVIDERS = new Set(["zai", "anthropic", "minimax", "openai-codex"]);

/** Failure reasons that warrant probing the quota API. */
const PROBEABLE_REASONS = new Set(["rate_limit", "overloaded", "billing", "unknown"]);

export type CooldownProbeResult = {
  cooldownMs: number;
  /** e.g. "quota_reset_zai", "quota_exhausted_claude" */
  reason: string;
  /** provider id: "zai", "anthropic", "minimax", "openai-codex" */
  source: string;
};

/**
 * Whether a given provider+reason combination should trigger a quota probe.
 */
export function shouldProbeQuotaForFailure(provider: string, reason: string): boolean {
  const normalized = normalizeProviderId(provider);
  return PROBEABLE_PROVIDERS.has(normalized) && PROBEABLE_REASONS.has(reason);
}

/**
 * Extract the usable credential string from a profile.
 * Returns `undefined` when no credential is present.
 */
function resolveCredential(profile: AuthProfileCredential): string | undefined {
  if (profile.type === "api_key") {
    return profile.key;
  }
  if (profile.type === "oauth") {
    return profile.access;
  }
  // type === "token"
  return profile.token;
}

/**
 * Derive a cooldown duration from a usage snapshot.
 *
 * Finds exhausted windows (usedPercent >= threshold) whose resetAt is in the
 * future, picks the earliest reset, and caps the cooldown at MAX_QUOTA_COOLDOWN_MS.
 * Returns `null` if no exhausted window with a valid future resetAt exists.
 */
function deriveCooldownFromSnapshot(
  snapshot: ProviderUsageSnapshot,
  now: number,
): CooldownProbeResult | null {
  if (snapshot.error) {
    return null;
  }
  const exhausted = snapshot.windows.filter(
    (w) =>
      w.usedPercent >= EXHAUSTED_THRESHOLD &&
      typeof w.resetAt === "number" &&
      Number.isFinite(w.resetAt) &&
      w.resetAt > now,
  );
  if (exhausted.length === 0) {
    return null;
  }
  const earliestReset = Math.min(...exhausted.map((w) => w.resetAt as number));
  const cooldownMs = Math.min(Math.max(0, earliestReset - now), MAX_QUOTA_COOLDOWN_MS);
  return {
    cooldownMs,
    reason: `quota_reset_${snapshot.provider}`,
    source: snapshot.provider,
  };
}

/**
 * Probe a provider's quota API to determine the real cooldown duration.
 *
 * Returns `null` when:
 * - The provider is not supported (including openai-codex for now).
 * - No credential is available on the profile.
 * - The quota API returns an error or no exhausted windows.
 * - Any unexpected exception occurs.
 *
 * Never throws.
 */
export async function probeQuotaForCooldown(params: {
  provider: string;
  profile: AuthProfileCredential;
  store: AuthProfileStore;
  profileId: string;
  now?: number;
  timeoutMs?: number;
}): Promise<CooldownProbeResult | null> {
  const now = params.now ?? Date.now();
  const timeoutMs = params.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const { provider, profile, profileId } = params;

  const credential = resolveCredential(profile);
  if (!credential) {
    return null;
  }

  const normalized = normalizeProviderId(provider);

  try {
    let snapshot: ProviderUsageSnapshot;
    if (normalized === "zai") {
      snapshot = await fetchZaiUsage(credential, timeoutMs, fetch);
    } else if (normalized === "anthropic") {
      snapshot = await fetchClaudeUsage(credential, timeoutMs, fetch);
    } else if (normalized === "minimax") {
      snapshot = await fetchMinimaxUsage(credential, timeoutMs, fetch);
    } else {
      // openai-codex (WHAM) and any other provider: not handled here yet.
      // WHAM refactor is tracked separately (T6).
      return null;
    }

    const result = deriveCooldownFromSnapshot(snapshot, now);
    if (!result) {
      log.debug("quota-probe: no exhausted windows found", {
        provider: normalized,
        profileId,
        windowCount: snapshot.windows.length,
        snapshotError: snapshot.error,
      });
    }
    return result;
  } catch (error) {
    log.debug("quota-probe: fetch failed", {
      provider: normalized,
      profileId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
