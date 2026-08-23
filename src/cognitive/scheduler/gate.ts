import { jaccardSimilarity } from "../../infra/text-similarity.js";
import { computeCalibrationSlope, applyCalibrationCorrection } from "../feedback/calibration.js";
import { getProactiveFrequencyFactor } from "../persona/lifecycle.js";
import type { PersonaTree } from "../types.js";
import type {
  GateDecision,
  GateContext,
  GradedGateDecision,
  SchedulerConfig,
  SchedulerEvent,
} from "./types.js";

// ── PRISM cost defaults ──────────────────────────────────────────────

const DEFAULT_C_FN = 7.0;
const DEFAULT_C_FA = 3.0;
const BASE_NEED = 0.6;
const LEDGER_TRUST_FLOOR_FOR_CAP = 0.7;

// Event-driven contact mirrors human motivation: "I saw something that
// reminded me of you" (persona_change) dominates; a periodic sweep that
// found something (info_scan) is moderate; a bare clock tick (timer) is the
// weakest excuse a friend could have.
const EVENT_FACTORS: Record<SchedulerEvent["type"], number> = {
  timer: 0.3,
  persona_change: 0.9,
  info_scan: 0.7,
  evolution_scan: 0.75,
  activity_scan: 0.8,
  external: 0.85,
};

// ── Legacy binary gate (backward compat wrapper) ─────────────────────

export function checkProactiveGate(
  persona: PersonaTree,
  config: SchedulerConfig,
  nowMs?: number,
): GateDecision {
  const now = nowMs ?? Date.now();
  const reasons: string[] = [];
  let suggestedDelayMs: number | undefined;

  if (persona.rapport.trustScore < config.minTrustScore) {
    reasons.push(
      `Trust score ${persona.rapport.trustScore.toFixed(2)} below minimum ${config.minTrustScore}`,
    );
  }

  const minIntervalMs = config.minIntervalHours * 60 * 60 * 1000;
  const timeSinceLastProactive = now - persona.feedbackProfile.lastProactiveAt;
  if (timeSinceLastProactive < minIntervalMs) {
    const remaining = minIntervalMs - timeSinceLastProactive;
    reasons.push(
      `Too soon — ${Math.round(remaining / 3600000)}h remaining of ${config.minIntervalHours}h interval`,
    );
    suggestedDelayMs = remaining;
  }

  if (persona.feedbackProfile.suppressUntil && persona.feedbackProfile.suppressUntil > now) {
    const remaining = persona.feedbackProfile.suppressUntil - now;
    reasons.push(`Suppressed for ${Math.round(remaining / 3600000)}h`);
    suggestedDelayMs = remaining;
  }

  if (config.activeHoursStart && config.activeHoursEnd) {
    const nowDate = new Date(now);
    const tz = config.timezone ?? "Asia/Shanghai";
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      });
      const timeStr = formatter.format(nowDate);
      const parts = timeStr.split(":");
      const currentHour = Number(parts[0]);
      const currentMin = Number(parts[1]);
      const currentMinutes = currentHour * 60 + currentMin;

      const [startHour, startMin] = config.activeHoursStart.split(":").map(Number);
      const [endHour, endMin] = config.activeHoursEnd.split(":").map(Number);
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
        reasons.push(`Outside active hours (${config.activeHoursStart}-${config.activeHoursEnd})`);
      }
    } catch {
      // Invalid timezone, skip this gate
    }
  }

  if (persona.rapport.totalExchanges < 5) {
    reasons.push(`Only ${persona.rapport.totalExchanges} exchanges — need at least 5`);
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    suggestedDelayMs,
  };
}

// ── PRISM cost-sensitive graded gate ─────────────────────────────────

