import { randomBytes, randomUUID } from "node:crypto";
import type { OAuthCredential } from "kaijibot/plugin-sdk/provider-auth";
import { generatePkceVerifierChallenge, toFormUrlEncoded } from "kaijibot/plugin-sdk/provider-auth";
import { ensureGlobalUndiciEnvProxyDispatcher } from "kaijibot/plugin-sdk/runtime-env";

export type MiniMaxRegion = "cn" | "global";

// OAuth lives on the account domain; the api.* OAuth paths only redirect there.
const MINIMAX_OAUTH_CONFIG = {
  cn: {
    baseUrl: "https://api.minimaxi.com",
    oauthBaseUrl: "https://account.minimaxi.com",
    clientId: "78257093-7e40-4613-99e0-527b14b39113",
  },
  global: {
    baseUrl: "https://api.minimax.io",
    oauthBaseUrl: "https://account.minimax.io",
    clientId: "78257093-7e40-4613-99e0-527b14b39113",
  },
} as const;

const MINIMAX_REGIONS: readonly MiniMaxRegion[] = ["global", "cn"];
const MINIMAX_OAUTH_SCOPE = "group_id profile model.completion";
const MINIMAX_OAUTH_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:user_code";
const MINIMAX_OAUTH_FETCH_TIMEOUT_MS = 30_000;
// `expired_in` is a unix-ms timestamp; a smaller value is a lifetime in seconds.
const MINIMAX_RELATIVE_EXPIRY_SECONDS_THRESHOLD = 1_000_000_000;
const MINIMAX_ABSOLUTE_EXPIRY_MS_THRESHOLD = 1_000_000_000_000;

const TOKEN_REQUEST_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
} as const;

function getOAuthEndpoints(region: MiniMaxRegion) {
  const config = MINIMAX_OAUTH_CONFIG[region];
  return {
    codeEndpoint: `${config.oauthBaseUrl}/oauth2/device/code`,
    tokenEndpoint: `${config.oauthBaseUrl}/oauth2/token`,
    clientId: config.clientId,
  };
}

/** Resolves when `expiredIn` is neither a plausible timestamp nor a plausible lifetime. */
export function resolveMiniMaxExpiresAtMs(expiredIn: number, nowMs: number): number | undefined {
  if (!Number.isFinite(expiredIn) || expiredIn <= 0) {
    return undefined;
  }
  if (expiredIn >= MINIMAX_ABSOLUTE_EXPIRY_MS_THRESHOLD) {
    return expiredIn;
  }
  if (expiredIn < MINIMAX_RELATIVE_EXPIRY_SECONDS_THRESHOLD) {
    return nowMs + expiredIn * 1000;
  }
  return undefined;
}

export type MiniMaxOAuthAuthorization = {
  user_code: string;
  verification_uri: string;
  expired_in: number;
  interval?: number;
  state: string;
};

export type MiniMaxOAuthToken = {
  access: string;
  refresh: string;
  expires: number;
  resourceUrl?: string;
  notification_message?: string;
  /** Regional token endpoint that issued the credential; refresh is bound to it. */
  tokenEndpoint: string;
};

type TokenPending = { status: "pending"; message?: string };

type TokenResult =
  | { status: "success"; token: Omit<MiniMaxOAuthToken, "tokenEndpoint"> }
  | TokenPending
  | { status: "error"; message: string };

type TokenPayload = {
  status?: string;
  base_resp?: { status_code?: number; status_msg?: string };
  access_token?: string | null;
  refresh_token?: string | null;
  expired_in?: number | null;
  resource_url?: string;
  notification_message?: string;
};

function generatePkce(): { verifier: string; challenge: string; state: string } {
  const { verifier, challenge } = generatePkceVerifierChallenge();
  const state = randomBytes(16).toString("base64url");
  return { verifier, challenge, state };
}

