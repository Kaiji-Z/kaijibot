import { describe, it, expect } from "vitest";
import type { IncomingMessage } from "node:http";
import {
  authorize,
  isLoopbackAddress,
  safeEqualSecret,
  type AuthorizeOptions,
} from "./auth.js";

// ── Helpers ──

/** Build a minimal IncomingMessage with controllable socket + url. */
function fakeReq(opts: {
  remoteAddress?: string | undefined;
  url?: string;
}): IncomingMessage {
  return {
    socket: { remoteAddress: opts.remoteAddress },
    url: opts.url ?? "/",
  } as unknown as IncomingMessage;
}

const LOOPBACK_OPTS: AuthorizeOptions = { loopbackAllowed: true };
const TOKEN_OPTS = (accessToken: string): AuthorizeOptions => ({
  accessToken,
  loopbackAllowed: true,
});

// ═══════════════════════════════════════════════════════════════════
// isLoopbackAddress
// ═══════════════════════════════════════════════════════════════════

describe("isLoopbackAddress", () => {
  it("127.0.0.1 → true", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
  });

  it("::1 → true", () => {
    expect(isLoopbackAddress("::1")).toBe(true);
  });

  it("::ffff:127.0.0.1 (IPv4-mapped) → true", () => {
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("undefined → false", () => {
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  it("empty string → false", () => {
    expect(isLoopbackAddress("")).toBe(false);
  });

  it("random LAN IP 192.168.1.5 → false", () => {
    expect(isLoopbackAddress("192.168.1.5")).toBe(false);
  });

  it("10.0.0.1 → false", () => {
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
  });

  it("172.16.0.1 → false", () => {
    expect(isLoopbackAddress("172.16.0.1")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// safeEqualSecret (constant-time compare)
// ═══════════════════════════════════════════════════════════════════

describe("safeEqualSecret", () => {
  it("equal strings → true", () => {
    expect(safeEqualSecret("s3cret", "s3cret")).toBe(true);
  });

  it("different strings same length → false", () => {
    expect(safeEqualSecret("s3cret", "s3creX")).toBe(false);
  });

  it("different lengths → false (no throw)", () => {
    expect(() => safeEqualSecret("short", "much-longer-value")).not.toThrow();
    expect(safeEqualSecret("short", "much-longer-value")).toBe(false);
  });

  it("empty strings → true", () => {
    expect(safeEqualSecret("", "")).toBe(true);
  });

  it("one empty, one not → false", () => {
    expect(safeEqualSecret("", "x")).toBe(false);
    expect(safeEqualSecret("x", "")).toBe(false);
  });

  it("unicode equal → true", () => {
    expect(safeEqualSecret("秘密", "秘密")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// authorize
// ═══════════════════════════════════════════════════════════════════

describe("authorize", () => {
  describe("loopback bypass", () => {
    it("127.0.0.1 always allowed (no token, no accessToken configured)", () => {
      const res = authorize(fakeReq({ remoteAddress: "127.0.0.1" }), LOOPBACK_OPTS);
      expect(res).toEqual({ ok: true });
    });

    it("::1 always allowed", () => {
      const res = authorize(fakeReq({ remoteAddress: "::1" }), LOOPBACK_OPTS);
      expect(res).toEqual({ ok: true });
    });

    it("::ffff:127.0.0.1 (IPv4-mapped) always allowed", () => {
      const res = authorize(
        fakeReq({ remoteAddress: "::ffff:127.0.0.1" }),
        LOOPBACK_OPTS,
      );
      expect(res).toEqual({ ok: true });
    });

    it("loopback bypasses even when accessToken is configured (token not required)", () => {
      const res = authorize(
        fakeReq({ remoteAddress: "127.0.0.1" }),
        TOKEN_OPTS("s3cret"),
      );
      expect(res).toEqual({ ok: true });
    });
  });

  describe("LAN without accessToken configured", () => {
    it("LAN no token + no accessToken → LAN-open (ok)", () => {
      const res = authorize(
        fakeReq({ remoteAddress: "192.168.1.5", url: "/kindle/" }),
        LOOPBACK_OPTS,
      );
      expect(res.ok).toBe(true);
    });
  });

  describe("LAN with accessToken configured", () => {
    it("LAN valid token matches → ok", () => {
      const res = authorize(
        fakeReq({ remoteAddress: "192.168.1.5", url: "/kindle/?token=s3cret" }),
        TOKEN_OPTS("s3cret"),
      );
      expect(res).toEqual({ ok: true });
    });

    it("LAN wrong token → token-mismatch", () => {
      const res = authorize(
        fakeReq({ remoteAddress: "192.168.1.5", url: "/kindle/?token=wrong" }),
        TOKEN_OPTS("s3cret"),
      );
      expect(res.ok).toBe(false);
      expect(res.code).toBe("token-mismatch");
    });

    it("LAN missing token when accessToken configured → missing-token", () => {
      const res = authorize(
        fakeReq({ remoteAddress: "192.168.1.5", url: "/kindle/" }),
        TOKEN_OPTS("s3cret"),
      );
      expect(res.ok).toBe(false);
      expect(res.code).toBe("missing-token");
    });

    it("LAN empty token param (?token=) → missing-token", () => {
      const res = authorize(
        fakeReq({ remoteAddress: "192.168.1.5", url: "/kindle/?token=" }),
        TOKEN_OPTS("s3cret"),
      );
      // searchParams.get returns "" for ?token=; empty is treated as not provided
      expect(res.ok).toBe(false);
      expect(res.code).toBe("missing-token");
    });

    it("token checked even with other query params present", () => {
      const res = authorize(
        fakeReq({
          remoteAddress: "10.0.0.1",
          url: "/kindle/api/fleet?foo=bar&token=s3cret&baz=1",
        }),
        TOKEN_OPTS("s3cret"),
      );
      expect(res).toEqual({ ok: true });
    });
  });

  describe("edge: missing socket / remoteAddress", () => {
    it("undefined remoteAddress + no accessToken → LAN-open (ok)", () => {
      const res = authorize(fakeReq({ remoteAddress: undefined }), LOOPBACK_OPTS);
      expect(res.ok).toBe(true);
    });

    it("undefined remoteAddress + accessToken configured + valid token → ok", () => {
      const res = authorize(
        fakeReq({ remoteAddress: undefined, url: "/?token=s3cret" }),
        TOKEN_OPTS("s3cret"),
      );
      expect(res).toEqual({ ok: true });
    });
  });
});