export function computeGradedGate(context: GateContext): GradedGateDecision {
  const { persona, event, config } = context;
  const now = event.timestamp;
  const reasons: string[] = [];
  let suggestedDelayMs: number | undefined;

  // Hard vetoes (safety rails — bypass probabilistic calculation)

  if (config.activeHoursStart && config.activeHoursEnd && event.type === "timer") {
    const outside = isOutsideActiveHours(now, config);
    if (outside) {
      reasons.push(`Outside active hours (${config.activeHoursStart}-${config.activeHoursEnd})`);
    }
  }

  if (persona.feedbackProfile.suppressUntil && persona.feedbackProfile.suppressUntil > now) {
    if (persona.lifecycle.stage !== "dormant") {
      const remaining = persona.feedbackProfile.suppressUntil - now;
      reasons.push(`Suppressed for ${Math.round(remaining / 3600000)}h`);
      suggestedDelayMs = remaining;
    }
  }

  if (persona.rapport.totalExchanges < 5) {
    reasons.push(`Only ${persona.rapport.totalExchanges} exchanges — need at least 5`);
  }

  // Social ledger hard veto: too many unanswered proactive messages means
  // silence, regardless of everything else. Low-trust users get a tighter
  // cap. The ledger is cleared to zero by the user-reply path (curator
  // mergeExtraction), so this veto is always escapable by engagement —
  // that is the death-spiral guard, not a probability floor.
  const unanswered = persona.feedbackProfile.consecutiveNoResponses ?? 0;
  const ledgerCap = persona.rapport.trustScore < LEDGER_TRUST_FLOOR_FOR_CAP ? 2 : 3;
  if (unanswered >= ledgerCap) {
    reasons.push(`Ledger: ${unanswered} unanswered proactive messages (cap ${ledgerCap})`);
  }

  // If any hard veto fires, return early with zero probabilities
  if (reasons.length > 0) {
    return {
      pNeed: 0,
      pAccept: 0,
      pAct: 0,
      decision: false,
      reasons,
      suggestedDelayMs,
    };
  }

  let pNeed = computePNeed(persona, event, config, now);
  const lifecycleFactor = getProactiveFrequencyFactor(persona.lifecycle);
  pNeed = clamp01(pNeed / lifecycleFactor);
  let pAccept = computePAccept(persona);
  const calibrationSlope = computeCalibrationSlope(persona.calibrationHistory);
  pAccept = applyCalibrationCorrection(pAccept, calibrationSlope);
  // Geometric mean instead of raw product: pNeed and pAccept are positively
  // correlated (deep users have both high), so the raw product systematically
  // underestimates the joint probability. sqrt(pNeed*pAccept) lies between
  // the product and min(pNeed,pAccept), correcting the underestimation.
  const pAct = Math.sqrt(pNeed * pAccept);

  // Cost-sensitive threshold: τ = C_FA / (C_FN + C_FA)
  const cfn = config.costFalseNegative ?? DEFAULT_C_FN;
  const cfa = config.costFalseAlarm ?? DEFAULT_C_FA;
  const threshold = cfa / (cfn + cfa);

  const decision = pAct > threshold;

  if (!decision) {
    reasons.push(
      `pAct ${pAct.toFixed(3)} ≤ threshold ${threshold.toFixed(3)} (C_FN=${cfn}, C_FA=${cfa})`,
    );
  }

  return {
    pNeed,
    pAccept,
    pAct,
    decision,
    reasons,
    suggestedDelayMs,
  };
}

// ── p_need computation ───────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Multi-signal engagement factor replacing the old domainActivityFactor.
 *
 * Three signals:
 *   recency    (w=0.5): How recently the user was active — peaks at 7-14d drift
 *   investment (w=0.3): Relationship breadth via totalActiveDays — only grows
 *   breadth    (w=0.2): How many domains the user has recurring interest in
 *
 * Floors at 0.08 — structurally impossible to zero, preventing death spirals.
 */
export function computeEngagementFactor(persona: PersonaTree, now: number): number {
  const { lifecycle, domains } = persona;

  const silenceDays = lifecycle.lastActiveAt > 0 ? (now - lifecycle.lastActiveAt) / DAY_MS : 999;

  let recencyFactor: number;
  if (lifecycle.stage === "new") {
    recencyFactor = 0.3;
  } else if (silenceDays <= 1) {
    recencyFactor = 1.0;
  } else if (silenceDays <= 3) {
    recencyFactor = 0.9;
  } else if (silenceDays <= 7) {
    recencyFactor = 0.95;
  } else if (silenceDays <= 14) {
    recencyFactor = 1.0;
  } else if (silenceDays <= 45) {
    recencyFactor = 0.75;
  } else if (silenceDays <= 90) {
    recencyFactor = 0.5;
  } else if (silenceDays <= 180) {
    recencyFactor = 0.3;
  } else {
    recencyFactor = 0.15;
  }

  const investmentFactor = Math.log2(1 + lifecycle.totalActiveDays) / 7;

  const broadDomains = Object.values(domains).filter((d) => d.recurrence >= 2).length;
  const breadthFactor = Math.min(1, broadDomains / 5);

  const raw = recencyFactor * 0.5 + investmentFactor * 0.3 + breadthFactor * 0.2;
  return Math.max(0.08, raw);
}

/**
 * Social-decay time factor: momentum × ledger decay.
 *
 * momentum mirrors human availability — reaching out feels natural soon after
 * the user was active (1.3 within 30min, 1.0 at 2h, 0.85 approaching 24h).
 * Beyond 24h of user silence the normal cadence path closes entirely (0):
 * long-silent users are served only by the re-engagement budget, never by
 * the cadence machinery. Anti-double-send is NOT here — the scheduler's
 * min-interval cooldown owns that.
 *
 * g(U) is the social ledger decay {1.0, 0.45, 0.12} for U = 0, 1, 2+:
 * a friend's reticence compounds geometrically; a 3%-per-count linear slope
 * with a 0.7 floor proved too weak to influence behavior.
 */
export const LEDGER_DECAY = [1.0, 0.45, 0.12] as const;

export function computeLedgerFactor(persona: PersonaTree): number {
  const unanswered = persona.feedbackProfile.consecutiveNoResponses ?? 0;
  return LEDGER_DECAY[Math.min(unanswered, LEDGER_DECAY.length - 1)]!;
}

