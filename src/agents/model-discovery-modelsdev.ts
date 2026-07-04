import { mkdirSync } from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";

const log = createSubsystemLogger("model-discovery-modelsdev");

/** Upstream models.dev catalog URL. */
export const MODELS_DEV_URL = "https://models.dev/api.json";
/** Fetch timeout for the models.dev catalog (8s). */
export const MODELS_DEV_FETCH_TIMEOUT_MS = 8000;
/** Disk cache TTL (24h). Fresh caches are returned as-is; stale caches trigger background refresh. */
export const MODELS_DEV_DISK_TTL_MS = 24 * 60 * 60 * 1000;

/** A single model entry from models.dev. */
export interface ModelsDevModel {
  id: string;
  name?: string;
  family?: string;
  attachment?: boolean; // vision capability
  reasoning?: boolean;
  tool_call?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  release_date?: string;
}

/** A provider entry from models.dev. */
export interface ModelsDevProvider {
  id: string;
  name?: string;
  env?: string[];
  api?: string; // baseUrl (often undefined for major providers)
  doc?: string;
  models?: Record<string, ModelsDevModel>;
}

/** Top-level catalog keyed by provider slug. */
export type ModelsDevCatalog = Record<string, ModelsDevProvider>;

/** On-disk cache file shape. */
interface ModelsDevCacheFile {
  fetchedAt: number;
  source: "models.dev";
  data: ModelsDevCatalog;
}

/**
 * Normalized KaijiBot-facing model metadata, derived from a models.dev entry.
 */
export interface ModelsDevMetadata {
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: ("text" | "image" | "document")[];
}

/** Lookup indexes derived from a {@link ModelsDevCatalog}. */
export interface ModelsDevModelIndex {
  byProviderId: Map<string, ModelsDevProvider>;
  byBaseUrlHost: Map<string, ModelsDevProvider>;
  allModelsById: Map<string, { provider: ModelsDevProvider; model: ModelsDevModel }>;
  allModelsByLastSegment: Map<string, { provider: ModelsDevProvider; model: ModelsDevModel }>;
}

// ---------------------------------------------------------------------------
// In-memory + disk cache state
// ---------------------------------------------------------------------------

let refreshPromise: Promise<void> | null = null;

/**
 * Clears module-level in-memory cache state. Intended for use in tests only.
 */
export function resetModelsDevCacheForTest(): void {
  refreshPromise = null;
}

/**
 * Read the on-disk cache file. Returns null when the file is missing or
 * malformed. Never throws — callers can treat a null result as "no cache".
 */
export async function readModelsDevDiskCache(
  cachePath: string,
): Promise<{ catalog: ModelsDevCatalog; fetchedAt: number } | null> {
  const file = await readJsonFile<ModelsDevCacheFile>(cachePath);
  if (!file || typeof file !== "object") {
    return null;
  }
  const fetchedAt = file.fetchedAt;
  const data = file.data;
  if (typeof fetchedAt !== "number" || !data || typeof data !== "object") {
    return null;
  }
  return { catalog: data as ModelsDevCatalog, fetchedAt };
}

/**
 * Atomically write the catalog to disk along with the current `fetchedAt`
 * timestamp. Ensures the parent directory exists.
 */
export async function writeModelsDevDiskCache(
  cachePath: string,
  catalog: ModelsDevCatalog,
): Promise<void> {
  const fetchedAt = Date.now();
  const payload: ModelsDevCacheFile = {
    fetchedAt,
    source: "models.dev",
    data: catalog,
  };
  try {
    mkdirSync(path.dirname(cachePath), { recursive: true });
  } catch (err) {
    // writeJsonAtomic also mkdirs, but we try first to surface EACCES with a clear log.
    log.warn("writeModelsDevDiskCache: mkdir failed", {
      dir: path.dirname(cachePath),
      error: err instanceof Error ? err.message : String(err),
    });
  }
  await writeJsonAtomic(cachePath, payload, { trailingNewline: true });
}

