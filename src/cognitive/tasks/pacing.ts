import type { FeedbackProfile, PersonaTree } from "../types.js";

/**
 * Task-creation pacing gate — tasks are actions, and actions are gated by
 * the same social-ledger hard veto as proactive messages (SPEC decision 1:
 * "任务的行动必须被与消息相同的节奏系统门控").
 *
 * Mirrors the scheduler hard veto in src/cognitive/scheduler/gate.ts:135-144
 * (ledgerCap = 3, or 2 when trustScore < LEDGER_TRUST_FLOOR_FOR_CAP = 0.7)
 * plus the suppressUntil safety bar (gate.ts:123-129). gate.ts is outside
 * this goal's writable scope, so the thresholds are duplicated here — the
 * tests pin them; keep both files in sync when the veto changes.
 *
 * Ordering note: the ledger is cleared by the user-reply path, so a task
 * requested BY the user in the current turn should be created after that
 * turn's post-turn persona extraction (which resets U to 0), otherwise a
 * stale U could veto a direct user request. Entry wiring must respect this.
 */

/** Keep in sync with LEDGER_TRUST_FLOOR_FOR_CAP in scheduler/gate.ts. */
export const TASK_LEDGER_TRUST_FLOOR = 0.7;

export type TaskCreationGateResult = {
  allowed: boolean;
  reason?: string;
};

export function evaluateTaskCreationGate(
  persona: Pick<PersonaTree, "feedbackProfile" | "rapport" | "lifecycle">,
  now: number = Date.now(),
): TaskCreationGateResult {
  const profile: FeedbackProfile | undefined = persona.feedbackProfile;
  const unanswered = profile?.consecutiveNoResponses ?? 0;
  const ledgerCap = persona.rapport.trustScore < TASK_LEDGER_TRUST_FLOOR ? 2 : 3;
  if (unanswered >= ledgerCap) {
    return {
      allowed: false,
      reason: `Ledger: ${unanswered} unanswered proactive messages (cap ${ledgerCap})`,
    };
  }
  if (profile?.suppressUntil && profile.suppressUntil > now) {
    return { allowed: false, reason: "User suppression window active" };
  }
  return { allowed: true };
}
