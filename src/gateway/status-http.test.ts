import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ----------------------------------------------------------------

vi.mock("../version.js", () => ({
  VERSION: "2026.6.28-9",
}));

const isLocalDirectRequestMock = vi.fn();

vi.mock("./auth.js", () => ({
  isLocalDirectRequest: isLocalDirectRequestMock,
}));

const authorizeGatewayHttpRequestOrReplyMock = vi.fn();

vi.mock("./http-utils.js", () => ({
  authorizeGatewayHttpRequestOrReply: authorizeGatewayHttpRequestOrReplyMock,
}));

const sendJsonMock = vi.fn();
const sendMethodNotAllowedMock = vi.fn();

vi.mock("./http-common.js", () => ({
  sendJson: sendJsonMock,
  sendMethodNotAllowed: sendMethodNotAllowedMock,
}));

const loadProviderUsageSummaryMock = vi.fn();

vi.mock("../infra/provider-usage.load.js", () => ({
  loadProviderUsageSummary: loadProviderUsageSummaryMock,
}));

const loadCostUsageSummaryMock = vi.fn();

vi.mock("../infra/session-cost-usage.js", () => ({
  loadCostUsageSummary: loadCostUsageSummaryMock,
}));

const loadCognitiveStatsSummaryMock = vi.fn();

vi.mock("./server-methods/cognitive.js", () => ({
  loadCognitiveStatsSummary: loadCognitiveStatsSummaryMock,
}));

// RED phase: the handler module does not exist yet, so this dynamic import
// will fail and cause every test in this file to fail on import.
const { handleStatusHttpRequest } = await import("./status-http.js");

// --- Helpers --------------------------------------------------------------

const TEST_TOKEN = "test-token";

type MockReqInit = {
  method?: string;
  url?: string;
  remoteAddress?: string;
  headers?: Record<string, string>;
};

function makeReq(init: MockReqInit = {}): IncomingMessage {
  const req = {
    method: init.method ?? "GET",
    url: init.url ?? "/api/status",
    headers: init.headers ?? {},
    socket: { remoteAddress: init.remoteAddress ?? "127.0.0.1" },
  };
  return req as unknown as IncomingMessage;
}

function makeRes(): ServerResponse {
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
    writableEnded: false,
  };
  return res as unknown as ServerResponse;
}

function opts() {
  return {
    auth: { token: TEST_TOKEN } as unknown as Parameters<
      typeof handleStatusHttpRequest
    >[2]["auth"],
  };
}

/** Pull the body object passed to `sendJson(res, status, body)`. */
function sentBody(): Record<string, unknown> {
  const call = sendJsonMock.mock.calls[0];
  return (call?.[2] as Record<string, unknown>) ?? {};
}

// --- Test lifecycle -------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: localhost direct request, no rate limiter issues.
  isLocalDirectRequestMock.mockReturnValue(true);
  authorizeGatewayHttpRequestOrReplyMock.mockResolvedValue({
    authMethod: "token",
    trustDeclaredOperatorScopes: false,
  });
  loadProviderUsageSummaryMock.mockResolvedValue({ providers: [] });
  loadCostUsageSummaryMock.mockResolvedValue({
    totals: { totalTokens: 100, totalCost: 0.01 },
    daily: [],
  });
  loadCognitiveStatsSummaryMock.mockResolvedValue({
    enabled: true,
    domains: 5,
    insights: 12,
    skills: 3,
  });
});

// --- Tests ----------------------------------------------------------------

