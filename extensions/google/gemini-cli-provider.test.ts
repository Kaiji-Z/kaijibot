import type { KaijiBotPluginApi } from "kaijibot/plugin-sdk/plugin-entry";
import { describe, expect, it, vi } from "vitest";

const { refreshGeminiCliOAuthCredentialMock } = vi.hoisted(() => ({
  refreshGeminiCliOAuthCredentialMock: vi.fn(),
}));

vi.mock("./oauth.refresh.js", () => ({
  refreshGeminiCliOAuthCredential: refreshGeminiCliOAuthCredentialMock,
}));

const { registerGoogleGeminiCliProvider } = await import("./gemini-cli-provider.js");

type RegisteredProvider = Parameters<KaijiBotPluginApi["registerProvider"]>[0];

describe("registerGoogleGeminiCliProvider", () => {
  it("refreshes its OAuth profiles through the Gemini CLI refresh flow", async () => {
    const registered: RegisteredProvider[] = [];
    const api = {
      registerProvider: (provider: RegisteredProvider) => {
        registered.push(provider);
      },
    } as unknown as KaijiBotPluginApi;

    registerGoogleGeminiCliProvider(api);

    expect(registered).toHaveLength(1);
    const credential = {
      type: "oauth" as const,
      provider: "google-gemini-cli",
      access: "expired-access",
      refresh: "refresh-token",
      expires: Date.now() - 60_000,
    };
    refreshGeminiCliOAuthCredentialMock.mockResolvedValue({ ...credential, access: "next-access" });

    await expect(registered[0]?.refreshOAuth?.(credential)).resolves.toMatchObject({
      access: "next-access",
    });
    expect(refreshGeminiCliOAuthCredentialMock).toHaveBeenCalledTimes(1);
    expect(refreshGeminiCliOAuthCredentialMock).toHaveBeenCalledWith(credential);
  });
});
