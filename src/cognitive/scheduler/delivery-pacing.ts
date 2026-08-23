import type { PersonaTree } from "../types.js";
import type { SchedulerEvent } from "./types.js";

/**
 * Delivery pacing — replaces the deterministic min-interval metronom (goal
 * 洞察投放人化重构, iteration 2 "1-2 条/天 + 非定时感").
 *
 * A deterministic spacing floor turns delivery rhythm INTO the floor value
 * (every eligible tick sends → metronomic "scheduled task" feel). Real
 * friend messaging is event-driven bursts under a daily self-restraint:
 * sometimes two shares in one conversation, then nothing for a day.
 *
 * Three mechanisms:
 *   1. Daily budget (hard cap, default 2/day): "already shared twice today,
 *      save it for tomorrow." Guaranteed ceiling regardless of event traffic.
 *   2. Stochastic hazard gate: between sends, P(send now) rises linearly
 *      from 0 (at the 1h floor) to 1 (at floor + targetGap). Drawn per-event
 *      from a seeded roll → some days 0 sends, some 2; never a fixed rhythm.
 *      targetGap couples to the LEARNED frequency: replied-since-send → F,
 *      unanswered → 2F (eagerness tracks intimacy, ceiling stays the cap).
 *   3. Conversational moment: a persona_change event while the user was
 *      active <2h ago bypasses the hazard ("you're into X? see this") —
 *      still bound by the 1h absolute floor and the daily cap.
 */

export const MIN_SEND_GAP_H = 1;
export const CONVERSATIONAL_WINDOW_H = 2;
const DAY_MS = 24 * 3_600_000;
const HR_MS = 3_600_000;

export type PacingVerdict = {
  allowed: boolean;
  reason: string;
};

function dayIndex(ts: number): number {
  // UTC-anchored day boundary (= 08:00 Asia/Shanghai): budget resets before
  // the morning activity window, and activeHours keeps nights quiet anyway.
  return Math.floor(ts / DAY_MS);
}

/**
 * Daily send budget. `dailySendAnchorDay`/`dailySendCount` live on
 * feedbackProfile; the counter self-resets on day rollover (no cron needed).
 */
export function checkDailyBudget(persona: PersonaTree, now: number, cap: number): PacingVerdict {
  const anchor = persona.feedbackProfile.dailySendAnchorDay;
  const count = persona.feedbackProfile.dailySendCount;
  if (anchor !== dayIndex(now)) {
    return { allowed: true, reason: "new day" };
  }
  if ((count ?? 0) >= cap) {
    return { allowed: false, reason: `daily budget exhausted (${count}/${cap})` };
  }
  return { allowed: true, reason: `daily budget ${count}/${cap}` };
}

/** Record one delivered send against today's budget. Mutates the persona. */
export function bumpDailySend(persona: PersonaTree, now: number): void {
  const day = dayIndex(now);
  if (persona.feedbackProfile.dailySendAnchorDay !== day) {
    persona.feedbackProfile.dailySendAnchorDay = day;
    persona.feedbackProfile.dailySendCount = 1;
    return;
  }
  persona.feedbackProfile.dailySendCount = (persona.feedbackProfile.dailySendCount ?? 0) + 1;
}

/**
 * Stochastic spacing between sends. `roll` ∈ [0,1) is supplied by the caller
 * (seededRandom-derived) so this stays pure and deterministic under test.
 */
export function checkStochasticSpacing(
  persona: PersonaTree,
  eventType: SchedulerEvent["type"],
  now: number,
  roll: number,
): PacingVerdict {
  const lastSendAt = persona.feedbackProfile.lastProactiveAt;
  if (lastSendAt <= 0) {
    return { allowed: true, reason: "first contact" };
  }

  const elapsedH = (now - lastSendAt) / HR_MS;
  if (elapsedH < MIN_SEND_GAP_H) {
    return { allowed: false, reason: `absolute floor ${MIN_SEND_GAP_H}h` };
  }

  const conversational =
    eventType === "persona_change" &&
    persona.lifecycle.lastActiveAt > 0 &&
    now - persona.lifecycle.lastActiveAt < CONVERSATIONAL_WINDOW_H * HR_MS;
  if (conversational) {
    return { allowed: true, reason: "conversational moment" };
  }

  const userRepliedSinceSend = persona.lifecycle.lastActiveAt > lastSendAt;
  const learnedF = Math.max(1, persona.feedbackProfile.optimalFrequencyHours);
  const targetGapH = userRepliedSinceSend ? learnedF : learnedF * 2;
  const hazard = Math.min(1, (elapsedH - MIN_SEND_GAP_H) / targetGapH);
  if (roll >= hazard) {
    return { allowed: false, reason: `hazard draw ${roll.toFixed(2)} ≥ ${hazard.toFixed(2)}` };
  }
  return { allowed: true, reason: `hazard ${hazard.toFixed(2)} > draw ${roll.toFixed(2)}` };
}
