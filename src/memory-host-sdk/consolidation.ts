import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { KaijiBotConfig } from "../config/types.kaijibot.js";
import { asNullableRecord } from "../shared/record-coerce.js";
import {
  lowercasePreservingWhitespace,
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalLowercaseString,
  normalizeStringifiedOptionalString,
} from "../shared/string-coerce.js";

export const DEFAULT_MEMORY_CONSOLIDATION_ENABLED = true;
export const DEFAULT_MEMORY_CONSOLIDATION_CRON = "0 3 * * *";
export const DEFAULT_MEMORY_CONSOLIDATION_CONCURRENCY = 2;
export const DEFAULT_MEMORY_CONSOLIDATION_BATCH_SIZE = 16000;
export const DEFAULT_MEMORY_CONSOLIDATION_LOOKBACK_DAYS = 7;
export const DEFAULT_MEMORY_CONSOLIDATION_VERBOSE_LOGGING = false;

export const DEFAULT_MEMORY_CONSOLIDATION_WIKI_ENABLED = false;
export const DEFAULT_MEMORY_CONSOLIDATION_WIKI_MIN_CONFIDENCE = 0.7;
export const DEFAULT_MEMORY_CONSOLIDATION_WIKI_MAX_PAGES = 20;

// Backward-compat re-export for existing config reads that reference dreaming storage mode.
export const DEFAULT_MEMORY_CONSOLIDATION_STORAGE_MODE = "separate" as const;

export type ConsolidationWikiConfig = {
  enabled: boolean;
  minConfidence: number;
  maxPagesPerRun: number;
};

export type ConsolidationConfig = {
  enabled: boolean;
  cron: string;
  timezone?: string;
  verboseLogging: boolean;
  concurrency: number;
  batchSize: number;
  lookbackDays: number;
  wiki: ConsolidationWikiConfig;
};

export type ConsolidationWorkspace = {
  workspaceDir: string;
  agentIds: string[];
};

function normalizeTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const normalized = normalizeStringifiedOptionalString(value);
  if (typeof value === "string" && !normalized) {
    return fallback;
  }
  const num = typeof value === "string" ? Number(normalized) : Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  const floored = Math.floor(num);
  if (floored < 0) {
    return fallback;
  }
  return floored;
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  const normalized = normalizeStringifiedOptionalString(value);
  if (typeof value === "string" && !normalized) {
    return fallback;
  }
  const num = typeof value === "string" ? Number(normalized) : Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  if (num < 0) {
    return fallback;
  }
  return num;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = normalizeLowercaseStringOrEmpty(value);
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

function normalizePathForComparison(input: string): string {
  const normalized = path.resolve(input);
  return process.platform === "win32" ? lowercasePreservingWhitespace(normalized) : normalized;
}

export function resolveConsolidationConfig(params: {
  pluginConfig?: Record<string, unknown>;
  cfg?: KaijiBotConfig;
}): ConsolidationConfig {
  const consolidation = asNullableRecord(params.pluginConfig?.consolidation);
  const cron = normalizeTrimmedString(consolidation?.cron) ?? DEFAULT_MEMORY_CONSOLIDATION_CRON;
  const timezone =
    normalizeTrimmedString(consolidation?.timezone) ??
    normalizeTrimmedString(
      params.cfg?.agents?.defaults?.userTimezone as unknown as string | undefined,
    ) ??
    undefined;

  const wiki = asNullableRecord(consolidation?.wiki);

  return {
    enabled: normalizeBoolean(consolidation?.enabled, DEFAULT_MEMORY_CONSOLIDATION_ENABLED),
    cron,
    ...(timezone ? { timezone } : {}),
    verboseLogging: normalizeBoolean(
      consolidation?.verboseLogging,
      DEFAULT_MEMORY_CONSOLIDATION_VERBOSE_LOGGING,
    ),
    concurrency: normalizeNonNegativeInt(
      consolidation?.concurrency,
      DEFAULT_MEMORY_CONSOLIDATION_CONCURRENCY,
    ),
    batchSize: normalizeNonNegativeInt(
      consolidation?.batchSize,
      DEFAULT_MEMORY_CONSOLIDATION_BATCH_SIZE,
    ),
    lookbackDays: normalizeNonNegativeInt(
      consolidation?.lookbackDays,
      DEFAULT_MEMORY_CONSOLIDATION_LOOKBACK_DAYS,
    ),
    wiki: {
      enabled: normalizeBoolean(wiki?.enabled, DEFAULT_MEMORY_CONSOLIDATION_WIKI_ENABLED),
      minConfidence: normalizeNonNegativeNumber(
        wiki?.minConfidence,
        DEFAULT_MEMORY_CONSOLIDATION_WIKI_MIN_CONFIDENCE,
      ),
      maxPagesPerRun: normalizeNonNegativeInt(
        wiki?.maxPagesPerRun,
        DEFAULT_MEMORY_CONSOLIDATION_WIKI_MAX_PAGES,
      ),
    },
  };
}

export function resolveConsolidationWorkspaces(cfg: KaijiBotConfig): ConsolidationWorkspace[] {
  const configured = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const agentIds: string[] = [];
  const seenAgents = new Set<string>();
  for (const entry of configured) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
      continue;
    }
    const id = normalizeOptionalLowercaseString(entry.id);
    if (!id || seenAgents.has(id)) {
      continue;
    }
    seenAgents.add(id);
    agentIds.push(id);
  }
  if (agentIds.length === 0) {
    agentIds.push(resolveDefaultAgentId(cfg));
  }

  const byWorkspace = new Map<string, ConsolidationWorkspace>();
  for (const agentId of agentIds) {
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId)?.trim();
    if (!workspaceDir) {
      continue;
    }
    const key = normalizePathForComparison(workspaceDir);
    const existing = byWorkspace.get(key);
    if (existing) {
      existing.agentIds.push(agentId);
      continue;
    }
    byWorkspace.set(key, { workspaceDir, agentIds: [agentId] });
  }
  return [...byWorkspace.values()];
}
