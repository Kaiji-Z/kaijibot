import type { PersonaTree } from "../types.js";

/** Event that triggers the proactive scheduler */
export type SchedulerEvent = {
  type: "timer" | "persona_change" | "info_scan" | "evolution_scan" | "activity_scan" | "external";
  timestamp: number;
  payload?: unknown;
};

/** Gate decision (legacy binary interface) */
export type GateDecision = {
  allowed: boolean;
  reasons: string[];
  suggestedDelayMs?: number;
};

/** PRISM-inspired graded gate decision with cost-sensitive probabilities */
export interface GradedGateDecision {
  /** Probability the user needs proactive help right now */
  pNeed: number;
  /** Probability the user will accept / respond positively */
  pAccept: number;
  /** Combined action probability: pNeed * pAccept */
  pAct: number;
  /** Final decision: true if pAct > cost-adjusted threshold and no hard vetoes */
  decision: boolean;
  /** Human-readable reasons for veto or acceptance */
  reasons: string[];
  /** Suggested delay before next gate check (ms) */
  suggestedDelayMs?: number;
}

/** Context bundle passed to the graded gate computation */
export interface GateContext {
  persona: PersonaTree;
  event: SchedulerEvent;
  /** Number of recent insight candidates generated (for domain activity) */
  recentInsightCount: number;
  config: SchedulerConfig;
}

/** PROBE-style opportunity discovered during the search phase */
export interface Opportunity {
  type: "cross_domain" | "domain_depth" | "info_scan_hit" | "exploration";
  targetDomains: string[];
  sourceDomains: string[];
  pNeed: number;
  pAccept: number;
  pAct: number;
  metadata?: Record<string, unknown>;
}

/** Scheduler configuration */
export type SchedulerConfig = {
  minIntervalHours: number;
  minTrustScore: number;
  activeHoursStart?: string; // "09:00"
  activeHoursEnd?: string; // "22:00"
  timezone?: string;
  /** Cost of false negative (missed opportunity). Default 3.0 */
  costFalseNegative?: number;
  /** Cost of false alarm (unnecessary interruption). Default 1.0 */
  costFalseAlarm?: number;
  /** Ratio of pattern-mode opportunities vs knowledge-mode (0-1, default 0.5) */
  patternModeRatio?: number;
  /** Use LLM-as-Judge to verify pattern-mode insights (default: true) */
  patternVerification?: boolean;
  /** Use LLM to check semantic novelty after trigram dedup passes (default: true) */
  llmFreshnessCheck?: boolean;
};
