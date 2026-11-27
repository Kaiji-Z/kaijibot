import type { Provider } from "@earendil-works/pi-ai/models";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("kaijibot/plugin-sdk/runtime-env", () => ({
  ensureGlobalUndiciEnvProxyDispatcher: ensureDispatcherMock,
}));

const { refreshOpenAICodexToken } = await import("./openai-codex-provider.runtime.js");

function codexProvider(auth: Record<string, unknown>) {
  return { id: "openai-codex", name: "OpenAI Codex", auth } as unknown as Provider;
}

describe("refreshOpenAICodexToken", () => {
  beforeEach(() => {
    builtinProvidersMock.mockReset();
    refreshMock.mockReset();
    ensureDispatcherMock.mockReset();
  });

  it("refreshes through pi-ai's openai-codex OAuth flow", async () => {
    const refreshed = {
      type: "oauth" as const,
      access: "next-access",
      refresh: "next-refresh",
      expires: Date.now() + 3_600_000,
      accountId: "acct-1",
    };
    refreshMock.mockResolvedValue(refreshed);
    builtinProvidersMock.mockReturnValue([codexProvider({ oauth: { refresh: refreshMock } })]);

    await expect(refreshOpenAICodexToken("refresh-token")).resolves.toEqual(refreshed);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "oauth", refresh: "refresh-token" }),
      expect.any(AbortSignal),
    );
    // Env proxies must be in place before the token request leaves the process.
    expect(ensureDispatcherMock).toHaveBeenCalledTimes(1);
    expect(ensureDispatcherMock.mock.invocationCallOrder[0]).toBeLessThan(
      refreshMock.mock.invocationCallOrder[0],
    );
  });

  it("rejects when pi-ai ships no openai-codex OAuth flow", async () => {
    builtinProvidersMock.mockReturnValue([codexProvider({ apiKey: { name: "OpenAI" } })]);

    await expect(refreshOpenAICodexToken("refresh-token")).rejects.toThrow(
      /OpenAI Codex OAuth refresh is unavailable/,
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("surfaces the flow's failure", async () => {
    refreshMock.mockRejectedValue(new Error("invalid_grant"));
    builtinProvidersMock.mockReturnValue([codexProvider({ oauth: { refresh: refreshMock } })]);

    await expect(refreshOpenAICodexToken("refresh-token")).rejects.toThrow("invalid_grant");
  });
});
