import type { UserLifecycle, UserLifecycleStage } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the current lifecycle stage based on activity metrics.
 *
 * Transition rules:
 *   new     → active   : totalExchanges >= 5
 *   active  → dormant  : nowMs - lastActiveAt > 14 days
 *   dormant → lapsed   : nowMs - lastActiveAt > 45 days
 *
 * Reactivation (dormant/lapsed → active) is handled in curator when
 * the user sends a message; this function only handles time-based decay.
 */
export function computeLifecycleStage(
  lifecycle: UserLifecycle,
  totalExchanges: number,
  nowMs: number,
): UserLifecycleStage {
  const { stage, lastActiveAt } = lifecycle;
  const silenceMs = nowMs - lastActiveAt;

  switch (stage) {
    case "new":
      return totalExchanges >= 5 ? "active" : "new";

    case "active":
      return silenceMs > 14 * DAY_MS ? "dormant" : "active";

    case "dormant":
      return silenceMs > 45 * DAY_MS ? "lapsed" : "dormant";

    case "lapsed":
      // Stays lapsed until curator detects user activity
      return "lapsed";
  }
}

/**
 * Whether the scheduler should attempt re-engagement for this user.
 * True when dormant AND silent for more than 7 days.
 */
export function shouldReEngage(lifecycle: UserLifecycle, nowMs: number): boolean {
  if (lifecycle.stage !== "dormant") return false;
  return nowMs - lifecycle.lastActiveAt > 7 * DAY_MS;
}

/**
 * Domain depth decay multiplier by lifecycle stage.
 * Higher values = faster decay = observations are less stable.
 */
export function getDecayMultiplier(lifecycle: UserLifecycle): number {
  switch (lifecycle.stage) {
    case "active":
      return 1.0;
    case "new":
      return 1.5;
    case "dormant":
      return 2.0;
    case "lapsed":
      return 3.0;
  }
}

/**
 * Factor to multiply optimalFrequencyHours by.
 * Higher = less frequent proactive contact.
 */
export function getProactiveFrequencyFactor(lifecycle: UserLifecycle): number {
  switch (lifecycle.stage) {
    case "active":
      return 1.0;
    case "new":
      return 2.0;
    case "dormant":
      return 0.5;
    case "lapsed":
      return 3.0;
  }
}
