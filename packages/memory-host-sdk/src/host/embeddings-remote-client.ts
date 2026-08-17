import fsSync from "node:fs";
import {
  resolveAuthStorePath,
  resolveLegacyAuthStorePath,
} from "../../../../src/agents/auth-profiles/paths.js";
import { resolveProviderEnvApiKeyCandidates } from "../../../../src/agents/model-auth-env-vars.js";
import { requireApiKey, resolveApiKeyForProvider } from "../../../../src/agents/model-auth.js";
import {
  resolveProviderAuthAliasMap,
  resolveProviderIdForAuth,
} from "../../../../src/agents/provider-auth-aliases.js";
import type { KaijiBotConfig } from "../../../../src/config/config.js";
import type { SsrFPolicy } from "../../../../src/infra/net/ssrf.js";
import type { EmbeddingProviderOptions } from "./embeddings.js";
import { buildRemoteBaseUrlPolicy } from "./remote-http.js";
import { resolveMemorySecretInputString } from "./secret-input.js";

export type RemoteEmbeddingProviderId = "openai" | "voyage" | "mistral";

/**
 * Cheap presence-only check for credential sources the full
 * `resolveApiKeyForProvider` miss path would consult. When none exist, the
 * miss path can be skipped because it would otherwise pay one-time lazy
 * initialization (plugin setup registry, config-backed console settings) that
 * costs tens of seconds in fresh processes.
 *
 * Soundness invariants (guarded by embeddings-remote-client.test.ts):
 * - env candidates come from plugin-manifest metadata; when a provider has a
 *   candidates entry, `resolveEnvApiKey` never falls through to plugin setup
 *   providers, so the env check is complete. Missing entry => run the full
 *   resolver (conservative).
 * - auth profiles can only come from the agent store or the main-agent store
 *   (inheritance source); both are checked by content using the same
 *   provider-auth alias matching as `listProfilesForProvider`. Legacy
 *   auth.json is only consulted when both store files are absent, mirroring
 *   the loader's fallback order. External-CLI sync only injects
 *   `minimax-portal` and `openai-codex` profiles (irrelevant provider ids).
 * - no bundled plugin may implement `resolveExternalAuthProfiles`,
 *   `resolveSyntheticAuth`, or `resolveConfigApiKey` for these providers; the
 *   audit guard test fails if a new one appears and this pre-check must be
 *   re-audited.
 */
export function hasRemoteEmbeddingCredentialSignal(params: {
  provider: string;
  config: KaijiBotConfig | undefined;
  agentDir?: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = params.env ?? process.env;
  if (params.config?.models?.providers?.[params.provider]) {
    return true;
  }
  const aliasParams = { env, config: params.config };
  const normalized = resolveProviderIdForAuth(params.provider, aliasParams);
  const candidates = resolveProviderEnvApiKeyCandidates({
    config: params.config,
    env,
  });
  const envVars = candidates[normalized];
  if (Array.isArray(envVars)) {
    if (envVars.some((name) => env[name]?.trim())) {
      return true;
    }
  } else {
    return true;
  }
  const aliasMap = resolveProviderAuthAliasMap(aliasParams);
  const matchesProvider = (rawProvider: unknown): boolean => {
    if (typeof rawProvider !== "string" || !rawProvider.trim()) {
      return false;
    }
    const credKey = resolveProviderIdForAuth(rawProvider, aliasParams);
    return (
      credKey === normalized ||
      aliasMap[credKey] === normalized ||
      aliasMap[rawProvider] === normalized
    );
  };
  const storeHasProfile = (storePath: string): boolean => {
    let raw: string;
    try {
      raw = fsSync.readFileSync(storePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return false;
      }
      return true;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return true;
    }
    const profiles = (parsed as { profiles?: unknown } | null)?.profiles;
    if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
      return true;
    }
    return Object.values(profiles).some((cred) =>
      matchesProvider((cred as { provider?: unknown } | null)?.provider),
    );
  };
  const agentStore = resolveAuthStorePath(params.agentDir);
  const mainStore = resolveAuthStorePath();
  if (storeHasProfile(agentStore)) {
    return true;
  }
  if (mainStore !== agentStore && storeHasProfile(mainStore)) {
    return true;
  }
  if (!fsSync.existsSync(agentStore) && mainStore !== agentStore && !fsSync.existsSync(mainStore)) {
    return fsSync.existsSync(resolveLegacyAuthStorePath(params.agentDir));
  }
  return false;
}

export async function resolveRemoteEmbeddingBearerClient(params: {
  provider: RemoteEmbeddingProviderId;
  options: EmbeddingProviderOptions;
  defaultBaseUrl: string;
}): Promise<{ baseUrl: string; headers: Record<string, string>; ssrfPolicy?: SsrFPolicy }> {
  const remote = params.options.remote;
  const remoteApiKey = resolveMemorySecretInputString({
    value: remote?.apiKey,
    path: "agents.*.memorySearch.remote.apiKey",
  });
  const remoteBaseUrl = remote?.baseUrl?.trim();
  const providerConfig = params.options.config.models?.providers?.[params.provider];
  let apiKey: string;
  if (remoteApiKey) {
    apiKey = remoteApiKey;
  } else {
    if (
      !hasRemoteEmbeddingCredentialSignal({
        provider: params.provider,
        config: params.options.config,
        agentDir: params.options.agentDir,
      })
    ) {
      throw new Error(
        `No API key found for provider "${params.provider}" (fast pre-check: no credential signal).`,
      );
    }
    apiKey = requireApiKey(
      await resolveApiKeyForProvider({
        provider: params.provider,
        cfg: params.options.config,
        agentDir: params.options.agentDir,
      }),
      params.provider,
    );
  }
  const baseUrl = remoteBaseUrl || providerConfig?.baseUrl?.trim() || params.defaultBaseUrl;
  const headerOverrides = Object.assign({}, providerConfig?.headers, remote?.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...headerOverrides,
  };
  return { baseUrl, headers, ssrfPolicy: buildRemoteBaseUrlPolicy(baseUrl) };
}
