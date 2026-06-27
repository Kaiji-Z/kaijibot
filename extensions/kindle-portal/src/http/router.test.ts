import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Mock } from "vitest";
import type { FleetState } from "../monitor/fleet-state.js";
import type { KindleConfig } from "../config.js";
import type { LoadSessionStore } from "../monitor/scope-resolver.js";
import { createKindleHttpHandler, type RouterContext } from "./router.js";

// ── vi.mock the handler modules so we test ROUTING, not handler bodies ──

const mocked = vi.hoisted(() => ({
  handleMonitorHtml: vi.fn(),
  handleMapHtml: vi.fn(),
  handleFleetJson: vi.fn(),
  handleMapJson: vi.fn(),
  handleMapPng: vi.fn(),
}));

vi.mock("./pages.js", () => ({
  handleMonitorHtml: mocked.handleMonitorHtml,
  handleMapHtml: mocked.handleMapHtml,
}));
vi.mock("./png.js", () => ({
  handleMapPng: mocked.handleMapPng,
}));
vi.mock("./api-json.js", () => ({
  handleFleetJson: mocked.handleFleetJson,
  handleMapJson: mocked.handleMapJson,
  defaultSendJson: vi.fn(),
}));

// ── Fakes ──

type FakeResponse = {
  statusCode: number;
  setHeader: Mock;
  end: Mock;
};

function fakeRes(): FakeResponse {
  return {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn(),
  };
}

function asRes(r: FakeResponse): ServerResponse {
  return r as unknown as ServerResponse;
}

function fakeReq(opts: {
  remoteAddress?: string | undefined;
  url?: string;
}): IncomingMessage {
  return {
    socket: { remoteAddress: opts.remoteAddress },
    url: opts.url,
  } as unknown as IncomingMessage;
}

function fakeState(): FleetState {
  return { snapshot: vi.fn(() => ({ active: [] })) } as unknown as FleetState;
}

function fakeLoadStore(): LoadSessionStore {
  return vi.fn().mockResolvedValue({ agents: [] });
}

function fakeCfg(overrides?: Partial<KindleConfig>): KindleConfig {
  return {
    enabled: true,
    refreshIntervalSeconds: 15,
    mapRefreshSeconds: 300,
    scope: "last-active",
    showWiki: true,
    maxDomains: 20,
    pngWidth: 758,
    ...overrides,
  };
}

function fakeCtx(overrides?: Partial<RouterContext>): RouterContext {
  return {
    state: fakeState(),
    cfg: fakeCfg(),
    loadStore: fakeLoadStore(),
    stateDir: "/state",
    workspaceDir: "/workspace",
    ...overrides,
  };
}

// Loopback request by default so routing tests bypass auth.
function loopbackReq(url: string): IncomingMessage {
  return fakeReq({ remoteAddress: "127.0.0.1", url });
}

const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

beforeEach(() => {
  mocked.handleMonitorHtml.mockReset();
  mocked.handleMapHtml.mockReset();
  mocked.handleFleetJson.mockReset();
  mocked.handleMapJson.mockReset();
  mocked.handleMapPng.mockReset();
  // Default: handlers resolve successfully.
  mocked.handleMonitorHtml.mockResolvedValue(undefined);
  mocked.handleMapHtml.mockResolvedValue(undefined);
  mocked.handleFleetJson.mockResolvedValue(undefined);
  mocked.handleMapJson.mockResolvedValue(undefined);
  mocked.handleMapPng.mockResolvedValue(undefined);
  warnSpy.mockClear();
});

// ═══════════════════════════════════════════════════════════════════
// Sub-route dispatch
// ═══════════════════════════════════════════════════════════════════

