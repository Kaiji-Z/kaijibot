import type { Provider } from "@earendil-works/pi-ai/models";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthCredential } from "./types.js";

const { builtinProvidersMock, refreshMock, ensureDispatcherMock } = vi.hoisted(() => ({
  builtinProvidersMock: vi.fn(),
  refreshMock: vi.fn(),
  ensureDispatcherMock: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/providers/all", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-ai/providers/all")>(
    "@earendil-works/pi-ai/providers/all",
  );
  return { ...actual, builtinProviders: builtinProvidersMock };
});

vi.mock("../../infra/net/undici-global-dispatcher.js", () => ({
  ensureGlobalUndiciEnvProxyDispatcher: ensureDispatcherMock,
}));

const { findProviderOAuthFlow, refreshOAuthCredentialWithProviderFlow } =
  await import("./oauth-provider-flow.js");

async function importActualProvidersAll(): Promise<
  typeof import("@earendil-works/pi-ai/providers/all")
> {
  return await vi.importActual<typeof import("@earendil-works/pi-ai/providers/all")>(
    "@earendil-works/pi-ai/providers/all",
  );
}

function createCredential(overrides: Partial<OAuthCredential> = {}): OAuthCredential {
  return {
    type: "oauth",
    provider: "anthropic",
    access: "expired-access-token",
    refresh: "refresh-token",
    expires: Date.now() - 60_000,
    email: "user@example.com",
    ...overrides,
  };
}

function providerWithOAuthFlow(id: string) {
  return { id, name: id, auth: { oauth: { refresh: refreshMock } } } as unknown as Provider;
}

beforeEach(() => {
  builtinProvidersMock.mockReset();
  refreshMock.mockReset();
  ensureDispatcherMock.mockReset();
});

describe("findProviderOAuthFlow", () => {
  it("finds the OAuth flow a builtin provider declares", async () => {
    const providers = (await importActualProvidersAll()).builtinProviders();

    for (const providerId of ["anthropic", "openai-codex"]) {
      expect(typeof findProviderOAuthFlow(providers, providerId)?.refresh).toBe("function");
    }
  });

  it("returns nothing for a provider without OAuth and for an unknown provider", () => {
    const providers = [
      { id: "zai", name: "Z.AI", auth: { apiKey: { name: "Z.AI" } } },
    ] as unknown as Provider[];

    expect(findProviderOAuthFlow(providers, "zai")).toBeUndefined();
    expect(findProviderOAuthFlow(providers, "not-a-provider")).toBeUndefined();
  });
});

describe("refreshOAuthCredentialWithProviderFlow", () => {
  it("returns null when the provider has no OAuth flow", async () => {
    builtinProvidersMock.mockReturnValue([]);

    await expect(refreshOAuthCredentialWithProviderFlow(createCredential())).resolves.toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("refreshes through the provider's flow and keeps the stored identity fields", async () => {
    const refreshed = {
      type: "oauth" as const,
      access: "next-access",
      refresh: "next-refresh",
      expires: Date.now() + 3_600_000,
    };
    refreshMock.mockResolvedValue(refreshed);
    builtinProvidersMock.mockReturnValue([providerWithOAuthFlow("anthropic")]);
    const credential = createCredential();

    await expect(refreshOAuthCredentialWithProviderFlow(credential)).resolves.toEqual({
      ...credential,
      ...refreshed,
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledWith(credential, expect.any(AbortSignal));
    // Env proxies must be in place before the token request leaves the process.
    expect(ensureDispatcherMock.mock.invocationCallOrder[0]).toBeLessThan(
      refreshMock.mock.invocationCallOrder[0],
    );
  });

  it("fails the way the flow fails", async () => {
    refreshMock.mockRejectedValue(new Error("invalid_grant"));
    builtinProvidersMock.mockReturnValue([providerWithOAuthFlow("anthropic")]);

    await expect(refreshOAuthCredentialWithProviderFlow(createCredential())).rejects.toThrow(
      "invalid_grant",
    );
  });

  it("runs pi-ai's real anthropic flow against a stubbed token endpoint", async () => {
    builtinProvidersMock.mockImplementation((await importActualProvidersAll()).builtinProviders);
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            access_token: "next-access",
            refresh_token: "next-refresh",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const before = Date.now();

    try {
      const result = await refreshOAuthCredentialWithProviderFlow(createCredential());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/oauth\/token$/);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        client_id: expect.any(String),
        grant_type: "refresh_token",
        refresh_token: "refresh-token",
      });
      expect(result).toMatchObject({
        type: "oauth",
        provider: "anthropic",
        access: "next-access",
        refresh: "next-refresh",
        email: "user@example.com",
      });
      // pi-ai leaves five minutes of slack on the token's lifetime.
      expect(result?.expires).toBeGreaterThanOrEqual(before + 3600_000 - 5 * 60_000);
      expect(result?.expires).toBeLessThanOrEqual(Date.now() + 3600_000 - 5 * 60_000);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
