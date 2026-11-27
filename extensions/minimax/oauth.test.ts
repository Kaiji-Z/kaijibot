import type { OAuthCredential } from "kaijibot/plugin-sdk/provider-auth";
import { afterEach, describe, expect, it, vi } from "vitest";

const { ensureDispatcherMock } = vi.hoisted(() => ({ ensureDispatcherMock: vi.fn() }));

vi.mock("kaijibot/plugin-sdk/runtime-env", () => ({
  ensureGlobalUndiciEnvProxyDispatcher: ensureDispatcherMock,
}));

const { loginMiniMaxPortalOAuth, refreshMiniMaxPortalOAuthCredential, resolveMiniMaxExpiresAtMs } =
  await import("./oauth.js");

const GLOBAL_TOKEN_ENDPOINT = "https://account.minimax.io/oauth2/token";
const CN_TOKEN_ENDPOINT = "https://account.minimaxi.com/oauth2/token";
const CN_CODE_ENDPOINT = "https://account.minimaxi.com/oauth2/device/code";
const CLIENT_ID = "78257093-7e40-4613-99e0-527b14b39113";
const NOW = 1_761_800_000_000;
const SIGNED_IN_EXPIRES_AT = 1_761_900_000_000;
const NEXT_EXPIRES_AT = 1_761_910_000_000;

type FetchCall = { url: string; init: RequestInit };

/** Answers each request in order (the last answer repeats) and records what was sent. */
function stubFetch(...answers: Array<(call: FetchCall) => Response>) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (!init) {
      throw new Error("MiniMax OAuth requests must carry a method and a body");
    }
    const call = { url: String(input), init };
    calls.push(call);
    return answers[Math.min(calls.length, answers.length) - 1](call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formBody(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(init.body)));
}

function createCredential(overrides: Partial<OAuthCredential> = {}): OAuthCredential {
  return {
    type: "oauth",
    provider: "minimax-portal",
    access: "expired-access-token",
    refresh: "stored-refresh-token",
    expires: SIGNED_IN_EXPIRES_AT,
    tokenEndpoint: GLOBAL_TOKEN_ENDPOINT,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  ensureDispatcherMock.mockReset();
});

describe("resolveMiniMaxExpiresAtMs", () => {
  it("reads a unix-ms timestamp as is and a small value as a lifetime in seconds", () => {
    expect(resolveMiniMaxExpiresAtMs(SIGNED_IN_EXPIRES_AT, NOW)).toBe(SIGNED_IN_EXPIRES_AT);
    expect(resolveMiniMaxExpiresAtMs(3600, NOW)).toBe(NOW + 3_600_000);
  });

  it("rejects values that are neither", () => {
    for (const expiredIn of [0, -1, Number.NaN, 50_000_000_000]) {
      expect(resolveMiniMaxExpiresAtMs(expiredIn, NOW)).toBeUndefined();
    }
  });
});

describe("refreshMiniMaxPortalOAuthCredential", () => {
  it("exchanges the refresh token at the endpoint that issued the credential", async () => {
    const { calls, fetchMock } = stubFetch(() =>
      jsonResponse(200, {
        status: "success",
        access_token: "next-access",
        expired_in: NEXT_EXPIRES_AT,
      }),
    );
    const credential = createCredential();

    await expect(refreshMiniMaxPortalOAuthCredential(credential)).resolves.toEqual({
      ...credential,
      access: "next-access",
      expires: NEXT_EXPIRES_AT,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GLOBAL_TOKEN_ENDPOINT);
    expect(calls[0].init.method).toBe("POST");
    expect(formBody(calls[0].init)).toEqual({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: "stored-refresh-token",
    });
    // Env proxies must be in place before the token request leaves the process.
    expect(ensureDispatcherMock).toHaveBeenCalledTimes(1);
    expect(ensureDispatcherMock.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0],
    );
  });

  it("keeps a CN sign-in on the CN endpoint", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse(200, {
        status: "success",
        access_token: "next-access",
        expired_in: NEXT_EXPIRES_AT,
      }),
    );

    await refreshMiniMaxPortalOAuthCredential(
      createCredential({ tokenEndpoint: CN_TOKEN_ENDPOINT }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(CN_TOKEN_ENDPOINT);
  });

  it("stores the rotated refresh token when MiniMax returns one", async () => {
    stubFetch(() =>
      jsonResponse(200, {
        status: "success",
        access_token: "next-access",
        refresh_token: "rotated-refresh-token",
        expired_in: NEXT_EXPIRES_AT,
      }),
    );

    await expect(refreshMiniMaxPortalOAuthCredential(createCredential())).resolves.toMatchObject({
      refresh: "rotated-refresh-token",
      access: "next-access",
    });
  });

  it("refuses a sign-in that records no endpoint, before any request", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { status: "success" }));
    const credential = createCredential();
    delete credential.tokenEndpoint;

    await expect(refreshMiniMaxPortalOAuthCredential(credential)).rejects.toThrow(
      /does not record the account region/,
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses a sign-in with no refresh token, before any request", async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { status: "success" }));

    await expect(
      refreshMiniMaxPortalOAuthCredential(createCredential({ refresh: "" })),
    ).rejects.toThrow(/no refresh token/);
    expect(calls).toHaveLength(0);
  });

  it("fails with the provider's error when the refresh token is rejected", async () => {
    stubFetch(() =>
      jsonResponse(400, { error: "invalid_grant", error_description: "refresh token expired" }),
    );

    await expect(refreshMiniMaxPortalOAuthCredential(createCredential())).rejects.toThrow(
      /invalid_grant/,
    );
  });

  it("fails when the response carries no token", async () => {
    stubFetch(() => jsonResponse(200, { status: "success", expired_in: NEXT_EXPIRES_AT }));

    await expect(refreshMiniMaxPortalOAuthCredential(createCredential())).rejects.toThrow(
      /incomplete token payload/,
    );
  });
});

describe("loginMiniMaxPortalOAuth", () => {
  it("signs in on the account endpoints and records the issuing token endpoint", async () => {
    const { calls } = stubFetch(
      (call) =>
        jsonResponse(200, {
          user_code: "ABCD-EFGH",
          verification_uri: "https://account.minimaxi.com/oauth2/device",
          expired_in: Date.now() + 60_000,
          interval: 1,
          state: formBody(call.init).state,
        }),
      () =>
        jsonResponse(200, {
          status: "success",
          access_token: "signed-in-access",
          refresh_token: "signed-in-refresh",
          expired_in: SIGNED_IN_EXPIRES_AT,
        }),
    );

    const token = await loginMiniMaxPortalOAuth({
      openUrl: async () => {},
      note: async () => {},
      progress: { update: () => {}, stop: () => {} },
      region: "cn",
    });

    expect(token).toEqual({
      access: "signed-in-access",
      refresh: "signed-in-refresh",
      expires: SIGNED_IN_EXPIRES_AT,
      tokenEndpoint: CN_TOKEN_ENDPOINT,
    });
    expect(calls.map((call) => call.url)).toEqual([CN_CODE_ENDPOINT, CN_TOKEN_ENDPOINT]);
    expect(formBody(calls[0].init)).toEqual({
      response_type: "code",
      client_id: CLIENT_ID,
      scope: "group_id profile model.completion",
      code_challenge: expect.any(String),
      code_challenge_method: "S256",
      state: expect.any(String),
    });
    expect(formBody(calls[1].init)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:user_code",
      client_id: CLIENT_ID,
      user_code: "ABCD-EFGH",
      code_verifier: expect.any(String),
    });
  });
});
