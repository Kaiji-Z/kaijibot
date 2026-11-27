import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN_URL } from "./oauth.shared.js";

const { fetchWithTimeoutMock } = vi.hoisted(() => ({ fetchWithTimeoutMock: vi.fn() }));

vi.mock("./oauth.http.js", () => ({ fetchWithTimeout: fetchWithTimeoutMock }));
vi.mock("./oauth.credentials.js", () => ({
  resolveOAuthClientConfig: () => ({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
  }),
}));

const { refreshGeminiCliOAuthCredential } = await import("./oauth.refresh.js");

const REFRESHED_ACCESS = "next-access";

function createCredential() {
  return {
    type: "oauth" as const,
    provider: "google-gemini-cli",
    access: "expired-access",
    refresh: "refresh-token",
    expires: Date.now() - 60_000,
    email: "user@example.com",
    projectId: "project-1",
  };
}

function tokenResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function requestBodyOf(call: unknown[]): URLSearchParams {
  const init = call[1] as RequestInit;
  return new URLSearchParams(String(init.body));
}

describe("refreshGeminiCliOAuthCredential", () => {
  beforeEach(() => {
    fetchWithTimeoutMock.mockReset();
  });

  it("exchanges the refresh token at Google's token endpoint and keeps the stored identity", async () => {
    fetchWithTimeoutMock.mockResolvedValue(
      tokenResponse({ access_token: REFRESHED_ACCESS, expires_in: 3600, token_type: "Bearer" }),
    );
    const before = Date.now();
    const credential = createCredential();

    const result = await refreshGeminiCliOAuthCredential(credential);

    // Five minutes of slack, the same the login exchange leaves.
    expect(result).toEqual({
      ...credential,
      access: REFRESHED_ACCESS,
      refresh: "refresh-token",
      expires: expect.any(Number),
    });
    expect(result.expires).toBeGreaterThanOrEqual(before + 3600_000 - 5 * 60_000);
    expect(result.expires).toBeLessThanOrEqual(Date.now() + 3600_000 - 5 * 60_000);
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1);
    const [url] = fetchWithTimeoutMock.mock.calls[0] ?? [];
    expect(url).toBe(TOKEN_URL);
    expect(Object.fromEntries(requestBodyOf(fetchWithTimeoutMock.mock.calls[0] ?? []))).toEqual({
      client_id: "test-client-id",
      client_secret: "test-client-secret",
      grant_type: "refresh_token",
      refresh_token: "refresh-token",
    });
  });

  it("stores the rotated refresh token when Google returns one", async () => {
    fetchWithTimeoutMock.mockResolvedValue(
      tokenResponse({
        access_token: REFRESHED_ACCESS,
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
      }),
    );

    const result = await refreshGeminiCliOAuthCredential(createCredential());

    expect(result.refresh).toBe("rotated-refresh-token");
    expect(result.access).toBe(REFRESHED_ACCESS);
  });

  it("throws Google's error when the refresh token is rejected", async () => {
    fetchWithTimeoutMock.mockResolvedValue(
      tokenResponse(
        {
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        },
        400,
      ),
    );

    await expect(refreshGeminiCliOAuthCredential(createCredential())).rejects.toThrow(
      /Token refresh failed.*invalid_grant/,
    );
  });
});
