import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getEnvApiKey } from "@earendil-works/pi-ai";
import { readJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveEnvApiKey } from "./model-auth-env.js";
import type { ModelCatalogEntry, ModelInputType } from "./model-catalog.js";
import {
  buildModelsDevIndex,
  lookupModelMetadata,
  MODELS_DEV_DISK_TTL_MS,
  readModelsDevDiskCache,
  triggerModelsDevBackgroundRefresh,
  type ModelsDevModelIndex,
} from "./model-discovery-modelsdev.js";
import {
  SKIP_DISCOVERY_APIS,
  fetchProviderModelIds,
  findFamilyEntry,
  type ProviderEndpoint,
} from "./model-discovery-providers.js";

const log = createSubsystemLogger("live-model-discovery");

export const LIVE_DISCOVERY_IN_MEMORY_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const PROVIDER_MODELS_DISK_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const DEFAULT_DISCOVERY_BUDGET_MS = 1500;
export const DEFAULT_CONTEXT_WINDOW = 128000;
export const DEFAULT_INPUT: ModelInputType[] = ["text"];

export interface ProviderRuntimeInfo {
  provider: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
}

export interface DiscoverLiveModelsParams {
  agentDir: string;
  env?: NodeJS.ProcessEnv;
  existingCatalog: ModelCatalogEntry[];
  providerRuntimeInfo: ReadonlyMap<string, ProviderRuntimeInfo>;
  fetchFn?: typeof fetch;
  budgetMs?: number;
}

export interface LiveDiscoveryResult {
  entries: ModelCatalogEntry[];
  discoveredCount: number;
}

export const EMPTY_LIVE_RESULT: LiveDiscoveryResult = { entries: [], discoveredCount: 0 };

// ---------------------------------------------------------------------------
// Module-level in-memory cache
// ---------------------------------------------------------------------------

let memoryCache: LiveDiscoveryResult | null = null;
let memoryCacheAt = 0;

/**
 * Clears module-level in-memory cache state. Intended for use in tests only.
 */
