import type { PersonaTree } from "../types.js";

/**
 * Re-engagement budget — the ONLY channel that may contact a long-silent
 * user (goal 洞察投放人化重构, SPEC §2 layer 2).
 *
 * Semantics: when BOTH sides have been silent beyond D days and the social
 * ledger still has room below its veto cap, a single low-rate check-in may
 * be attempted at most once per R days, gated by a per-attempt probability
 * P. Each ignored attempt consumes a ledger slot (U+1 via the normal lazy
 * transition), so a never-answering user converges to silence after the cap
 * — three gentle check-ins, then peace.
 */

export const RE_ENGAGE_MUTUAL_SILENCE_MS = 10 * 24 * 3_600_000;
export const RE_ENGAGE_ATTEMPT_COOLDOWN_MS = 14 * 24 * 3_600_000;
export const RE_ENGAGE_ATTEMPT_PROBABILITY = 0.6;

export type ReEngageBudgetDecision = {
  allowed: boolean;
  reason: string;
};

function ledgerCap(persona: PersonaTree): number {
  return persona.rapport.trustScore < 0.7 ? 2 : 3;
}

export function evaluateReEngagementBudget(
  persona: PersonaTree,
  now: number,
  roll: number,
): ReEngageBudgetDecision {
  const { lifecycle, feedbackProfile } = persona;

  if (lifecycle.lastActiveAt <= 0 || feedbackProfile.lastProactiveAt <= 0) {
    return { allowed: false, reason: "no prior contact history" };
  }

  const userSilence = now - lifecycle.lastActiveAt;
  if (userSilence < RE_ENGAGE_MUTUAL_SILENCE_MS) {
    return { allowed: false, reason: "user silent < 10d" };
  }

  const mySilence = now - feedbackProfile.lastProactiveAt;
  if (mySilence < RE_ENGAGE_MUTUAL_SILENCE_MS) {
    return { allowed: false, reason: "my last send < 10d" };
  }

  const unanswered = feedbackProfile.consecutiveNoResponses ?? 0;
  if (unanswered >= ledgerCap(persona)) {
    return { allowed: false, reason: `ledger full (${unanswered} ≥ cap)` };
  }

  const lastAttempt = feedbackProfile.lastReEngageAttemptAt ?? 0;
  if (now - lastAttempt < RE_ENGAGE_ATTEMPT_COOLDOWN_MS) {
    return { allowed: false, reason: "attempt cooldown < 14d" };
  }

  if (roll >= RE_ENGAGE_ATTEMPT_PROBABILITY) {
    return { allowed: false, reason: "probability gate" };
  }

  return { allowed: true, reason: "budget check-in" };
}
