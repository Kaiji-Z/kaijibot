import type { OAuthCredential } from "kaijibot/plugin-sdk/provider-auth";
import { resolveOAuthClientConfig } from "./oauth.credentials.js";
import { fetchWithTimeout } from "./oauth.http.js";
import { TOKEN_URL } from "./oauth.shared.js";

/**
 * Exchange a stored refresh token for a new access token, with the same client
 * and token endpoint the login exchange uses. Google returns a new access token;
 * the refresh token is kept unless the response rotates it.
 */
export async function refreshGeminiCliOAuthCredential(
  credential: OAuthCredential,
): Promise<OAuthCredential> {
  const { clientId, clientSecret } = resolveOAuthClientConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: credential.refresh,
  });
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "*/*",
      "User-Agent": "google-api-nodejs-client/9.15.1",
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token || typeof data.expires_in !== "number") {
    throw new Error("Token refresh failed: Google returned no access token.");
  }

  return {
    ...credential,
    access: data.access_token,
    ...(data.refresh_token ? { refresh: data.refresh_token } : {}),
    // Five minutes of slack, the same the login exchange leaves.
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}
