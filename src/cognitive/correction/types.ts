export type CorrectionProvenance = "self" | "user";

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
};

export type CorrectionStoreData = {
  corrections: CorrectionRecord[];
  version: number;
};

export const DEFAULT_CORRECTION_TTL_DAYS = 90;
export const MAX_CORRECTIONS_PER_USER = 50;
export const CORRECTION_STORE_VERSION = 1;
export const JACCARD_SIMILARITY_THRESHOLD = 0.6;