export function resetLiveDiscoveryCacheForTest(): void {
  memoryCache = null;
  memoryCacheAt = 0;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the on-disk cache path for the models.dev catalog inside an agent
 * directory.
 */
export function resolveModelsDevCachePath(agentDir: string): string {
  return join(agentDir, "cache", "models-dev.json");
}

export function resolveProviderModelsCachePath(agentDir: string): string {
  return join(agentDir, "cache", "provider-models.json");
}

interface ProviderCacheEntry {
  modelIds: string[];
  fetchedAt: number;
}

interface ProviderModelsCacheFile {
  providers: Record<string, ProviderCacheEntry>;
}

async function readProviderModelsDiskCache(
  cachePath: string,
): Promise<ProviderModelsCacheFile | null> {
  try {
    const data = await readJsonFile<ProviderModelsCacheFile>(cachePath);
    if (!data || typeof data !== "object" || typeof data.providers !== "object") {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

async function writeProviderModelsDiskCache(
  cachePath: string,
  data: ProviderModelsCacheFile,
): Promise<void> {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    await writeJsonAtomic(cachePath, data, { trailingNewline: true });
  } catch (err) {
    log.warn("Failed to write provider models cache", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Metadata inference
// ---------------------------------------------------------------------------

/**
 * Infers a catalog entry for a discovered model id using a layered resolution
 * cascade:
 *
 * 1. models.dev metadata (exact provider + model match).
 * 2. Same-family entry from the existing catalog (inherit context window,
 *    reasoning flag, and input modalities).
 * 3. Hardcoded defaults (128k context, text-only input, no reasoning).
 */
export function inferModelEntry(params: {
  provider: string;
  modelId: string;
  index: ModelsDevModelIndex;
  existingCatalog: ModelCatalogEntry[];
}): ModelCatalogEntry {
  const { provider, modelId, index, existingCatalog } = params;

  // 1. models.dev lookup
  const metadata = lookupModelMetadata(index, { providerId: provider, modelId });
  if (metadata) {
    return {
      id: modelId,
      name: metadata.name ?? modelId,
      provider,
      contextWindow: metadata.contextWindow,
      reasoning: metadata.reasoning,
      input: metadata.input ?? [...DEFAULT_INPUT],
    };
  }

  // 2. Family match from existing catalog
  const fam = findFamilyEntry(existingCatalog, modelId, provider);
  if (fam) {
    return {
      id: modelId,
      name: modelId,
      provider,
      contextWindow: fam.contextWindow,
      reasoning: fam.reasoning,
      input: fam.input ?? [...DEFAULT_INPUT],
    };
  }

  // 3. Defaults
  return {
    id: modelId,
    name: modelId,
    provider,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    input: [...DEFAULT_INPUT],
  };
}

// ---------------------------------------------------------------------------
// Budgeted provider fetching
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetches model ids from all endpoints in parallel, racing against a time
 * budget. Returns a map of endpoint-index → model-id-list containing whatever
 * resolved before the budget cutoff. Never throws — individual fetch failures
 * are silently dropped.
 */
async function fetchAllProviderModelsWithBudget(
  endpoints: ProviderEndpoint[],
  budgetMs: number,
  fetchFn?: typeof fetch,
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  const innerPromises: Promise<void>[] = [];
  for (let i = 0; i < endpoints.length; i++) {
    const idx = i;
    const ep = endpoints[idx];
    const p = fetchProviderModelIds({ ...ep, fetchFn })
      .then((ids: string[]) => {
        out.set(idx, ids);
      })
      .catch(() => {});
    innerPromises.push(p);
  }
  await Promise.race([Promise.allSettled(innerPromises), sleep(budgetMs)]);
  return out;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Orchestrates live model discovery by combining the models.dev metadata cache
 * with provider API model-list fetchers.
 *
 * Strategy:
 *   - Gate on test environment or explicit disable flag.
 *   - Serve from in-memory cache when fresh (< 5 min).
 *   - Read models.dev disk cache; trigger background refresh on miss/staleness.
 *   - Build provider endpoints from runtime info + resolved API keys.
 *   - Fetch model ids from all endpoints in parallel within a time budget.
 *   - Dedup against the existing catalog and infer metadata for new entries.
 *
 * Never throws — all errors are logged and an empty result is returned.
 */
export async function discoverLiveModels(
  params: DiscoverLiveModelsParams,
): Promise<LiveDiscoveryResult> {
  try {
    // Gate 1: test environment
    if (params.env?.VITEST || params.env?.NODE_ENV === "test") {
      return EMPTY_LIVE_RESULT;
    }
    // Gate 2: explicit disable
    if (params.env?.KAIJIBOT_DISABLE_LIVE_MODEL_DISCOVERY === "1") {
      return EMPTY_LIVE_RESULT;
    }
    // In-memory cache
    if (memoryCache && Date.now() - memoryCacheAt < LIVE_DISCOVERY_IN_MEMORY_TTL_MS) {
      return memoryCache;
    }

    const cachePath = resolveModelsDevCachePath(params.agentDir);
    const disk = await readModelsDevDiskCache(cachePath);

    if (disk === null) {
      // No cache: trigger non-blocking background refresh, return empty.
      triggerModelsDevBackgroundRefresh({ cachePath, fetchFn: params.fetchFn });
      return EMPTY_LIVE_RESULT;
    }

    if (Date.now() - disk.fetchedAt > MODELS_DEV_DISK_TTL_MS) {
      // Stale: serve old data, refresh in background.
      triggerModelsDevBackgroundRefresh({ cachePath, fetchFn: params.fetchFn });
    }

    const index = buildModelsDevIndex(disk.catalog);

    // Build provider endpoints
    const endpoints: ProviderEndpoint[] = [];
    for (const [provider, info] of params.providerRuntimeInfo) {
      if (!info.api || !info.baseUrl) {
        continue;
      }
      if (SKIP_DISCOVERY_APIS.has(info.api)) {
        continue;
      }
      const auth = resolveEnvApiKey(provider, params.env ?? process.env);
      const apiKey = info.apiKey ?? auth?.apiKey ?? getEnvApiKey(provider);
      if (!apiKey) {
        continue;
      }
      endpoints.push({
        provider,
        baseUrl: info.baseUrl,
        api: info.api,
        apiKey,
      });
    }

    if (endpoints.length === 0) {
      memoryCache = EMPTY_LIVE_RESULT;
      memoryCacheAt = Date.now();
      return EMPTY_LIVE_RESULT;
    }

    const providerCachePath = resolveProviderModelsCachePath(params.agentDir);
    const providerCache = await readProviderModelsDiskCache(providerCachePath);
    const now = Date.now();

    const staleEndpoints: ProviderEndpoint[] = [];
    const allModelIds = new Map<string, string[]>();

    for (const ep of endpoints) {
      const cached = providerCache?.providers?.[ep.provider];
      if (cached && now - cached.fetchedAt < PROVIDER_MODELS_DISK_TTL_MS) {
        allModelIds.set(ep.provider, [...cached.modelIds]);
      } else {
        staleEndpoints.push(ep);
        if (cached) {
          allModelIds.set(ep.provider, [...cached.modelIds]);
        }
      }
    }

    if (staleEndpoints.length > 0) {
      const budget = params.budgetMs ?? DEFAULT_DISCOVERY_BUDGET_MS;
      const fetched = await fetchAllProviderModelsWithBudget(
        staleEndpoints,
        budget,
        params.fetchFn,
      );

      const cacheUpdates: Record<string, ProviderCacheEntry> = {};
      for (const [staleIdx, modelIds] of fetched) {
        const ep = staleEndpoints[staleIdx];
        if (!ep) {
          continue;
        }
        if (modelIds.length > 0) {
          allModelIds.set(ep.provider, modelIds);
          cacheUpdates[ep.provider] = { modelIds, fetchedAt: now };
        }
      }

      if (Object.keys(cacheUpdates).length > 0) {
        const merged: ProviderModelsCacheFile = {
          providers: { ...providerCache?.providers, ...cacheUpdates },
        };
        await writeProviderModelsDiskCache(providerCachePath, merged).catch(() => {});
      }
    }

    const existingKeys = new Set<string>();
    for (const entry of params.existingCatalog) {
      existingKeys.add(`${entry.provider}::${entry.id}`.toLowerCase());
    }

    const newEntries: ModelCatalogEntry[] = [];
    for (const [provider, modelIds] of allModelIds) {
      for (const modelId of modelIds) {
        const key = `${provider}::${modelId}`.toLowerCase();
        if (existingKeys.has(key)) {
          continue;
        }
        const entry = inferModelEntry({
          provider,
          modelId,
          index,
          existingCatalog: params.existingCatalog,
        });
        newEntries.push(entry);
        existingKeys.add(key);
      }
    }

    const result: LiveDiscoveryResult = {
      entries: newEntries,
      discoveredCount: newEntries.length,
    };
    memoryCache = result;
    memoryCacheAt = Date.now();
    return result;
  } catch (err) {
    log.warn("discoverLiveModels failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return EMPTY_LIVE_RESULT;
  }
}
