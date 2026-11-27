import type { Provider } from "@earendil-works/pi-ai/models";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { ensureGlobalUndiciEnvProxyDispatcher } from "../../infra/net/undici-global-dispatcher.js";
import type { OAuthCredential } from "./types.js";

export type ProviderOAuthFlow = NonNullable<Provider["auth"]["oauth"]>;

/** pi-ai bounds its own refresh the same way. */
const OAUTH_REFRESH_TIMEOUT_MS = 15_000;

/**
 * The OAuth flow pi-ai ships for a provider, when it ships one.
 *
 * pi-ai 1.6 has no global OAuth registry any more: what a provider supports
 * (login, refresh) is declared on its provider definition as `auth.oauth`.
 */
export function findProviderOAuthFlow(
  providers: readonly Provider[],
  providerId: string,
): ProviderOAuthFlow | undefined {
  const provider = providers.find((candidate) => candidate.id === providerId);
  return provider?.auth.oauth;
}

/**
 * Refresh a stored OAuth profile through the flow its provider declares in pi-ai.
 * Resolves `null` when the provider declares no OAuth flow, so the caller keeps
 * its own handling of "nothing could refresh this". A failed refresh rejects.
 */
export async function refreshOAuthCredentialWithProviderFlow(
  credential: OAuthCredential,
): Promise<OAuthCredential | null> {
  const flow = findProviderOAuthFlow(builtinProviders(), credential.provider);
  if (!flow) {
    return null;
  }
  ensureGlobalUndiciEnvProxyDispatcher();
  const refreshed = await flow.refresh(credential, AbortSignal.timeout(OAUTH_REFRESH_TIMEOUT_MS));
  return { ...credential, ...refreshed, type: "oauth", provider: credential.provider };
}
