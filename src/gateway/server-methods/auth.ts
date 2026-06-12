import { listProfilesForProvider, upsertAuthProfile } from "../../agents/auth-profiles/profiles.js";
import { loadAuthProfileStoreForSecretsRuntime } from "../../agents/auth-profiles/store.js";
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
  getProviderRegistrations?: () => ProviderRegistrationEntry[];
  getManifestRegistry?: () => PluginManifestRegistry;
}): GatewayRequestHandlers {
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

      const { provider, apiKey, endpoint } = params;

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

      try {
        upsertAuthProfile({
          profileId,
          credential: {
            type: "api_key",
            provider,
            key: apiKey,
            ...(endpoint ? { metadata: { endpoint } } : {}),
          },
          agentDir: deps.agentDir,
        });
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
