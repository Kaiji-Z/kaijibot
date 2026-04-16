import type { PersonaTree } from "../types.js";
import type {
  GateDecision,
  GateContext,
  GradedGateDecision,
  SchedulerConfig,
  SchedulerEvent,
} from "./types.js";
import { getProactiveFrequencyFactor } from "../persona/lifecycle.js";
import { computeCalibrationSlope, applyCalibrationCorrection } from "../feedback/calibration.js";

// ── PRISM cost defaults ──────────────────────────────────────────────

const DEFAULT_C_FN = 5.0;
const DEFAULT_C_FA = 1.0;
const BASE_NEED = 0.5;
const SIGMOID_K = 0.5;

const EVENT_FACTORS: Record<SchedulerEvent["type"], number> = {
  timer: 0.7,
  persona_change: 0.9,
  info_scan: 0.8,
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

  if (
    persona.feedbackProfile.suppressUntil &&
    persona.feedbackProfile.suppressUntil > now
  ) {
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
        reasons.push(
          `Outside active hours (${config.activeHoursStart}-${config.activeHoursEnd})`,
        );
      }
    } catch {
      // Invalid timezone, skip this gate
    }
  }

  if (persona.rapport.totalExchanges < 5) {
    reasons.push(
      `Only ${persona.rapport.totalExchanges} exchanges — need at least 5`,
    );
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    suggestedDelayMs,
  };
}

// ── PRISM cost-sensitive graded gate ─────────────────────────────────

export function computeGradedGate(context: GateContext): GradedGateDecision {
  const { persona, event, recentInsightCount, config } = context;
  const now = event.timestamp;
  const reasons: string[] = [];
  let suggestedDelayMs: number | undefined;

  // Hard vetoes (safety rails — bypass probabilistic calculation)

  if (config.activeHoursStart && config.activeHoursEnd && event.type === "timer") {
    const outside = isOutsideActiveHours(now, config);
    if (outside) {
      reasons.push(
        `Outside active hours (${config.activeHoursStart}-${config.activeHoursEnd})`,
      );
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
    reasons.push(
      `Only ${persona.rapport.totalExchanges} exchanges — need at least 5`,
    );
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
  const pAct = pNeed * pAccept;

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

function computePNeed(
  persona: PersonaTree,
  event: SchedulerEvent,
  config: SchedulerConfig,
  now: number,
): number {
  const timeSinceLastProactive = now - persona.feedbackProfile.lastProactiveAt;
  const elapsedHours = timeSinceLastProactive / (60 * 60 * 1000);

  const timeFactor = sigmoid(SIGMOID_K * (elapsedHours - config.minIntervalHours));
  const eventFactor = EVENT_FACTORS[event.type] ?? 0.3;
  const activeDomainsDepthGte3 = Object.values(persona.domains).filter(
    (d) => d.depth >= 3,
  ).length;
  const domainActivityFactor = Math.min(1, activeDomainsDepthGte3 / 3);

  return clamp01(BASE_NEED * timeFactor * eventFactor * domainActivityFactor);
}

// ── p_accept computation ─────────────────────────────────────────────

function computePAccept(persona: PersonaTree): number {
  const trustFactor = persona.rapport.trustScore;

  const banditEntries = Object.entries(persona.feedbackProfile.topicBandits);
  let banditFactor = 0.5;
  if (banditEntries.length > 0) {
    const meanPosterior = banditEntries.reduce(
      (sum, [, b]) => sum + b.alpha / (b.alpha + b.beta),
      0,
    ) / banditEntries.length;
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

// ── Helpers ──────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function isOutsideActiveHours(
  nowMs: number,
  config: SchedulerConfig,
): boolean {
  if (!config.activeHoursStart || !config.activeHoursEnd) return false;

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

    return currentMinutes < startMinutes || currentMinutes > endMinutes;
  } catch {
    return false;
  }
}
