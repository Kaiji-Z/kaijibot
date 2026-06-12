import { listProfilesForProvider, upsertAuthProfile } from "../../agents/auth-profiles/profiles.js";
import { loadAuthProfileStoreForSecretsRuntime } from "../../agents/auth-profiles/store.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAuthStoreApiKeyParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const PROVIDER_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

export function createAuthHandlers(deps: {
  agentDir?: string;
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

      const { provider, apiKey } = params;

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

      const profileId = params.profileId ?? `${provider}:default`;

      try {
        upsertAuthProfile({
          profileId,
          credential: { type: "api_key", provider, key: apiKey },
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
  };
}
