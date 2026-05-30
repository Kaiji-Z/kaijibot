/**
 * Card phase state machine types and helpers for Feishu streaming cards.
 *
 * Defines the lifecycle phases a card transitions through (idle → creating →
 * streaming → completed/aborted/terminated/creation_failed) along with
 * validated transitions and throttle constants.
 */

// ---------------------------------------------------------------------------
// CardPhase — explicit state machine replacing boolean flags
// ---------------------------------------------------------------------------

export const CARD_PHASES = {
  idle: 'idle',
  creating: 'creating',
  streaming: 'streaming',
  completed: 'completed',
  aborted: 'aborted',
  terminated: 'terminated',
  creation_failed: 'creation_failed',
} as const;

export type CardPhase = (typeof CARD_PHASES)[keyof typeof CARD_PHASES];

export const TERMINAL_PHASES: ReadonlySet<CardPhase> = new Set([
  'completed',
  'aborted',
  'terminated',
  'creation_failed',
]);

/**
 * Why a terminal phase was entered.
 *
 * - `normal`          — streaming completed successfully.
 * - `error`           — an error occurred during reply generation.
 * - `abort`           — explicitly cancelled by the caller.
 * - `unavailable`     — source message was deleted/recalled.
 * - `creation_failed` — card creation failed, falling back to static delivery.
 */
export type TerminalReason =
  | 'normal'
  | 'error'
  | 'abort'
  | 'unavailable'
  | 'creation_failed';

export const PHASE_TRANSITIONS: Record<CardPhase, ReadonlySet<CardPhase>> = {
  idle: new Set(['creating', 'aborted', 'terminated']),
  creating: new Set(['streaming', 'creation_failed', 'aborted', 'terminated']),
  streaming: new Set(['completed', 'aborted', 'terminated']),
  completed: new Set(),
  aborted: new Set(),
  terminated: new Set(),
  creation_failed: new Set(),
};

// ---------------------------------------------------------------------------
// Throttle constants
// ---------------------------------------------------------------------------

/**
 * Throttle intervals for card updates.
 *
 * - `CARDKIT_MS`          — CardKit `cardElement.content()`, designed for streaming.
 * - `PATCH_MS`            — `im.message.patch`, strict rate limits (code 230020).
 * - `LONG_GAP_THRESHOLD_MS` — After a long idle gap, defer the first flush briefly.
 * - `BATCH_AFTER_GAP_MS`  — Batching window after a long gap.
 * - `REASONING_STATUS_MS` — Throttle for reasoning status updates.
 */
export const THROTTLE_CONSTANTS = {
  CARDKIT_MS: 100,
  PATCH_MS: 1500,
  LONG_GAP_THRESHOLD_MS: 2000,
  BATCH_AFTER_GAP_MS: 300,
  REASONING_STATUS_MS: 1500,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns `true` if the phase is terminal (no further transitions). */
export function isTerminalPhase(phase: CardPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

/**
 * Transition from `current` to `target` phase.
 *
 * Validates the transition against `PHASE_TRANSITIONS` and returns the target
 * phase. Throws if the transition is not allowed.
 */
export function transitionPhase(current: CardPhase, target: CardPhase): CardPhase {
  const allowed = PHASE_TRANSITIONS[current];
  if (!allowed.has(target)) {
    throw new Error(
      `Invalid phase transition: ${current} → ${target}` +
        (allowed.size === 0 ? ` (${current} is terminal)` : ''),
    );
  }
  return target;
}