export function computeMomentum(persona: PersonaTree, now: number): number {
  if (persona.lifecycle.lastActiveAt <= 0) {
    return 0;
  }
  const hours = Math.max(0, (now - persona.lifecycle.lastActiveAt) / 3_600_000);
  if (hours > 24) {
    return 0;
  }
  if (hours <= 0.5) {
    return 1.3;
  }
  if (hours <= 2) {
    return 1.3 - (0.3 * (hours - 0.5)) / 1.5;
  }
  return 1.0 - (0.15 * (hours - 2)) / 22;
}

export function computeTimeFactor(
  persona: PersonaTree,
  _config: SchedulerConfig,
  now: number,
): number {
  return clamp01((computeMomentum(persona, now) / 1.3) * computeLedgerFactor(persona));
}

function computePNeed(
  persona: PersonaTree,
  event: SchedulerEvent,
  config: SchedulerConfig,
  now: number,
): number {
  const timeFactor = computeTimeFactor(persona, config, now);
  const eventFactor = EVENT_FACTORS[event.type] ?? 0.3;
  const engagementFactor = computeEngagementFactor(persona, now);

  const deepDomains = Object.values(persona.domains).filter((d) => d.depth >= 3).length;
  const depthBonus = 1 + 0.2 * Math.min(1, deepDomains / 3);

  return clamp01(BASE_NEED * timeFactor * eventFactor * engagementFactor * depthBonus);
}

// ── p_accept computation ─────────────────────────────────────────────

function computePAccept(persona: PersonaTree): number {
  const trustFactor = persona.rapport.trustScore;

  const banditEntries = Object.entries(persona.feedbackProfile.topicBandits);
  let banditFactor = 0.5;
  if (banditEntries.length > 0) {
    const meanPosterior =
      banditEntries.reduce((sum, [, b]) => sum + b.alpha / (b.alpha + b.beta), 0) /
      banditEntries.length;
    banditFactor = meanPosterior;
  }

  const PRIOR_ALPHA = 2;
  const PRIOR_BETA = 1;
  let positiveCount = 0;
  let totalCount = 0;
  for (const b of Object.values(persona.feedbackProfile.topicBandits)) {
    const pos = Math.max(0, b.alpha - PRIOR_ALPHA);
    const neg = Math.max(0, b.beta - PRIOR_BETA);
    positiveCount += pos;
    totalCount += pos + neg;
  }
  const feedbackFactor = totalCount > 0 ? positiveCount / totalCount : 0.5;

  return clamp01(0.5 * trustFactor + 0.3 * banditFactor + 0.2 * feedbackFactor);
}

// ── Repetition decay ──────────────────────────────────────────────────

/**
 * Compute a decay multiplier for pAct when recent insights have covered
 * the same domains repeatedly. Each overlapping recent insight entry
 * reduces the multiplier by a factor of 0.5.
 *
 * Example: if the last 3 insight domain sets all overlap, decay = 0.5^3 = 0.125
 */
export function computeRepetitionDecay(persona: PersonaTree): number {
  const recentDomains = persona.feedbackProfile.recentInsightDomains;
  if (!recentDomains || recentDomains.length < 2) {
    return 1;
  }

  // Compute pairwise Jaccard similarity between recent insight domain sets.
  // This measures whether recent insights are about the same topics,
  // without penalizing a single broad insight that happens to overlap
  // with prior narrow ones.
  const sets = recentDomains.map((ds) => new Set(ds.map((d) => d.toLowerCase())));
  let totalSimilarity = 0;
  let pairCount = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      totalSimilarity += jaccardSimilarity(sets[i]!, sets[j]!);
      pairCount++;
    }
  }
  if (pairCount === 0) {
    return 1;
  }

  const avgSimilarity = totalSimilarity / pairCount;
  if (avgSimilarity < 0.3) {
    return 1;
  }

  return Math.max(0.25, 1 - avgSimilarity);
}

// ── Helpers ──────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function isOutsideActiveHours(nowMs: number, config: SchedulerConfig): boolean {
  if (!config.activeHoursStart || !config.activeHoursEnd) {
    return false;
  }

  const nowDate = new Date(nowMs);
  const tz = config.timezone ?? "Asia/Shanghai";
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const timeStr = formatter.format(nowDate);
    const parts = timeStr.split(":");
    const currentHour = Number(parts[0]);
    const currentMin = Number(parts[1]);
    const currentMinutes = currentHour * 60 + currentMin;

    const [startHour, startMin] = config.activeHoursStart.split(":").map(Number);
    const [endHour, endMin] = config.activeHoursEnd.split(":").map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    if (startMinutes > endMinutes) {
      return currentMinutes >= endMinutes && currentMinutes < startMinutes;
    }
    return currentMinutes < startMinutes || currentMinutes > endMinutes;
  } catch {
    return false;
  }
}
