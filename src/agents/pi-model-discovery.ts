import fs from "node:fs";
import path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { normalizeModelCompat } from "../plugins/provider-model-compat.js";
import {
  applyProviderResolvedModelCompatWithPlugins,
  applyProviderResolvedTransportWithPlugin,
  normalizeProviderResolvedModelWithPlugin,
  resolveProviderSyntheticAuthWithPlugin,
} from "../plugins/provider-runtime.js";
import { resolveRuntimeSyntheticAuthProviderRefs } from "../plugins/synthetic-auth.runtime.js";
import type { ProviderRuntimeModel } from "../plugins/types.js";
import { isRecord } from "../utils.js";
import { ensureAuthProfileStore } from "./auth-profiles.js";
import { resolveProviderEnvApiKeyCandidates } from "./model-auth-env-vars.js";
import { resolveEnvApiKey } from "./model-auth-env.js";
import { resolvePiCredentialMapFromStore, type PiCredentialMap } from "./pi-auth-credentials.js";

const PiModelRegistryClass = PiCodingAgent.ModelRegistry;

export { PiModelRegistryClass as ModelRegistry };

/**
 * pi-coding-agent 1.x no longer exports its AuthStorage class (it is an internal
 * CredentialStore detail now). Our runtime only ever used three methods on it, so
 * we carry our own structural type backed by an in-memory runtime-key store.
 */
export type PiAuthStorage = {
  getApiKey(provider: string): Promise<string | undefined>;
  setRuntimeApiKey(provider: string, apiKey: string): void;
  hasAuth(provider?: string): boolean;
};

export type PiModelRegistry = PiModelRegistryLike;

/**
 * Structural registry surface used by synchronous model resolution. Both the
 * pi ModelRegistry instance and our sync models.json fallback satisfy it.
 */
export type PiModelRegistryLike = {
  getAll(): Model<Api>[];
  getAvailable(): Model<Api>[];
  find(provider: string, modelId: string): Model<Api> | undefined;
};

/**
 * Minimal synchronous registry over the agent's own models.json, for callers
 * that cannot await the async pi registry (ModelRuntime.create is async).
 * Covers the providers/models we write ourselves; catalog-side extras that
 * only pi's async registry provides are out of scope here.
 */
export function createSyncModelRegistryFallback(
  modelsJsonPath: string,
  agentDir: string,
): PiModelRegistryLike {
  const models: Model<Api>[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(modelsJsonPath, "utf8")) as unknown;
    if (isRecord(parsed) && isRecord(parsed.providers)) {
      for (const entry of Object.values(parsed.providers)) {
        if (!isRecord(entry) || !Array.isArray(entry.models)) {
          continue;
        }
        for (const model of entry.models) {
          models.push(normalizeDiscoveredPiModel(model as Model<Api>, agentDir));
        }
      }
    }
  } catch {
    // Missing or unreadable models.json resolves to an empty registry.
  }
  return {
    getAll: () => [...models],
    getAvailable: () => [...models],
    find: (provider, modelId) =>
      models.find((model) => model.provider === provider && model.id === modelId),
  };
}

function createInMemoryPiAuthStorage(creds: PiCredentialMap): PiAuthStorage {
  const runtimeKeys = new Map<string, string>();
  for (const [provider, credential] of Object.entries(creds)) {
    runtimeKeys.set(provider, credential.type === "api_key" ? credential.key : credential.access);
  }
  return {
    getApiKey: (provider) => Promise.resolve(runtimeKeys.get(provider)),
    setRuntimeApiKey: (provider, apiKey) => {
      runtimeKeys.set(provider, apiKey);
    },
    hasAuth: (provider) => (provider ? runtimeKeys.has(provider) : runtimeKeys.size > 0),
  };
}

export function normalizeDiscoveredPiModel<T>(value: T, agentDir: string): T {
  if (!isRecord(value)) {
    return value;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.api !== "string"
  ) {
    return value;
  }
  const model = value as unknown as ProviderRuntimeModel;
  const pluginNormalized =
    normalizeProviderResolvedModelWithPlugin({
      provider: model.provider,
      context: {
        provider: model.provider,
        modelId: model.id,
        model,
        agentDir,
      },
    }) ?? model;
  const compatNormalized =
    applyProviderResolvedModelCompatWithPlugins({
      provider: model.provider,
      context: {
        provider: model.provider,
        modelId: model.id,
        model: pluginNormalized,
        agentDir,
      },
    }) ?? pluginNormalized;
  const transportNormalized =
    applyProviderResolvedTransportWithPlugin({
      provider: model.provider,
      context: {
        provider: model.provider,
        modelId: model.id,
        model: compatNormalized,
        agentDir,
      },
    }) ?? compatNormalized;
  return normalizeModelCompat(transportNormalized as Model<Api>) as T;
}

type PiModelRegistryClassLike = { new (runtime: ModelRuntime): PiModelRegistry };

