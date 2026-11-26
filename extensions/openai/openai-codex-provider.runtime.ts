import { ensureGlobalUndiciEnvProxyDispatcher } from "kaijibot/plugin-sdk/runtime-env";

/**
 * pi-ai 1.6 removed the public codex OAuth helpers. The wrappers keep their
 * shapes for the provider runtime and fail with a clear, actionable error.
 */
const unavailable = (): never => {
  throw new Error(
    "OpenAI Codex OAuth token refresh is unavailable: pi-ai 1.6 removed the public OAuth API. Re-authenticate via the Codex CLI and re-import credentials.",
  );
};

export async function getOAuthApiKey(
  provider: string,
  creds: Record<string, unknown>,
): Promise<string | undefined> {
  ensureGlobalUndiciEnvProxyDispatcher();
  void provider;
  void creds;
  return unavailable();
}

export async function refreshOpenAICodexToken(refreshToken: string): Promise<never> {
  ensureGlobalUndiciEnvProxyDispatcher();
  void refreshToken;
  return unavailable();
}
