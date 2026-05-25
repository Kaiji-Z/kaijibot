/**
 * Memory Consolidation Engine — main orchestrator.
 *
 * Single pipeline: SCAN → EXTRACT → RESOLVE → ROUTE
 * Multi-agent: fans out per-agent with bounded concurrency.
 * Cron registration is a thin wrapper for Phase 6 integration.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_MEMORY_CONSOLIDATION_BATCH_SIZE,
  DEFAULT_MEMORY_CONSOLIDATION_CONCURRENCY,
  DEFAULT_MEMORY_CONSOLIDATION_CRON,
  DEFAULT_MEMORY_CONSOLIDATION_ENABLED,
  DEFAULT_MEMORY_CONSOLIDATION_LOOKBACK_DAYS,
  DEFAULT_MEMORY_CONSOLIDATION_VERBOSE_LOGGING,
} from "kaijibot/plugin-sdk/memory-core-host-status";
import type { ConsolidationConfig, ConsolidationWorkspace } from "kaijibot/plugin-sdk/memory-core-host-status";
import type { KaijiBotConfig } from "kaijibot/plugin-sdk/memory-core";
import { extractFromBatch, mergeAndDedupBatches, resolveConflicts } from "./consolidation-extract.js";
import { routeToStores, type ConsolidationRouteDeps } from "./consolidation-route.js";
import type {
  ConsolidationCheckpoint,
  ConsolidationResult,
  ExtractedItem,
  RouteItem,
  TranscriptBatch,
} from "./consolidation-types.js";

export type { ConsolidationRouteDeps } from "./consolidation-route.js";
export type { ExtractedItem, RouteItem, TranscriptBatch } from "./consolidation-types.js";

const CHECKPOINT_RELATIVE_PATH = path.join("memory", ".consolidation", "checkpoint.json");

/**
 * Dependencies injected from the plugin registration layer.
 * Extensions must NOT import LLM utilities, store implementations, or
 * filesystem helpers from core directly.
 */
export type ConsolidationDeps = {
  listSessionFiles: (agentId: string, lookbackDays: number) => Promise<string[]>;
  readSessionFile: (filePath: string) => Promise<string>;
  generateText: (prompt: string) => Promise<string>;
  resolveWorkspaces: (cfg: KaijiBotConfig) => ConsolidationWorkspace[];
  routeDeps: ConsolidationRouteDeps;
};

// ---------------------------------------------------------------------------
// Concurrency pool (simple inline implementation — runTasksWithConcurrency is
// not exposed via plugin-sdk, so we provide our own minimal version).
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<{ results: T[]; errors: string[] }> {
  if (tasks.length === 0) {
    return { results: [], errors: [] };
  }

  const resolvedLimit = Math.max(1, Math.min(limit, tasks.length));
  const results: T[] = Array.from({ length: tasks.length });
  const errors: string[] = [];
  let next = 0;

  const workers = Array.from({ length: resolvedLimit }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= tasks.length) {
        return;
      }
      try {
        results[index] = await tasks[index]!();
      } catch (err) {
        errors.push(String(err));
      }
    }
  });

  await Promise.allSettled(workers);
  return { results, errors };
}

// ---------------------------------------------------------------------------
// Checkpoint helpers
// ---------------------------------------------------------------------------

async function readCheckpoint(
  workspaceDir: string,
  agentId: string,
): Promise<ConsolidationCheckpoint> {
  const checkpointPath = path.join(workspaceDir, CHECKPOINT_RELATIVE_PATH);
  try {
    const raw = await fs.readFile(checkpointPath, "utf-8");
    const parsed = JSON.parse(raw) as ConsolidationCheckpoint;
    if (parsed.version === 1 && parsed.agentId === agentId) {
      return parsed;
    }
  } catch {
    // File doesn't exist or is invalid — return fresh checkpoint
  }
  return {
    version: 1,
    agentId,
    lastRunAt: new Date(0).toISOString(),
    processedSessionFiles: [],
    extractedCount: 0,
    routedCount: 0,
  };
}

