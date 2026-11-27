import type {
  KaijiBotPluginApi,
  ProviderAuthContext,
  ProviderAuthResult,
} from "kaijibot/plugin-sdk/plugin-entry";
import type { OAuthCredential } from "kaijibot/plugin-sdk/provider-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loginMock, refreshMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("./oauth.runtime.js", () => ({
  loginMiniMaxPortalOAuth: loginMock,
  refreshMiniMaxPortalOAuthCredential: refreshMock,
}));

const { registerMinimaxProviders } = await import("./provider-registration.js");

const GLOBAL_TOKEN_ENDPOINT = "https://account.minimax.io/oauth2/token";

type RegisteredProvider = Parameters<KaijiBotPluginApi["registerProvider"]>[0];

function findPortalProvider() {
  const providers: RegisteredProvider[] = [];
  registerMinimaxProviders({
    registerProvider(provider: RegisteredProvider) {
      providers.push(provider);
    },
  } as unknown as KaijiBotPluginApi);
  return providers.find((provider) => provider.id === "minimax-portal");
}

beforeEach(() => {
  loginMock.mockReset();
  refreshMock.mockReset();
});

describe("MiniMax portal OAuth", () => {
  it("refreshes its OAuth profiles through the MiniMax refresh flow", async () => {
    const refreshed: OAuthCredential = {
      type: "oauth",
      provider: "minimax-portal",
      access: "next-access",
      refresh: "next-refresh",
      expires: 1_761_910_000_000,
      tokenEndpoint: GLOBAL_TOKEN_ENDPOINT,
    };
    refreshMock.mockResolvedValue(refreshed);
    const credential: OAuthCredential = { ...refreshed, access: "expired-access-token" };

    await expect(findPortalProvider()?.refreshOAuth?.(credential)).resolves.toEqual(refreshed);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledWith(credential);
  });

  it("records the issuing token endpoint on the signed-in profile", async () => {
    loginMock.mockResolvedValue({
      access: "signed-in-access",
      refresh: "signed-in-refresh",
      expires: 1_761_900_000_000,
      tokenEndpoint: GLOBAL_TOKEN_ENDPOINT,
    });
    const progress = { update: () => {}, stop: () => {} };
    const oauthMethod = findPortalProvider()?.auth?.find((method) => method.id === "oauth");

    const result: ProviderAuthResult | undefined = await oauthMethod?.run({
      openUrl: async () => {},
      prompter: {
        progress: () => progress,
        note: async () => {},
      },
    } as unknown as ProviderAuthContext);

    expect(loginMock).toHaveBeenCalledWith({
      openUrl: expect.any(Function),
      note: expect.any(Function),
      progress,
      region: "global",
    });
    expect(result?.profiles[0].credential).toMatchObject({
      type: "oauth",
      provider: "minimax-portal",
      access: "signed-in-access",
      refresh: "signed-in-refresh",
      tokenEndpoint: GLOBAL_TOKEN_ENDPOINT,
    });
  });
});