describe("handleStatusHttpRequest", () => {
  it("returns false for non-matching path", async () => {
    const req = makeReq({ url: "/other" });
    const res = makeRes();
    const handled = await handleStatusHttpRequest(req, res, opts());
    expect(handled).toBe(false);
    expect(sendJsonMock).not.toHaveBeenCalled();
  });

  it("returns 405 for POST", async () => {
    const req = makeReq({ method: "POST", url: "/api/status" });
    const res = makeRes();
    const handled = await handleStatusHttpRequest(req, res, opts());
    expect(handled).toBe(true);
    expect(sendMethodNotAllowedMock).toHaveBeenCalledWith(res, "GET");
  });

  it("returns 200 without token on localhost and aggregates all sections", async () => {
    isLocalDirectRequestMock.mockReturnValue(true);
    const req = makeReq({ url: "/api/status", remoteAddress: "127.0.0.1" });
    const res = makeRes();
    const handled = await handleStatusHttpRequest(req, res, opts());
    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(res, 200, expect.any(Object));
    const body = sentBody();
    expect(body["providers"]).toEqual([] as unknown);
    expect(body["usage"]).toEqual(
      expect.objectContaining({
        today: expect.any(Object),
        month: expect.any(Object),
      }),
    );
    expect(body["cognitive"]).toEqual({
      enabled: true,
      domains: 5,
      insights: 12,
      skills: 3,
    } as unknown);
  });

  it("returns 200 with a valid bearer token on remote requests", async () => {
    isLocalDirectRequestMock.mockReturnValue(false);
    authorizeGatewayHttpRequestOrReplyMock.mockResolvedValue({
      authMethod: "token",
      trustDeclaredOperatorScopes: false,
    });
    const req = makeReq({
      url: "/api/status",
      remoteAddress: "203.0.113.10",
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    const res = makeRes();
    const handled = await handleStatusHttpRequest(req, res, opts());
    expect(handled).toBe(true);
    expect(authorizeGatewayHttpRequestOrReplyMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(res, 200, expect.any(Object));
  });

  it("returns true (401 already sent) when remote and no token", async () => {
    isLocalDirectRequestMock.mockReturnValue(false);
    authorizeGatewayHttpRequestOrReplyMock.mockResolvedValue(null);
    const req = makeReq({
      url: "/api/status",
      remoteAddress: "203.0.113.10",
    });
    const res = makeRes();
    const handled = await handleStatusHttpRequest(req, res, opts());
    expect(handled).toBe(true);
    expect(sendJsonMock).not.toHaveBeenCalled();
  });

  it("still returns 200 with providers: null when loadProviderUsageSummary rejects", async () => {
    loadProviderUsageSummaryMock.mockRejectedValue(new Error("boom"));
    const req = makeReq({ url: "/api/status" });
    const res = makeRes();
    const handled = await handleStatusHttpRequest(req, res, opts());
    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(res, 200, expect.any(Object));
    expect(sentBody()["providers"]).toBeNull();
  });

  it("still returns 200 with usage: null when loadCostUsageSummary rejects", async () => {
    loadCostUsageSummaryMock.mockRejectedValue(new Error("boom"));
    const req = makeReq({ url: "/api/status" });
    const res = makeRes();
    const handled = await handleStatusHttpRequest(req, res, opts());
    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(res, 200, expect.any(Object));
    expect(sentBody()["usage"]).toBeNull();
  });

  it("still returns 200 with cognitive: null when loadCognitiveStatsSummary rejects", async () => {
    loadCognitiveStatsSummaryMock.mockRejectedValue(new Error("boom"));
    const req = makeReq({ url: "/api/status" });
    const res = makeRes();
    const handled = await handleStatusHttpRequest(req, res, opts());
    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(res, 200, expect.any(Object));
    expect(sentBody()["cognitive"]).toBeNull();
  });

  it("response body shape contains version, uptime, agents, usage, providers, cognitive", async () => {
    const req = makeReq({ url: "/api/status" });
    const res = makeRes();
    await handleStatusHttpRequest(req, res, opts());
    expect(sendJsonMock).toHaveBeenCalledTimes(1);
    const body = sentBody();
    for (const key of [
      "version",
      "uptime",
      "agents",
      "usage",
      "providers",
      "cognitive",
    ] as const) {
      expect(body).toHaveProperty(key);
    }
  });
});
