import { join } from "node:path";
import { readJsonFile } from "../infra/json-files.js";
import {
  buildModelsDevIndex,
  lookupModelMetadata,
  type ModelsDevCatalog,
  type ModelsDevMetadata,
} from "./model-discovery-modelsdev.js";

interface ProviderCacheEntry {
  modelIds: string[];
  fetchedAt: number;
}

interface ProviderModelsCacheFile {
  providers: Record<string, ProviderCacheEntry>;
}

export type ModelOverrideEntry = {
  contextWindow?: number;
  reasoning?: boolean;
  input?: ("text" | "image" | "document")[];
  maxTokens?: number;
};

export type DiscoveryOverrides = Record<string, Record<string, ModelOverrideEntry>>;

function metadataToOverride(metadata: ModelsDevMetadata): ModelOverrideEntry | null {
  if (metadata.contextWindow === undefined && metadata.reasoning === undefined) {
    return null;
  }
  const entry: ModelOverrideEntry = {};
  if (metadata.contextWindow !== undefined) {
    entry.contextWindow = metadata.contextWindow;
  }
  if (metadata.reasoning !== undefined) {
    entry.reasoning = metadata.reasoning;
  }
  if (metadata.input) {
    entry.input = metadata.input;
  }
  return entry;
}

export async function resolveDiscoveryOverrides(agentDir: string): Promise<DiscoveryOverrides> {
  const modelsDevPath = join(agentDir, "cache", "models-dev.json");
  const providerCachePath = join(agentDir, "cache", "provider-models.json");

  const modelsDevCache = await readJsonFile<{
    fetchedAt: number;
    source: string;
    data: ModelsDevCatalog;
  }>(modelsDevPath).catch(() => null);

  if (!modelsDevCache?.data) {
    return {};
  }

  const providerCache = await readJsonFile<ProviderModelsCacheFile>(providerCachePath).catch(
    () => null,
  );

  if (!providerCache?.providers) {
    return {};
  }

  const index = buildModelsDevIndex(modelsDevCache.data);
  const overrides: DiscoveryOverrides = {};

  for (const [provider, info] of Object.entries(providerCache.providers)) {
    for (const modelId of info.modelIds) {
      const metadata = lookupModelMetadata(index, { providerId: provider, modelId });
      if (!metadata) {
        continue;
      }
      const entry = metadataToOverride(metadata);
      if (!entry) {
        continue;
      }
      if (!overrides[provider]) {
        overrides[provider] = {};
      }
      overrides[provider][modelId] = entry;
    }
  }

  return overrides;
}
