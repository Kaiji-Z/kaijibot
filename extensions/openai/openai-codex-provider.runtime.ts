import type { Provider } from "@earendil-works/pi-ai/models";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { ensureGlobalUndiciEnvProxyDispatcher } from "kaijibot/plugin-sdk/runtime-env";

const PROVIDER_ID = "openai-codex";

/** pi-ai bounds its own refresh the same way. */
const OAUTH_REFRESH_TIMEOUT_MS = 15_000;

/**
 * pi-ai 1.6 keeps the Codex OAuth flow on its `openai-codex` provider definition
 * (`auth.oauth`) instead of exporting it from the package root.
 */
function resolveOpenAICodexOAuthFlow(): Provider["auth"]["oauth"] | undefined {
  const provider = builtinProviders().find((candidate) => candidate.id === PROVIDER_ID);
  return provider?.auth.oauth;
}

/**
 * Nothing in this build resolves Codex credentials this way any more; the wrapper
 * keeps its shape for the provider runtime.
 */
export async function getOAuthApiKey(
  provider: string,
  creds: Record<string, unknown>,
): Promise<string | undefined> {
  void provider;
  void creds;
  throw new Error(
    "OpenAI Codex OAuth key lookup is unavailable in this build. Refresh the credential instead.",
  );
}

/**
 * Exchange a Codex refresh token. The flow reads only the refresh token; the
 * access token and expiry are placeholders its credential signature asks for.
 * A failed exchange throws the flow's own error.
 */
export async function refreshOpenAICodexToken(refreshToken: string) {
  ensureGlobalUndiciEnvProxyDispatcher();
  const flow = resolveOpenAICodexOAuthFlow();
  if (!flow) {
    throw new Error(
      "OpenAI Codex OAuth refresh is unavailable: pi-ai ships no openai-codex OAuth flow.",
    );
  }
  return await flow.refresh(
    { type: "oauth", access: "", refresh: refreshToken, expires: 0 },
    AbortSignal.timeout(OAUTH_REFRESH_TIMEOUT_MS),
  );
}