async function requestOAuthCode(params: {
  challenge: string;
  state: string;
  region: MiniMaxRegion;
}): Promise<MiniMaxOAuthAuthorization> {
  const endpoints = getOAuthEndpoints(params.region);
  const response = await fetch(endpoints.codeEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-request-id": randomUUID(),
    },
    body: toFormUrlEncoded({
      response_type: "code",
      client_id: endpoints.clientId,
      scope: MINIMAX_OAUTH_SCOPE,
      code_challenge: params.challenge,
      code_challenge_method: "S256",
      state: params.state,
    }),
    signal: AbortSignal.timeout(MINIMAX_OAUTH_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MiniMax OAuth authorization failed: ${text || response.statusText}`);
  }

  const payload = (await response.json()) as MiniMaxOAuthAuthorization & { error?: string };
  if (!payload.user_code || !payload.verification_uri) {
    throw new Error(
      payload.error ??
        "MiniMax OAuth authorization returned an incomplete payload (missing user_code or verification_uri).",
    );
  }
  if (payload.state !== params.state) {
    throw new Error("MiniMax OAuth state mismatch: possible CSRF attack or session corruption.");
  }
  return payload;
}

/**
 * Reads a token-endpoint response for either grant. `previousRefresh` marks a refresh grant,
 * which may leave `refresh_token` out when the server does not rotate it.
 */
async function readTokenResponse(
  response: Response,
  previousRefresh?: string,
): Promise<TokenResult> {
  const text = await response.text();
  let payload: TokenPayload | undefined;
  if (text) {
    try {
      payload = JSON.parse(text) as TokenPayload;
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    return {
      status: "error",
      message:
        (payload?.base_resp?.status_msg ?? text) || "MiniMax OAuth failed to parse response.",
    };
  }

  if (!payload) {
    return { status: "error", message: "MiniMax OAuth failed to parse response." };
  }

  if (payload.status === "error") {
    return { status: "error", message: "An error occurred. Please try again later" };
  }

  if (payload.status !== "success") {
    return { status: "pending", message: "current user code is not authorized" };
  }

  const refresh = payload.refresh_token ?? previousRefresh;
  const expires =
    typeof payload.expired_in === "number"
      ? resolveMiniMaxExpiresAtMs(payload.expired_in, Date.now())
      : undefined;
  if (!payload.access_token || !refresh || expires === undefined) {
    return { status: "error", message: "MiniMax OAuth returned incomplete token payload." };
  }

  return {
    status: "success",
    token: {
      access: payload.access_token,
      refresh,
      expires,
      resourceUrl: payload.resource_url,
      notification_message: payload.notification_message,
    },
  };
}

async function pollOAuthToken(params: {
  userCode: string;
  verifier: string;
  region: MiniMaxRegion;
}): Promise<TokenResult> {
  const endpoints = getOAuthEndpoints(params.region);
  const response = await fetch(endpoints.tokenEndpoint, {
    method: "POST",
    headers: TOKEN_REQUEST_HEADERS,
    body: toFormUrlEncoded({
      grant_type: MINIMAX_OAUTH_GRANT_TYPE,
      client_id: endpoints.clientId,
      user_code: params.userCode,
      code_verifier: params.verifier,
    }),
    signal: AbortSignal.timeout(MINIMAX_OAUTH_FETCH_TIMEOUT_MS),
  });
  return await readTokenResponse(response);
}

/**
 * Exchange a MiniMax portal refresh token. The request goes back to the token endpoint that
 * issued the credential, so it never crosses regions; a sign-in that records no endpoint is
 * refused before any request.
 */
export async function refreshMiniMaxPortalOAuthCredential(
  credential: OAuthCredential,
): Promise<OAuthCredential> {
  const region = MINIMAX_REGIONS.find(
    (candidate) => getOAuthEndpoints(candidate).tokenEndpoint === credential.tokenEndpoint,
  );
  if (!region) {
    throw new Error(
      "MiniMax OAuth refresh failed: this sign-in does not record the account region it was issued for. Sign in again.",
    );
  }
  if (!credential.refresh) {
    throw new Error(
      "MiniMax OAuth refresh failed: this sign-in has no refresh token. Sign in again.",
    );
  }
  // Without the dispatcher, HTTP_PROXY/HTTPS_PROXY env vars are silently ignored (#51619).
  ensureGlobalUndiciEnvProxyDispatcher();

  const endpoints = getOAuthEndpoints(region);
  const response = await fetch(endpoints.tokenEndpoint, {
    method: "POST",
    headers: TOKEN_REQUEST_HEADERS,
    body: toFormUrlEncoded({
      grant_type: "refresh_token",
      client_id: endpoints.clientId,
      refresh_token: credential.refresh,
    }),
    signal: AbortSignal.timeout(MINIMAX_OAUTH_FETCH_TIMEOUT_MS),
  });
  const result = await readTokenResponse(response, credential.refresh);
  if (result.status !== "success") {
    throw new Error(
      `MiniMax OAuth refresh failed: ${result.status === "error" ? result.message : "no token returned"}. Sign in again.`,
    );
  }

  return {
    ...credential,
    access: result.token.access,
    refresh: result.token.refresh,
    expires: result.token.expires,
  };
}

export async function loginMiniMaxPortalOAuth(params: {
  openUrl: (url: string) => Promise<void>;
  note: (message: string, title?: string) => Promise<void>;
  progress: { update: (message: string) => void; stop: (message?: string) => void };
  region?: MiniMaxRegion;
}): Promise<MiniMaxOAuthToken> {
  // Ensure env-based proxy dispatcher is active before any outbound fetch calls.
  // Without this, HTTP_PROXY/HTTPS_PROXY env vars are silently ignored (#51619).
  ensureGlobalUndiciEnvProxyDispatcher();
  const region = params.region ?? "global";
  const { verifier, challenge, state } = generatePkce();
  const endpoints = getOAuthEndpoints(region);
  const oauth = await requestOAuthCode({ challenge, state, region });
  const verificationUrl = oauth.verification_uri;

  const noteLines = [
    `Open ${verificationUrl} to approve access.`,
    `If prompted, enter the code ${oauth.user_code}.`,
    `Interval: ${oauth.interval ?? "default (2000ms)"}, Expires at: ${oauth.expired_in} unix timestamp`,
  ];
  await params.note(noteLines.join("\n"), "MiniMax OAuth");

  try {
    await params.openUrl(verificationUrl);
  } catch {
    // Fall back to manual copy/paste if browser open fails.
  }

  let pollIntervalMs = oauth.interval ? oauth.interval : 2000;
  const expireTimeMs = oauth.expired_in;

  while (Date.now() < expireTimeMs) {
    params.progress.update("Waiting for MiniMax OAuth approval…");
    const result = await pollOAuthToken({
      userCode: oauth.user_code,
      verifier,
      region,
    });

    if (result.status === "success") {
      return { ...result.token, tokenEndpoint: endpoints.tokenEndpoint };
    }

    if (result.status === "error") {
      throw new Error(result.message);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    pollIntervalMs = Math.max(pollIntervalMs, 2000);
  }

  throw new Error("MiniMax OAuth timed out before authorization completed.");
}