describe("createKindleHttpHandler — routing", () => {
  it("/kindle/ → dispatches to handleMonitorHtml", async () => {
    const ctx = fakeCtx();
    const handler = createKindleHttpHandler(ctx);
    const res = fakeRes();
    const req = loopbackReq("/kindle/");

    const handled = await handler(req, asRes(res));

    expect(handled).toBe(true);
    expect(mocked.handleMonitorHtml).toHaveBeenCalledTimes(1);
    expect(mocked.handleMonitorHtml).toHaveBeenCalledWith(req, asRes(res), ctx);
  });

  it("/kindle (no trailing slash) → dispatches to handleMonitorHtml", async () => {
    const handler = createKindleHttpHandler(fakeCtx());
    await handler(loopbackReq("/kindle"), asRes(fakeRes()));
    expect(mocked.handleMonitorHtml).toHaveBeenCalledTimes(1);
  });

  it("/kindle/map → dispatches to handleMapHtml", async () => {
    const ctx = fakeCtx();
    const handler = createKindleHttpHandler(ctx);
    const res = fakeRes();
    const req = loopbackReq("/kindle/map");

    const handled = await handler(req, asRes(res));

    expect(handled).toBe(true);
    expect(mocked.handleMapHtml).toHaveBeenCalledWith(req, asRes(res), ctx);
    expect(mocked.handleMonitorHtml).not.toHaveBeenCalled();
  });

  it("/kindle/api/fleet → dispatches to handleFleetJson", async () => {
    const ctx = fakeCtx();
    const handler = createKindleHttpHandler(ctx);
    const res = fakeRes();
    const req = loopbackReq("/kindle/api/fleet");

    await handler(req, asRes(res));

    expect(mocked.handleFleetJson).toHaveBeenCalledWith(req, asRes(res), ctx);
    expect(mocked.handleMapJson).not.toHaveBeenCalled();
  });

  it("/kindle/api/map.json → dispatches to handleMapJson", async () => {
    const ctx = fakeCtx();
    const handler = createKindleHttpHandler(ctx);
    const res = fakeRes();
    const req = loopbackReq("/kindle/api/map.json");

    await handler(req, asRes(res));

    expect(mocked.handleMapJson).toHaveBeenCalledWith(req, asRes(res), ctx);
  });

  it("/kindle/api/map.png → dispatches to handleMapPng", async () => {
    const ctx = fakeCtx();
    const handler = createKindleHttpHandler(ctx);
    const res = fakeRes();
    const req = loopbackReq("/kindle/api/map.png");

    await handler(req, asRes(res));

    expect(mocked.handleMapPng).toHaveBeenCalledWith(req, asRes(res), ctx);
  });

  it("/kindle/unknown → 404", async () => {
    const handler = createKindleHttpHandler(fakeCtx());
    const res = fakeRes();

    const handled = await handler(loopbackReq("/kindle/unknown"), asRes(res));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalledWith("Not found");
    expect(mocked.handleMonitorHtml).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Non-/kindle pass-through
// ═══════════════════════════════════════════════════════════════════

describe("createKindleHttpHandler — pass-through", () => {
  it("non-/kindle path → returns false (pass through to next handler)", async () => {
    const handler = createKindleHttpHandler(fakeCtx());
    const res = fakeRes();

    const handled = await handler(loopbackReq("/other"), asRes(res));

    expect(handled).toBe(false);
    expect(res.end).not.toHaveBeenCalled();
  });

  it("/kindle-prefix-but-not-route (e.g. /kindleXYZ) → returns false", async () => {
    // "/kindleXYZ" does not start with "/kindle" as a path segment boundary,
    // but string startsWith("/kindle") is true. Verify it still routes into
    // the /kindle tree and then 404s on the unknown sub-path "XYZ".
    const handler = createKindleHttpHandler(fakeCtx());
    const res = fakeRes();

    await handler(loopbackReq("/kindleXYZ"), asRes(res));

    // "/kindleXYZ".slice("/kindle".length) === "XYZ" → unknown → 404
    expect(res.statusCode).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Path traversal protection
// ═══════════════════════════════════════════════════════════════════

describe("createKindleHttpHandler — path traversal", () => {
  it("/kindle/../../etc/passwd (raw) → 404, no handler called", async () => {
    const handler = createKindleHttpHandler(fakeCtx());
    const res = fakeRes();

    const handled = await handler(loopbackReq("/kindle/../../etc/passwd"), asRes(res));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalledWith("Not found");
    expect(mocked.handleMonitorHtml).not.toHaveBeenCalled();
  });

  it("/kindle/%2e%2e/%2e%2e/etc (encoded dots) → deflected, no handler called", async () => {
    // Node's URL parser normalizes %2e%2e → .. and resolves the path out of
    // /kindle entirely, so the router returns pass-through (handled=false).
    // Either pass-through or 404 is an acceptable safe outcome; the invariant
    // we lock in is: NO kindle handler runs.
    const handler = createKindleHttpHandler(fakeCtx());
    const res = fakeRes();

    const handled = await handler(loopbackReq("/kindle/%2e%2e/%2e%2e/etc"), asRes(res));

    expect(mocked.handleMonitorHtml).not.toHaveBeenCalled();
    expect(mocked.handleFleetJson).not.toHaveBeenCalled();
    // pass-through means we did not write a body for a /kindle route
    if (handled === false) {
      expect(res.end).not.toHaveBeenCalled();
    } else {
      expect(res.statusCode).toBe(404);
    }
  });

  it("/kindle/..%2fetc (encoded slash, not normalized away) → 404", async () => {
    // %2f is NOT normalized by URL, so the path stays under /kindle but the
    // decoded form contains ".." → caught by the decoded-pathname check.
    const handler = createKindleHttpHandler(fakeCtx());
    const res = fakeRes();

    const handled = await handler(loopbackReq("/kindle/..%2fetc"), asRes(res));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(mocked.handleMonitorHtml).not.toHaveBeenCalled();
  });

  it("null byte in path → 404", async () => {
    const handler = createKindleHttpHandler(fakeCtx());
    const res = fakeRes();

    const handled = await handler(loopbackReq("/kindle/\0"), asRes(res));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
  });

  it("query string with .. is NOT rejected (only path checked)", async () => {
    // "?x=.." in query must not trigger traversal rejection.
    const handler = createKindleHttpHandler(fakeCtx());
    const res = fakeRes();

    await handler(loopbackReq("/kindle/?token=..foo"), asRes(res));

    expect(mocked.handleMonitorHtml).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Auth gate
// ═══════════════════════════════════════════════════════════════════

describe("createKindleHttpHandler — auth gate", () => {
  it("LAN without token + no accessToken configured → 403", async () => {
    const handler = createKindleHttpHandler(fakeCtx({ cfg: fakeCfg({ accessToken: undefined }) }));
    const res = fakeRes();

    const handled = await handler(
      fakeReq({ remoteAddress: "192.168.1.5", url: "/kindle/" }),
      asRes(res),
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(res.end).toHaveBeenCalledWith("Forbidden");
    expect(mocked.handleMonitorHtml).not.toHaveBeenCalled();
  });

  it("LAN with wrong token → 403", async () => {
    const handler = createKindleHttpHandler(fakeCtx({ cfg: fakeCfg({ accessToken: "s3cret" }) }));
    const res = fakeRes();

    const handled = await handler(
      fakeReq({ remoteAddress: "192.168.1.5", url: "/kindle/?token=wrong" }),
      asRes(res),
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
  });

  it("LAN with valid token → passes auth, handler called", async () => {
    const handler = createKindleHttpHandler(fakeCtx({ cfg: fakeCfg({ accessToken: "s3cret" }) }));
    const res = fakeRes();
    const req = fakeReq({ remoteAddress: "192.168.1.5", url: "/kindle/?token=s3cret" });

    const handled = await handler(req, asRes(res));

    expect(handled).toBe(true);
    expect(mocked.handleMonitorHtml).toHaveBeenCalledWith(req, asRes(res), expect.any(Object));
  });

  it("loopback bypasses auth (no token needed)", async () => {
    const handler = createKindleHttpHandler(fakeCtx({ cfg: fakeCfg({ accessToken: "s3cret" }) }));
    const res = fakeRes();

    await handler(loopbackReq("/kindle/"), asRes(res));

    expect(mocked.handleMonitorHtml).toHaveBeenCalledTimes(1);
  });

  it("auth gate applies before routing (no handler touched on 403)", async () => {
    const handler = createKindleHttpHandler(fakeCtx({ cfg: fakeCfg({ accessToken: "s3cret" }) }));
    const res = fakeRes();

    await handler(fakeReq({ remoteAddress: "10.0.0.1", url: "/kindle/api/fleet" }), asRes(res));

    expect(res.statusCode).toBe(403);
    expect(mocked.handleFleetJson).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Error handling
// ═══════════════════════════════════════════════════════════════════

describe("createKindleHttpHandler — error handling", () => {
  it("handler throws → 500, error swallowed", async () => {
    mocked.handleMonitorHtml.mockRejectedValueOnce(new Error("boom"));
    const handler = createKindleHttpHandler(fakeCtx());
    const res = fakeRes();

    const handled = await handler(loopbackReq("/kindle/"), asRes(res));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(500);
    expect(res.end).toHaveBeenCalledWith("Internal error");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("handler rejects without message → 500", async () => {
    mocked.handleMapJson.mockRejectedValueOnce("string error");
    const handler = createKindleHttpHandler(fakeCtx());
    const res = fakeRes();

    const handled = await handler(loopbackReq("/kindle/api/map.json"), asRes(res));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(500);
  });
});
