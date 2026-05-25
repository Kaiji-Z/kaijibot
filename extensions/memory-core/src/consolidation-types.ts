/**
 * Shared types for the Memory Consolidation Engine.
 *
 * Used by consolidation-extract, consolidation-route, and the main orchestrator.
 * This file must NOT import from `src/**` or any runtime modules.
 */

/** Categories extracted from session transcripts. Excludes tool_config and contextual_fact. */
export type ExtractCategory =
  | "domain_knowledge"
  | "behavioral_pattern"
  | "stated_preference"
  | "goal_or_aspiration";

/** A single knowledge item extracted from a transcript batch. */
export type ExtractedItem = {
  category: ExtractCategory;
  content: string;
  confidence: number;
  source: "transcript";
  evidence: string;
};

/** Record of a conflict that was resolved during dedup. */
export type ConflictResolution = {
  kept: ExtractedItem;
  discarded: string;
  reason: string;
};

/** Persistent checkpoint for resumability across runs. */
export type ConsolidationCheckpoint = {
  version: 1;
  agentId: string;
  lastRunAt: string;
  processedSessionFiles: string[];
  extractedCount: number;
  routedCount: number;
};

/** Summary of a completed consolidation run for a single agent. */
export type ConsolidationResult = {
  agentId: string;
  scannedFiles: number;
  extractedItems: number;
  conflicts: number;
  routedItems: number;
  errors: string[];
  durationMs: number;
};

/** Input to the LLM extraction step — a batch of transcript files. */
export type TranscriptBatch = {
  agentId: string;
  userId: string;
  files: Array<{ path: string; content: string }>;
};

/** Input to the store routing step — one extracted item with context. */
export type RouteItem = {
  agentId: string;
  userId: string;
  item: ExtractedItem;
};
