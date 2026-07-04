import { createSubsystemLogger } from "../logging/subsystem.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";

const log = createSubsystemLogger("agents/model-discovery");

export const PROVIDER_FETCH_TIMEOUT_MS = 5000;

/**
 * Provider APIs that do not expose a usable GET /models-style discovery
 * endpoint. The dispatcher short-circuits these to an empty result.
 */
export const SKIP_DISCOVERY_APIS: ReadonlySet<string> = new Set([
  "bedrock-converse-stream",
  "google-vertex",
  "azure-openai-responses",
  "openai-codex-responses",
]);

export type FamilyInput = "text" | "image" | "document";

export interface ProviderEndpoint {
  provider: string;
  baseUrl: string;
  api: string;
  apiKey: string;
}

export interface FamilyEntry {
  contextWindow?: number;
  reasoning?: boolean;
  input?: FamilyInput[];
}

export type FamilyCatalogEntry = {
  id: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: FamilyInput[];
};

/** Strips a trailing slash so `{base}/models` never produces `//models`. */
function trimTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

/** Fetches model ids from an OpenAI-compatible /models endpoint. Never throws. */
export async function fetchOpenAICompatibleModelIds(params: {
  baseUrl: string;
  apiKey: string;
  fetchFn?: typeof fetch;
}): Promise<string[]> {
  const url = `${trimTrailingSlash(params.baseUrl)}/models`;
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: "application/json", Authorization: `Bearer ${params.apiKey}` } },
      PROVIDER_FETCH_TIMEOUT_MS,
      params.fetchFn ?? fetch,
    );
    if (!res.ok) {
      log.warn("openai-compatible model discovery non-OK status", {
        status: res.status,
        url,
      });
      return [];
    }
    const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const data = Array.isArray(json?.data) ? json.data : [];
    const ids: string[] = [];
    for (const item of data) {
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      if (id) {
        ids.push(id);
      }
    }
    return ids;
  } catch (err) {
    log.warn("openai-compatible model discovery failed", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Fetches model ids from Google's Generative AI /models endpoint.
 * Filters to models that support `generateContent`. Never throws.
 */
export async function fetchGoogleModelIds(params: {
  baseUrl: string;
  apiKey: string;
  fetchFn?: typeof fetch;
}): Promise<string[]> {
  const url = `${trimTrailingSlash(params.baseUrl)}/models?key=${encodeURIComponent(params.apiKey)}`;
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: "application/json" } },
      PROVIDER_FETCH_TIMEOUT_MS,
      params.fetchFn ?? fetch,
    );
    if (!res.ok) {
      log.warn("google model discovery non-OK status", { status: res.status, url });
      return [];
    }
    const json = (await res.json()) as {
      models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown[] }>;
    };
    const models = Array.isArray(json?.models) ? json.models : [];
    const ids: string[] = [];
    for (const model of models) {
      const methods = Array.isArray(model?.supportedGenerationMethods)
        ? model.supportedGenerationMethods
        : [];
      if (!methods.includes("generateContent")) {
        continue;
      }
      const name = typeof model?.name === "string" ? model.name : "";
      const id = name.startsWith("models/") ? name.slice("models/".length).trim() : name.trim();
      if (id) {
        ids.push(id);
      }
    }
    return ids;
  } catch (err) {
    log.warn("google model discovery failed", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Fetches model ids from Anthropic's /v1/models endpoint. Never throws. */
export async function fetchAnthropicModelIds(params: {
  baseUrl: string;
  apiKey: string;
  fetchFn?: typeof fetch;
}): Promise<string[]> {
  const url = `${trimTrailingSlash(params.baseUrl)}/v1/models`;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          Accept: "application/json",
          "x-api-key": params.apiKey,
          "anthropic-version": "2023-06-01",
        },
      },
      PROVIDER_FETCH_TIMEOUT_MS,
      params.fetchFn ?? fetch,
    );
    if (!res.ok) {
      log.warn("anthropic model discovery non-OK status", { status: res.status, url });
      return [];
    }
    const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const data = Array.isArray(json?.data) ? json.data : [];
    const ids: string[] = [];
    for (const item of data) {
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      if (id) {
        ids.push(id);
      }
    }
    return ids;
  } catch (err) {
    log.warn("anthropic model discovery failed", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Dispatches to the right discovery fetcher based on the provider API kind.
 * APIs in {@link SKIP_DISCOVERY_APIS} or unknown kinds return an empty list.
 * Never throws.
 */
export async function fetchProviderModelIds(
  params: ProviderEndpoint & { fetchFn?: typeof fetch },
): Promise<string[]> {
  if (SKIP_DISCOVERY_APIS.has(params.api)) {
    return [];
  }
  try {
    switch (params.api) {
      case "openai-completions":
      case "openai-responses":
      case "mistral-conversations":
        return await fetchOpenAICompatibleModelIds(params);
      case "google-generative-ai":
        return await fetchGoogleModelIds(params);
      case "anthropic-messages":
        return await fetchAnthropicModelIds(params);
      default:
        return [];
    }
  } catch (err) {
    log.warn("provider model discovery failed", {
      provider: params.provider,
      api: params.api,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Extracts the major version family from a model id.
 *
 * Examples:
 *   "glm-5.2"         → "glm-5"
 *   "deepseek-v3.2"   → "deepseek-v3"
 *   "claude-sonnet-4-6" → "claude-sonnet-4"
 *   "deepseek-chat"   → "deepseek-chat" (no digit, returned lowercased as-is)
 */
export function extractMajorVersionFamily(modelId: string): string {
  const match = /^(.*?\d+)/i.exec(modelId);
  if (!match) {
    return modelId.toLowerCase();
  }
  const stripped = match[1].replace(/\.\d+$/, "");
  return stripped.toLowerCase();
}

/** Extracts the leading alphabetic brand prefix (e.g. "glm" from "glm-5.3"). */
function extractBrand(modelId: string): string {
  const match = /^[a-z]+/i.exec(modelId);
  return match ? match[0].toLowerCase() : "";
}

/** Projects a catalog entry into a {@link FamilyEntry}, omitting undefined fields. */
function pickFamilyEntry(entry: FamilyCatalogEntry): FamilyEntry {
  const result: FamilyEntry = {};
  if (entry.contextWindow !== undefined) {
    result.contextWindow = entry.contextWindow;
  }
  if (entry.reasoning !== undefined) {
    result.reasoning = entry.reasoning;
  }
  if (entry.input !== undefined) {
    result.input = entry.input;
  }
  return result;
}

/**
 * Finds the best same-family metadata entry for a model id from a catalog.
 *
 * Strategy:
 *   1. Match entries with the same provider and the same major version family.
 *   2. Fall back to same provider + same brand prefix.
 *   3. Return null if nothing matches.
 *
 * When multiple entries match, the one with the longest id (treated as the
 * "latest" variant) is projected into the result.
 */
export function findFamilyEntry(
  catalog: ReadonlyArray<FamilyCatalogEntry>,
  modelId: string,
  provider: string,
): FamilyEntry | null {
  const targetFamily = extractMajorVersionFamily(modelId);

  const sameFamily = catalog.filter(
    (entry) => entry.provider === provider && extractMajorVersionFamily(entry.id) === targetFamily,
  );
  if (sameFamily.length > 0) {
    const latest = sameFamily.reduce((a, b) => (b.id.length > a.id.length ? b : a));
    return pickFamilyEntry(latest);
  }

  const brand = extractBrand(modelId);
  if (brand) {
    const sameBrand = catalog.filter(
      (entry) => entry.provider === provider && extractBrand(entry.id) === brand,
    );
    if (sameBrand.length > 0) {
      const latest = sameBrand.reduce((a, b) => (b.id.length > a.id.length ? b : a));
      return pickFamilyEntry(latest);
    }
  }

  return null;
}
