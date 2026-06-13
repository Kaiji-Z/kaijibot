import { listProfilesForProvider, upsertAuthProfile } from "../../agents/auth-profiles/profiles.js";
import { listAgentIds, resolveAgentDir } from "../../agents/agent-scope.js";
import { invalidateModelCatalog } from "../../agents/model-catalog.js";
import { loadAuthProfileStoreForSecretsRuntime } from "../../agents/auth-profiles/store.js";
import { loadConfig } from "../../config/config.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { writeConfigFile } from "../../config/io.js";
import type { ModelApi } from "../../config/types.models.js";
import type { PluginManifestRegistry } from "../../plugins/manifest-registry.js";
import type { ProviderPlugin } from "../../plugins/types.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAuthStoreApiKeyParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const PROVIDER_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

type ProviderRegistrationEntry = {
  provider: ProviderPlugin;
};

export function createAuthHandlers(deps: {
  agentDir?: string;
  getConfig?: () => KaijiBotConfig;
  getProviderRegistrations?: () => ProviderRegistrationEntry[];
  getManifestRegistry?: () => PluginManifestRegistry;
}): GatewayRequestHandlers {
  /**
   * Resolve the list of agent directories to write to.
   * - If `agentId` is specified: write to that single agent's dir.
   * - If `agentId` is omitted: broadcast to ALL configured agent dirs.
   */
  function resolveTargetAgentDirs(agentId?: string): string[] {
    const cfg = deps.getConfig?.();
    if (!cfg) {
      return deps.agentDir ? [deps.agentDir] : [undefined as unknown as string];
    }
    if (agentId) {
      return [resolveAgentDir(cfg, agentId)];
    }
    return listAgentIds(cfg).map((id) => resolveAgentDir(cfg, id));
  }

  return {
    "auth.storeApiKey": async ({ params, respond }) => {
      if (!validateAuthStoreApiKeyParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid auth.storeApiKey params: ${formatValidationErrors(validateAuthStoreApiKeyParams.errors)}`,
          ),
        );
        return;
      }

      const { provider, apiKey, endpoint, agentId } = params;

      if (!PROVIDER_ID_RE.test(provider)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid auth.storeApiKey params: provider contains disallowed characters`,
          ),
        );
        return;
      }

      const profileId = (params.profileId as string | undefined) ?? `${provider}:default`;
      const targetDirs = resolveTargetAgentDirs(agentId);

      try {
        for (const dir of targetDirs) {
          upsertAuthProfile({
            profileId,
            credential: {
              type: "api_key",
              provider,
              key: apiKey,
              ...(endpoint ? { metadata: { endpoint } } : {}),
            },
            ...(dir ? { agentDir: dir } : {}),
          });
        }
        seedProviderModelsFromManifest(provider, deps.getManifestRegistry);
        invalidateModelCatalog();
        respond(true, { ok: true });
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
      }
    },

    "auth.listProviderStatus": async ({ respond }) => {
      try {
        const store = loadAuthProfileStoreForSecretsRuntime(deps.agentDir);
        const configuredProviders = new Set<string>();
        for (const cred of Object.values(store.profiles)) {
          if (cred?.provider) {
            configuredProviders.add(cred.provider);
          }
        }
        respond(true, { providers: [...configuredProviders].sort() });
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
      }
    },

    "auth.listProviderAuthOptions": async ({ respond }) => {
      try {
        const store = loadAuthProfileStoreForSecretsRuntime(deps.agentDir);
        const configuredProviders = new Set<string>();
        for (const cred of Object.values(store.profiles)) {
          if (cred?.provider) {
            configuredProviders.add(cred.provider);
          }
        }

        // Merge runtime providers (fully loaded) with manifest-only providers
        const runtimeRegistrations = deps.getProviderRegistrations?.() ?? [];
        const runtimeProviderIds = new Set(runtimeRegistrations.map((r) => r.provider.id));

        const runtimeProviders = runtimeRegistrations.map(({ provider }) => ({
          providerId: provider.id,
          providerLabel: provider.label,
          configured: configuredProviders.has(provider.id),
          authOptions: provider.auth.map((method) => ({
            id: method.id,
            label: method.label,
            hint: method.hint,
            kind: method.kind,
            endpoint: method.endpoint,
          })),
        }));

        const manifestProviders: typeof runtimeProviders = [];
        const manifestReg = deps.getManifestRegistry?.();
        if (manifestReg) {
          const seenProviderIds = new Set(runtimeProviderIds);
          for (const plugin of manifestReg.plugins) {
            const choices = plugin.providerAuthChoices;
            if (!choices || choices.length === 0) continue;
            for (const providerId of plugin.providers) {
              if (seenProviderIds.has(providerId)) continue;
              seenProviderIds.add(providerId);
              const providerChoices = choices.filter((c) => c.provider === providerId);
              if (providerChoices.length === 0) continue;
              manifestProviders.push({
                providerId,
                providerLabel: providerId,
                configured: configuredProviders.has(providerId),
                authOptions: providerChoices.map((c) => ({
                  id: c.method,
                  label: c.choiceLabel ?? c.method,
                  hint: c.choiceHint,
                  kind: "api_key" as const,
                  endpoint: c.method,
                })),
              });
            }
          }
        }

        const providers = [...runtimeProviders, ...manifestProviders].sort((a, b) =>
          a.providerId.localeCompare(b.providerId),
        );

        respond(true, { providers });
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
      }
    },
  };
}

export function seedProviderModelsFromManifest(
  providerId: string,
  getManifestRegistry?: () => PluginManifestRegistry,
): void {
  if (!getManifestRegistry) return;
  const registry = getManifestRegistry();
  const plugin = registry.plugins.find((p) => p.providers.includes(providerId));
  const manifestCatalog = plugin?.modelCatalog?.providers?.[providerId];
  if (!manifestCatalog?.models?.length) return;

  const cfg = loadConfig();
  const existing = cfg.models?.providers?.[providerId];
  if (existing?.models?.length) return;

  const nextCfg = structuredClone(cfg);
  if (!nextCfg.models) nextCfg.models = {};
  if (!nextCfg.models.providers) nextCfg.models.providers = {};
  nextCfg.models.providers[providerId] = {
    baseUrl: manifestCatalog.baseUrl ?? "",
    ...(manifestCatalog.api ? { api: manifestCatalog.api as ModelApi } : {}),
    models: manifestCatalog.models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      reasoning: m.reasoning ?? false,
      input: (m.input ?? ["text"]) as ["text"],
      contextWindow: m.contextWindow ?? 128000,
      maxTokens: m.maxTokens ?? 8192,
      cost: {
        input: m.cost?.input ?? 0,
        output: m.cost?.output ?? 0,
        cacheRead: m.cost?.cacheRead ?? 0,
        cacheWrite: m.cost?.cacheWrite ?? 0,
      },
      ...(m.compat ? { compat: { ...m.compat } } : {}),
    })),
  };

  try {
    void writeConfigFile(nextCfg);
  } catch {
    // Config seeding is best-effort; the API key was already saved.
  }
}
