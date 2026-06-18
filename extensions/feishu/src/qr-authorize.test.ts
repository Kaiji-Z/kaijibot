import { afterEach, describe, expect, it, vi } from "vitest";

// --- Mocks -------------------------------------------------------------

/**
 * Mock `lark.registerApp` so tests never hit the real Feishu API. The mock
 * captures the options passed in so we can assert on the call shape, and lets
 * each test drive the outcome (resolve / reject) explicitly.
 */
const registerAppMock = vi.hoisted(() => vi.fn());
vi.mock("@larksuiteoapi/node-sdk", () => ({
  registerApp: registerAppMock,
}));

/**
 * Mock `qrcode-terminal`. The default export is an object with a `generate`
 * method that (in the real module) renders ASCII via a callback. We stub it so
 * tests can assert the QR payload was forwarded.
 */
const qrGenerateMock = vi.hoisted(() =>
  vi.fn((_data: string, _opts: unknown, cb?: (s: string) => void) => {
    if (typeof cb === "function") {
      cb("[qr-ascii]");
    }
  }),
);
vi.mock("qrcode-terminal", () => ({
  default: { generate: qrGenerateMock },
}));

import { registerFeishuAppViaQr, QR_AUTH_TIMEOUT_MS, type QrAuthResult } from "./qr-authorize.js";

// --- Helpers ------------------------------------------------------------

/** A structured SDK-style rejection: `{ code, description }`. */
function sdkError(code: string, description: string): { code: string; description: string } {
  return { code, description };
}

/** Capture calls to onStatus. */

/** Read the onQRCodeReady callback that was passed to registerApp. */
function lastQrCallback(): (info: { url: string; expireIn: number }) => void {
  const last = registerAppMock.mock.calls.at(-1);
  if (!last) {
    throw new Error("registerApp was not called");
  }
  const opts = last[0] as { onQRCodeReady: (info: { url: string; expireIn: number }) => void };
  return opts.onQRCodeReady;
}

// --- Lifecycle ----------------------------------------------------------

afterEach(() => {
  registerAppMock.mockReset();
  qrGenerateMock.mockReset();
  qrGenerateMock.mockImplementation((_data: string, _opts: unknown, cb?: (s: string) => void) => {
    if (typeof cb === "function") {
      cb("[qr-ascii]");
    }
  });
  vi.useRealTimers();
});

// --- Tests --------------------------------------------------------------

