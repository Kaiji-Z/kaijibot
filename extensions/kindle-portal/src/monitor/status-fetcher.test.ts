import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGatewayStatus, resetStatusCache, type GatewayStatus } from "./status-fetcher.js";

const DEFAULT_URL = "http://127.0.0.1:18789/api/status";

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response;
}

function badResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as Response;
}

const sampleStatus = {
  version: "1.0",
  uptime: 100,
  agents: [],
  usage: null,
  providers: [],
  cognitive: null,
} as const;

describe("fetchGatewayStatus", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStatusCache();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed status on 200", async () => {
    fetchMock.mockResolvedValue(okResponse(sampleStatus));

    const result = await fetchGatewayStatus();

    expect(result).not.toBeNull();
    expect(result).toEqual(sampleStatus);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(DEFAULT_URL, expect.any(Object));
  });

  it("returns null on non-200", async () => {
    fetchMock.mockResolvedValue(badResponse(401));

    const result = await fetchGatewayStatus();

    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const result = await fetchGatewayStatus();

    expect(result).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => {
        throw new Error("bad json");
      },
    } as unknown as Response);

    const result = await fetchGatewayStatus();

    expect(result).toBeNull();
  });

  it("uses cache on second call", async () => {
    fetchMock.mockResolvedValue(okResponse(sampleStatus));

    await fetchGatewayStatus();
    await fetchGatewayStatus();

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("resetStatusCache clears cache", async () => {
    fetchMock.mockResolvedValue(okResponse(sampleStatus));

    await fetchGatewayStatus();
    resetStatusCache();
    await fetchGatewayStatus();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("GatewayStatus type surface", () => {
  it("accepts a well-formed status object", () => {
    const status: GatewayStatus = {
      version: "2026.6.29",
      uptime: 12345,
      agents: [{ id: "main", model: "zai/glm-5.2", default: true }],
      usage: {
        today: { totalTokens: 100, totalCost: 0.5 },
        month: { totalTokens: 5000, totalCost: 12.34 },
      },
      providers: [],
      cognitive: { domains: 5, insights: 3, corrections: 2, skills: 1 },
    };
    expect(status.version).toBe("2026.6.29");
    expect(status.agents[0]?.id).toBe("main");
  });
});
