export type CorrectionProvenance = "self" | "user" | "consolidation";

export type CorrectionRecord = {
  id: string;
  domain: string;
  trigger: string;
  mistake: string;
  correction: string;
  provenance: CorrectionProvenance;
  reinforcedCount: number;
  createdAt: number;
  lastReinforced: number;
  /** When to retrieve this correction (natural language); undefined = always relevant. */
  triggerWhen?: string;
  /** Times injected into agent turns (distinct from reinforcedCount = times mistake re-observed). */
  usageCount?: number;
  /** Last time the agent's reply addressed this mistake; undefined = never referenced. */
  lastReferencedAt?: number;
};

export type CorrectionStoreData = {
  corrections: CorrectionRecord[];
  version: number;
};

export const DEFAULT_CORRECTION_TTL_DAYS = 90;
export const MAX_CORRECTIONS_PER_USER = 50;
export const CORRECTION_STORE_VERSION = 1;
export const JACCARD_SIMILARITY_THRESHOLD = 0.6;