describe("registerFeishuAppViaQr", () => {
  describe("registerApp call shape", () => {
    it("calls lark.registerApp with source=kaijibot and appPreset.name containing KaijiBot", async () => {
      registerAppMock.mockResolvedValue({ client_id: "cli_1", client_secret: "s1" });
      await registerFeishuAppViaQr();

      expect(registerAppMock).toHaveBeenCalledTimes(1);
      const opts = registerAppMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(opts.source).toBe("kaijibot");
      const preset = opts.appPreset as { name?: string; desc?: string };
      expect(typeof preset.name).toBe("string");
      expect(preset.name).toContain("KaijiBot");
      // onQRCodeReady is always provided.
      expect(typeof opts.onQRCodeReady).toBe("function");
      // A signal is always provided so the 9-minute guard is enforced.
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    });

    it("forwards caller onStatus to the SDK onStatusChange", async () => {
      registerAppMock.mockResolvedValue({ client_id: "cli_1", client_secret: "s1" });
      const onStatus = vi.fn();
      await registerFeishuAppViaQr({ onStatus });

      const opts = registerAppMock.mock.calls[0]![0] as {
        onStatusChange?: (info: { status: string; interval?: number }) => void;
      };
      expect(typeof opts.onStatusChange).toBe("function");
      // Drive a status change and confirm it flows to the caller.
      opts.onStatusChange!({ status: "polling" });
      expect(onStatus).toHaveBeenCalledWith("polling");
    });
  });

  describe("success", () => {
    it("returns ok with appId/appSecret mapped from client_id/client_secret", async () => {
      registerAppMock.mockResolvedValue({
        client_id: "cli_AAA",
        client_secret: "secretBBB",
        user_info: { open_id: "ou_who", tenant_brand: "feishu" },
      });

      const result = await registerFeishuAppViaQr();

      const expected: QrAuthResult = {
        ok: true,
        appId: "cli_AAA",
        appSecret: "secretBBB",
        openId: "ou_who",
      };
      expect(result).toEqual(expected);
    });

    it("returns ok without openId when user_info is absent", async () => {
      registerAppMock.mockResolvedValue({ client_id: "cli_X", client_secret: "sY" });
      const result = await registerFeishuAppViaQr();
      expect(result).toEqual({ ok: true, appId: "cli_X", appSecret: "sY" });
    });
  });

  describe("onQRCodeReady", () => {
    it("renders the QR url via qrcode-terminal and prints the url as fallback text", async () => {
      // Keep registerApp pending so the call shape is captured but we only
      // care about the QR callback side-effect here.
      registerAppMock.mockReturnValue(new Promise(() => {}));
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Suppress unhandled rejection from the never-resolving promise when the
      // test tears down: catch it by racing against a quick tick.
      const pending = registerFeishuAppViaQr();
      // Allow microtasks to flush so registerApp (and thus onQRCodeReady) runs.
      await Promise.resolve();

      const qrCb = lastQrCallback();
      qrCb({ url: "https://example.com/qr", expireIn: 600 });

      expect(qrGenerateMock).toHaveBeenCalledWith(
        "https://example.com/qr",
        { small: true },
        expect.any(Function),
      );
      // The URL should also be printed as a text fallback.
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("https://example.com/qr"));

      logSpy.mockRestore();
      // Avoid unhandledRejection: swallow the pending promise.
      pending.catch(() => {});
    });
  });

  describe("error mapping", () => {
    it("maps access_denied to an access_denied error result", async () => {
      registerAppMock.mockRejectedValue(sdkError("access_denied", "User said no"));
      const result = await registerFeishuAppViaQr();
      expect(result).toEqual({
        ok: false,
        error: { code: "access_denied", message: "User said no" },
      });
    });

    it("maps expired_token to an expired_token error result", async () => {
      registerAppMock.mockRejectedValue(sdkError("expired_token", "timed out"));
      const result = await registerFeishuAppViaQr();
      expect(result).toEqual({
        ok: false,
        error: { code: "expired_token", message: "timed out" },
      });
    });

    it("maps abort to an abort error result", async () => {
      registerAppMock.mockRejectedValue(sdkError("abort", "Registration was aborted"));
      const result = await registerFeishuAppViaQr();
      expect(result).toEqual({
        ok: false,
        error: { code: "abort", message: "Registration was aborted" },
      });
    });

    it("maps an unknown SDK error code to the unknown bucket, preserving description", async () => {
      registerAppMock.mockRejectedValue(sdkError("server_error", "something broke"));
      const result = await registerFeishuAppViaQr();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("unknown");
        expect(result.error.message).toBe("something broke");
      }
    });

    it("maps an unknown SDK error code without description to a code-bearing message", async () => {
      registerAppMock.mockRejectedValue(sdkError("server_error", ""));
      const result = await registerFeishuAppViaQr();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("unknown");
        expect(result.error.message).toContain("server_error");
      }
    });

    it("maps a generic Error (network) to the network code", async () => {
      registerAppMock.mockRejectedValue(new Error("connect ETIMEDOUT"));
      const result = await registerFeishuAppViaQr();
      expect(result).toEqual({
        ok: false,
        error: { code: "network", message: "connect ETIMEDOUT" },
      });
    });
  });

  describe("timeout guard", () => {
    it("uses a 9-minute (540_000ms) default timeout", () => {
      expect(QR_AUTH_TIMEOUT_MS).toBe(9 * 60 * 1000);
    });

    it("aborts after the 9-minute timeout when no signal is provided", async () => {
      vi.useFakeTimers();
      // registerApp rejects with abort once the signal aborts.
      registerAppMock.mockImplementation(
        (opts: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            opts.signal.addEventListener("abort", () =>
              reject(sdkError("abort", "Registration was aborted")),
            );
          }),
      );

      const p = registerFeishuAppViaQr();
      // Not yet aborted.
      vi.advanceTimersByTime(9 * 60 * 1000 - 1);
      // Resolve pending microtasks; should still be pending.
      const settledEarly = await Promise.race([
        p.then(
          () => true,
          () => true,
        ),
        Promise.resolve(false),
      ]);
      expect(settledEarly).toBe(false);

      vi.advanceTimersByTime(1);
      const result = await p;
      expect(result).toEqual({
        ok: false,
        error: { code: "abort", message: "Registration was aborted" },
      });
    });

    it("respects a caller-provided signal and aborts when it fires", async () => {
      registerAppMock.mockImplementation(
        (opts: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            opts.signal.addEventListener("abort", () =>
              reject(sdkError("abort", "Registration was aborted")),
            );
          }),
      );

      const controller = new AbortController();
      const p = registerFeishuAppViaQr({ signal: controller.signal });
      controller.abort();

      const result = await p;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("abort");
      }
    });

    it("rejects immediately when the caller signal is already aborted", async () => {
      registerAppMock.mockImplementation(
        (opts: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            if (opts.signal.aborted) {
              reject(sdkError("abort", "Registration was aborted"));
            }
          }),
      );

      const controller = new AbortController();
      controller.abort();
      const result = await registerFeishuAppViaQr({ signal: controller.signal });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("abort");
      }
    });
  });
});