// ---------------------------------------------------------------------------
// Network fetch
// ---------------------------------------------------------------------------

async function fetchModelsDevCatalog(fetchFn?: typeof fetch): Promise<ModelsDevCatalog> {
  const response = await fetchWithTimeout(
    MODELS_DEV_URL,
    { method: "GET", headers: { accept: "application/json" } },
    MODELS_DEV_FETCH_TIMEOUT_MS,
    fetchFn,
  );
  if (!response.ok) {
    throw new Error(`models.dev fetch failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as unknown;
  if (!json || typeof json !== "object") {
    throw new Error("models.dev fetch returned non-object payload");
  }
  return json as ModelsDevCatalog;
}

// ---------------------------------------------------------------------------
// Background refresh
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget background refresh of the disk cache. Dedupes concurrent
 * invocations via a module-level promise. Never throws — any error is swallowed
 * and the promise slot is cleared so a future call can retry.
 */
export function triggerModelsDevBackgroundRefresh(params: {
  cachePath: string;
  fetchFn?: typeof fetch;
}): void {
  if (refreshPromise !== null) {
    return;
  }
  const { cachePath, fetchFn } = params;
  refreshPromise = (async () => {
    try {
      const catalog = await fetchModelsDevCatalog(fetchFn);
      await writeModelsDevDiskCache(cachePath, catalog);
      log.debug("models.dev background refresh succeeded", { cachePath });
    } catch (err) {
      log.warn("models.dev background refresh failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      refreshPromise = null;
    }
  })();
}

// ---------------------------------------------------------------------------
// Disk-first catalog loader
// ---------------------------------------------------------------------------

/**
 * Load the models.dev catalog with a disk-first strategy:
 *
 * 1. Read disk cache. If fresh (<24h), return it.
 * 2. If stale (>24h), trigger a non-blocking background refresh and return the
 *    stale cache so callers never block on the network.
 * 3. If no cache exists, fetch synchronously (8s timeout), write disk, and
 *    return the parsed catalog. On fetch failure: return `{}` and do NOT write.
 *
 * Never throws — all errors are logged and an empty catalog is returned.
 */
export async function loadModelsDevCatalog(params: {
  cachePath: string;
  fetchFn?: typeof fetch;
}): Promise<ModelsDevCatalog> {
  const { cachePath, fetchFn } = params;
  const cached = await readModelsDevDiskCache(cachePath);
  const now = Date.now();
  if (cached) {
    const ageMs = now - cached.fetchedAt;
    if (ageMs < MODELS_DEV_DISK_TTL_MS) {
      return cached.catalog;
    }
    // Stale: serve the old data, refresh in background.
    triggerModelsDevBackgroundRefresh({ cachePath, fetchFn });
    return cached.catalog;
  }

  // No cache: synchronous fetch.
  try {
    const catalog = await fetchModelsDevCatalog(fetchFn);
    await writeModelsDevDiskCache(cachePath, catalog);
    return catalog;
  } catch (err) {
    log.warn("models.dev fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

/**
 * Build lookup indexes from a catalog. All keys are lowercase to enable
 * case-insensitive lookups. Hostname extraction uses the standard URL parser.
 */
export function buildModelsDevIndex(catalog: ModelsDevCatalog): ModelsDevModelIndex {
  const byProviderId = new Map<string, ModelsDevProvider>();
  const byBaseUrlHost = new Map<string, ModelsDevProvider>();
  const allModelsById = new Map<string, { provider: ModelsDevProvider; model: ModelsDevModel }>();
  const allModelsByLastSegment = new Map<
    string,
    { provider: ModelsDevProvider; model: ModelsDevModel }
  >();

  for (const provider of Object.values(catalog)) {
    if (!provider || typeof provider !== "object" || typeof provider.id !== "string") {
      continue;
    }
    const providerSlug = provider.id.toLowerCase();
    byProviderId.set(providerSlug, provider);

    if (typeof provider.api === "string" && provider.api.length > 0) {
      try {
        const host = new URL(provider.api).hostname;
        if (host) {
          byBaseUrlHost.set(host.toLowerCase(), provider);
        }
      } catch {
        // Malformed api URL — skip host indexing.
      }
    }

    const models = provider.models;
    if (models && typeof models === "object") {
      for (const model of Object.values(models)) {
        if (!model || typeof model !== "object" || typeof model.id !== "string") {
          continue;
        }
        const entry = { provider, model };
        const idLower = model.id.toLowerCase();
        allModelsById.set(idLower, entry);
        const slashIdx = model.id.lastIndexOf("/");
        const lastSegment = slashIdx >= 0 ? model.id.slice(slashIdx + 1) : model.id;
        if (lastSegment) {
          allModelsByLastSegment.set(lastSegment.toLowerCase(), entry);
        }
      }
    }
  }

  return { byProviderId, byBaseUrlHost, allModelsById, allModelsByLastSegment };
}

// ---------------------------------------------------------------------------
// Metadata mapping
// ---------------------------------------------------------------------------

/**
 * Map a models.dev model entry to KaijiBot-facing metadata.
 *
 * `input` always includes `"text"`. Image capability is inferred from
 * `modalities.input` containing `"image"` OR a truthy `attachment` flag.
 * Document capability is inferred from a `"pdf"` modality.
 */
export function modelsDevModelToMetadata(m: ModelsDevModel): ModelsDevMetadata {
  const meta: ModelsDevMetadata = {};
  if (typeof m.name === "string" && m.name.length > 0) {
    meta.name = m.name;
  }
  const ctx = m.limit?.context;
  if (typeof ctx === "number" && ctx > 0) {
    meta.contextWindow = ctx;
  }
  if (m.reasoning === true) {
    meta.reasoning = true;
  }

  const inputs: ("text" | "image" | "document")[] = ["text"];
  const modalityInputs = m.modalities?.input;
  const hasImageModality = Array.isArray(modalityInputs) && modalityInputs.includes("image");
  const hasPdfModality = Array.isArray(modalityInputs) && modalityInputs.includes("pdf");
  if (hasImageModality || m.attachment === true) {
    if (!inputs.includes("image")) {
      inputs.push("image");
    }
  }
  if (hasPdfModality) {
    if (!inputs.includes("document")) {
      inputs.push("document");
    }
  }
  meta.input = inputs;
  return meta;
}

/**
 * Resolve model metadata from the index using a layered fallback strategy:
 *
 * 1. Provider-scoped exact model key match.
 * 2. Provider-scoped case-insensitive model key match.
 * 3. Global full-id match (lowercased).
 * 4. Global last-segment match (lowercased).
 *
 * Returns null when nothing matches.
 */
export function lookupModelMetadata(
  index: ModelsDevModelIndex,
  params: { providerId: string; modelId: string },
): ModelsDevMetadata | null {
  const { providerId, modelId } = params;
  const providerSlug = providerId.toLowerCase();
  const provider = index.byProviderId.get(providerSlug);

  if (provider?.models) {
    // 1. Exact model key
    const exact = provider.models[modelId];
    if (exact) {
      return modelsDevModelToMetadata(exact);
    }
    // 2. Case-insensitive model key
    const modelIdLower = modelId.toLowerCase();
    for (const [key, model] of Object.entries(provider.models)) {
      if (key.toLowerCase() === modelIdLower) {
        return modelsDevModelToMetadata(model);
      }
    }
  }

  // 3. Global full-id (lowercased)
  const globalById = index.allModelsById.get(modelId.toLowerCase());
  if (globalById) {
    return modelsDevModelToMetadata(globalById.model);
  }

  // 4. Global last-segment (lowercased)
  const slashIdx = modelId.lastIndexOf("/");
  const lastSegment = slashIdx >= 0 ? modelId.slice(slashIdx + 1) : modelId;
  if (lastSegment) {
    const globalByLast = index.allModelsByLastSegment.get(lastSegment.toLowerCase());
    if (globalByLast) {
      return modelsDevModelToMetadata(globalByLast.model);
    }
  }

  return null;
}