/**
 * pi-coding-agent 1.x builds its ModelRegistry on top of a ModelRuntime, whose
 * async factory reads the agent's auth.json and models.json. Discovery needs the
 * same files, so construct the runtime from the agentDir pair here.
 */
async function instantiatePiModelRegistry(
  agentDir: string,
  modelsJsonPath: string,
): Promise<PiModelRegistry> {
  const Registry = PiModelRegistryClass as unknown as PiModelRegistryClassLike;
  const runtime = await PiCodingAgent.ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: modelsJsonPath,
  });
  return new Registry(runtime);
}

async function createKaijiBotModelRegistry(
  agentDir: string,
  modelsJsonPath: string,
): Promise<PiModelRegistry> {
  const registry = await instantiatePiModelRegistry(agentDir, modelsJsonPath);
  const getAll = registry.getAll.bind(registry);
  const getAvailable = registry.getAvailable.bind(registry);
  const find = registry.find.bind(registry);

  registry.getAll = () =>
    getAll().map((entry: Model<Api>) => normalizeDiscoveredPiModel(entry, agentDir));
  registry.getAvailable = () =>
    getAvailable().map((entry: Model<Api>) => normalizeDiscoveredPiModel(entry, agentDir));
  registry.find = (provider: string, modelId: string) =>
    normalizeDiscoveredPiModel(find(provider, modelId), agentDir);

  return registry;
}

export function scrubLegacyStaticAuthJsonEntriesForDiscovery(pathname: string): void {
  if (process.env.KAIJIBOT_AUTH_STORE_READONLY === "1") {
    return;
  }
  if (!fs.existsSync(pathname)) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(pathname, "utf8")) as unknown;
  } catch {
    return;
  }
  if (!isRecord(parsed)) {
    return;
  }

  let changed = false;
  for (const [provider, value] of Object.entries(parsed)) {
    if (!isRecord(value)) {
      continue;
    }
    if (value.type !== "api_key") {
      continue;
    }
    delete parsed[provider];
    changed = true;
  }

  if (!changed) {
    return;
  }

  if (Object.keys(parsed).length === 0) {
    fs.rmSync(pathname, { force: true });
    return;
  }

  fs.writeFileSync(pathname, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  fs.chmodSync(pathname, 0o600);
}

function createAuthStorage(_path: string, creds: PiCredentialMap): PiAuthStorage {
  return createInMemoryPiAuthStorage(creds);
}

export function addEnvBackedPiCredentials(
  credentials: PiCredentialMap,
  env: NodeJS.ProcessEnv = process.env,
): PiCredentialMap {
  const next = { ...credentials };
  // pi-coding-agent hides providers from its registry when auth storage lacks
  // a matching credential entry. Mirror env-backed provider auth here so
  // live/model discovery sees the same providers runtime auth can use.
  for (const provider of Object.keys(resolveProviderEnvApiKeyCandidates())) {
    if (next[provider]) {
      continue;
    }
    const resolved = resolveEnvApiKey(provider, env);
    if (!resolved?.apiKey) {
      continue;
    }
    next[provider] = {
      type: "api_key",
      key: resolved.apiKey,
    };
  }
  return next;
}

export function resolvePiCredentialsForDiscovery(agentDir: string): PiCredentialMap {
  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const credentials = addEnvBackedPiCredentials(resolvePiCredentialMapFromStore(store));
  for (const provider of resolveRuntimeSyntheticAuthProviderRefs()) {
    if (credentials[provider]) {
      continue;
    }
    const resolved = resolveProviderSyntheticAuthWithPlugin({
      provider,
      context: {
        config: undefined,
        provider,
        providerConfig: undefined,
      },
    });
    const apiKey = resolved?.apiKey?.trim();
    if (!apiKey) {
      continue;
    }
    credentials[provider] = {
      type: "api_key",
      key: apiKey,
    };
  }
  return credentials;
}

// Compatibility helpers for pi-coding-agent 0.50+ (discover* helpers removed).
/**
 * pi-ai 1.6: ModelRegistry wraps a ModelRuntime that owns the auth/models
 * files. Build the live registry lazily from the agent dir.
 */
export async function createPiModelRegistry(
  agentDir: string,
  modelsJsonPath: string,
): Promise<PiModelRegistryLike> {
  const pi = await import("@earendil-works/pi-coding-agent");
  const runtime = await pi.ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: modelsJsonPath,
  });
  return new pi.ModelRegistry(runtime);
}

export function discoverAuthStorage(agentDir: string): PiAuthStorage {
  const credentials = resolvePiCredentialsForDiscovery(agentDir);
  const authPath = path.join(agentDir, "auth.json");
  scrubLegacyStaticAuthJsonEntriesForDiscovery(authPath);
  return createAuthStorage(authPath, credentials);
}

export async function discoverModels(
  authStorage: PiAuthStorage,
  agentDir: string,
): Promise<PiModelRegistry> {
  void authStorage;
  return createKaijiBotModelRegistry(agentDir, path.join(agentDir, "models.json"));
}
