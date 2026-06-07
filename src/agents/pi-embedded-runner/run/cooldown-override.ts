import { probeQuotaForCooldown, shouldProbeQuotaForFailure } from "../../auth-profiles/quota-probe.js";
import type { CooldownOverride } from "../../auth-profiles/usage.js";
import type { AuthProfileFailureReason, AuthProfileStore } from "../../auth-profiles/types.js";
import { consumeRateLimitResetMs, consumeRetryAfterMs } from "../../../infra/retry-after-capture.js";

export type BuildCooldownOverrideParams = {
  profileId: string;
  reason: AuthProfileFailureReason;
  store: AuthProfileStore;
};

/**
 * Build a {@link CooldownOverride} from available signals: the header cache
 * (Retry-After / rate-limit-reset, captured by the fetch wrapper) and the
 * provider quota probe API.
 *
 * Signals are consumed destructively (ephemeral, single-use). All probe errors
 * are caught — they must NEVER break the failure-handling flow.
 *
 * @returns a non-empty override, or `undefined` when no signal is available
 * (the caller then falls back to fixed backoff inside `markAuthProfileFailure`).
 */
export async function buildCooldownOverride(
  params: BuildCooldownOverrideParams,
): Promise<CooldownOverride | undefined> {
  const { profileId, reason, store } = params;
  const profile = store.profiles[profileId];
  const profileProvider = profile?.provider;

  const override: CooldownOverride = {};

  if (profileProvider) {
    // 1. Consume Retry-After from header cache (captured by fetch wrapper).
    const retryAfterMs = consumeRetryAfterMs(profileProvider);
    if (retryAfterMs !== undefined) {
      override.retryAfterMs = retryAfterMs;
    }

    // 2. Consume rate-limit-reset from header cache.
    const rateLimitResetMs = consumeRateLimitResetMs(profileProvider);
    if (rateLimitResetMs !== undefined) {
      override.rateLimitResetMs = rateLimitResetMs;
    }

    // 3. Probe quota API for real reset time (only for supported providers).
    if (profile && shouldProbeQuotaForFailure(profileProvider, reason)) {
      try {
        const probeResult = await probeQuotaForCooldown({
          provider: profileProvider,
          profile,
          store,
          profileId,
        });
        if (probeResult) {
          override.quotaProbeMs = probeResult.cooldownMs;
        }
      } catch {
        // Probe failures are non-fatal — fall back to fixed backoff.
      }
    }
  }

  return Object.keys(override).length > 0 ? override : undefined;
}