async function writeCheckpoint(
  workspaceDir: string,
  checkpoint: ConsolidationCheckpoint,
): Promise<void> {
  const checkpointPath = path.join(workspaceDir, CHECKPOINT_RELATIVE_PATH);
  const dir = path.dirname(checkpointPath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${checkpointPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf-8");
  await fs.rename(tmpPath, checkpointPath);
}

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

function splitIntoBatches(
  files: Array<{ path: string; content: string }>,
  batchSize: number,
): Array<Array<{ path: string; content: string }>> {
  if (files.length === 0) {
    return [];
  }

  const batches: Array<Array<{ path: string; content: string }>> = [];
  let currentBatch: Array<{ path: string; content: string }> = [];
  let currentSize = 0;

  for (const file of files) {
    const estimatedSize = file.content.length;
    if (currentSize + estimatedSize > batchSize && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(file);
    currentSize += estimatedSize;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

// ---------------------------------------------------------------------------
// Cron registration (thin wrapper for Phase 6 integration)
// ---------------------------------------------------------------------------

export type CronRegistration = {
  cron: string;
  timezone?: string;
  onTick: () => Promise<void>;
};

const activeCrons: CronRegistration[] = [];

/**
 * Register a consolidation cron job. In Phase 6 this will be wired to the
 * actual cron system. For now it just stores the registration.
 */
export function registerConsolidationCron(params: {
  cron: string;
  timezone?: string;
  onTick: () => Promise<void>;
}): void {
  activeCrons.push(params);
}

// ---------------------------------------------------------------------------
// Single-agent pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full consolidation pipeline for a single agent:
 * SCAN → EXTRACT → RESOLVE → ROUTE → checkpoint update.
 */
export async function runConsolidationForAgent(params: {
  agentId: string;
  workspaceDir: string;
  config: ConsolidationConfig;
  deps: ConsolidationDeps;
}): Promise<ConsolidationResult> {
  const { agentId, workspaceDir, config, deps } = params;
  const startTime = Date.now();
  const errors: string[] = [];

  // SCAN: list session files
  let allFiles: string[];
  try {
    allFiles = await deps.listSessionFiles(agentId, config.lookbackDays);
  } catch (err) {
    return {
      agentId,
      scannedFiles: 0,
      extractedItems: 0,
      conflicts: 0,
      routedItems: 0,
      errors: [`SCAN failed: ${String(err)}`],
      durationMs: Date.now() - startTime,
    };
  }

  // Load checkpoint and filter to unprocessed files
  const checkpoint = await readCheckpoint(workspaceDir, agentId);
  const processedSet = new Set(checkpoint.processedSessionFiles);
  const newFiles = allFiles.filter((filePath) => !processedSet.has(filePath));

  if (newFiles.length === 0) {
    return {
      agentId,
      scannedFiles: allFiles.length,
      extractedItems: 0,
      conflicts: 0,
      routedItems: 0,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  // Read file contents
  const fileContents: Array<{ path: string; content: string }> = [];
  for (const filePath of newFiles) {
    try {
      const content = await deps.readSessionFile(filePath);
      fileContents.push({ path: filePath, content });
    } catch (err) {
      errors.push(`Failed to read ${filePath}: ${String(err)}`);
    }
  }

  // EXTRACT: split into batches and extract
  const batches = splitIntoBatches(fileContents, config.batchSize);
  const batchResults: ExtractedItem[][] = [];

  for (const batch of batches) {
    try {
      const transcriptBatch: TranscriptBatch = {
        agentId,
        userId: agentId,
        files: batch,
      };
      const items = await extractFromBatch(transcriptBatch, deps.generateText);
      batchResults.push(items);
    } catch (err) {
      errors.push(`EXTRACT failed for batch: ${String(err)}`);
    }
  }

  // Merge and dedup
  const merged = mergeAndDedupBatches(batchResults);

  // RESOLVE: detect and resolve conflicts
  const { resolved, conflicts } = resolveConflicts(merged);

  // ROUTE: send to stores
  const routeItems: RouteItem[] = resolved.map((item) => ({
    agentId,
    userId: agentId,
    item,
  }));

  const routeResult = await routeToStores({
    items: routeItems,
    workspaceDir,
    deps: deps.routeDeps,
  });
  errors.push(...routeResult.errors);

  // Update checkpoint
  const updatedProcessed = [...checkpoint.processedSessionFiles, ...newFiles];
  try {
    await writeCheckpoint(workspaceDir, {
      version: 1,
      agentId,
      lastRunAt: new Date().toISOString(),
      processedSessionFiles: updatedProcessed,
      extractedCount: checkpoint.extractedCount + merged.length,
      routedCount: checkpoint.routedCount + routeResult.routed,
    });
  } catch (err) {
    errors.push(`Failed to write checkpoint: ${String(err)}`);
  }

  return {
    agentId,
    scannedFiles: allFiles.length,
    extractedItems: merged.length,
    conflicts: conflicts.length,
    routedItems: routeResult.routed,
    errors,
    durationMs: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Multi-agent fan-out
// ---------------------------------------------------------------------------

/**
 * Run consolidation for all agents with bounded concurrency.
 */
export async function runConsolidationAllAgents(params: {
  config: ConsolidationConfig;
  cfg: KaijiBotConfig;
  deps: ConsolidationDeps;
}): Promise<ConsolidationResult[]> {
  const workspaces = params.deps.resolveWorkspaces(params.cfg);
  if (workspaces.length === 0) {
    return [];
  }

  const tasks = workspaces.map(
    (workspace: ConsolidationWorkspace) => async (): Promise<ConsolidationResult[]> => {
      // Each workspace may contain multiple agents sharing the same dir
      const agentTasks = workspace.agentIds.map(
        (agentId: string) => async (): Promise<ConsolidationResult> =>
          runConsolidationForAgent({
            agentId,
            workspaceDir: workspace.workspaceDir,
            config: params.config,
            deps: params.deps,
          }),
      );
      const { results } = await runWithConcurrency(agentTasks, params.config.concurrency);
      return results;
    },
  );

  const { results, errors } = await runWithConcurrency(tasks, params.config.concurrency);

  // Flatten and attach any top-level errors
  const flat = results.flat();
  if (errors.length > 0) {
    if (flat.length > 0) {
      flat[0]!.errors.push(...errors);
    }
  }

  return flat;
}
