import * as lark from "@larksuiteoapi/node-sdk";
import qrcode from "qrcode-terminal";

/**
 * QR-based Feishu app auto-registration.
 *
 * Wraps `lark.registerApp()` (OAuth 2.0 Device Authorization Grant, RFC 8628)
 * so a user can create a Feishu bot app by scanning a QR code instead of the
 * 7-step manual console flow. Renders the verification URL as a terminal QR
 * and maps the SDK's structured rejections to a closed `QrAuthErrorCode`
 * union so callers can branch on known failure modes.
 */

// --- Types ---------------------------------------------------------------

/** Closed union of known QR-registration failure codes. */
export type QrAuthErrorCode = "access_denied" | "expired_token" | "abort" | "network" | "unknown";

export type QrAuthError = { code: QrAuthErrorCode; message: string };

/**
 * Discriminated result. On success the Feishu `client_id` / `client_secret`
 * are surfaced as `appId` / `appSecret`; `openId` is present when the SDK
 * returns the scanning user's info.
 */
export type QrAuthResult =
  | { ok: true; appId: string; appSecret: string; openId?: string }
  | { ok: false; error: QrAuthError };

export interface RegisterViaQrOptions {
  /** Caller-supplied abort signal. Aborting maps to the `abort` error code. */
  signal?: AbortSignal;
  /** Optional sink for SDK status changes (polling / slow_down / domain_switched). */
  onStatus?: (status: string) => void;
}

// --- Constants -----------------------------------------------------------

/**
 * Default guard timeout. Feishu's server expires the device code at 10 minutes
 * (600s); we abort at 9 minutes (540s) so we always surface a clean `abort`
 * before the SDK would surface an opaque `expired_token`.
 */
export const QR_AUTH_TIMEOUT_MS = 9 * 60 * 1000;

/** Source identifier embedded in the QR URL `from` param for analytics. */
const SOURCE = "kaijibot";

// --- Internal helpers ----------------------------------------------------

/**
 * Combine an (optional) external signal with a timeout into a single signal.
 * The combined signal aborts if EITHER source fires. Returns a cleanup fn that
 * must be called to release the timeout + listener, preventing leaks.
 */
function combineSignalWithTimeout(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const forward = (): void => controller.abort();
  if (external) {
    if (external.aborted) {
      // Already aborted: fire synchronously (after timer is set so cleanup works).
      forward();
    } else {
      external.addEventListener("abort", forward, { once: true });
    }
  }

  const cleanup = (): void => {
    clearTimeout(timer);
    if (external) {
      external.removeEventListener("abort", forward);
    }
  };
  return { signal: controller.signal, cleanup };
}

/**
 * Map a `lark.registerApp()` rejection to a {@link QrAuthError}.
 *
 * The SDK rejects with either:
 *  - a structured plain object `{ code, description }` for protocol errors
 *    (access_denied / expired_token / abort / unknown server codes), or
 *  - a thrown `Error` (e.g. axios/network failures) re-rejected as-is.
 */
function mapRegisterError(err: unknown): QrAuthError {
  if (typeof err === "object" && err !== null && "code" in err) {
    const raw = (err as { code: unknown }).code;
    const code = typeof raw === "string" ? raw : String(raw ?? "");
    const desc = (err as { description?: unknown }).description;
    const message =
      typeof desc === "string" && desc.length > 0 ? desc : `Feishu registration failed (${code})`;
    if (code === "access_denied" || code === "expired_token" || code === "abort") {
      return { code, message };
    }
    return { code: "unknown", message };
  }
  if (err instanceof Error && err.message) {
    return { code: "network", message: err.message };
  }
  return { code: "unknown", message: "Feishu registration failed for an unknown reason" };
}

/**
 * Render the verification URL as an ASCII QR code and also print the URL as a
 * text fallback (useful when the terminal cannot display glyphs or for
 * screen-reader users).
 */
function renderQr(url: string): void {
  qrcode.generate(url, { small: true }, (ascii: string) => {
    console.log(ascii);
  });
  console.log(url);
}

// --- Public API ----------------------------------------------------------

/**
 * Register a Feishu bot app via QR scan.
 *
 * Renders the verification URL as a terminal QR, polls Feishu until the user
 * authorizes (or the 9-minute guard fires), and returns the resulting app
 * credentials mapped to {@link QrAuthResult}.
 *
 * @example
 * const result = await registerFeishuAppViaQr();
 * if (result.ok) {
 *   await config.set("channels.feishu.appId", result.appId);
 *   await config.set("channels.feishu.appSecret", result.appSecret);
 * } else {
 *   console.error(result.error.code, result.error.message);
 * }
 */
export async function registerFeishuAppViaQr(
  options?: RegisterViaQrOptions,
): Promise<QrAuthResult> {
  const { signal: combinedSignal, cleanup } = combineSignalWithTimeout(
    QR_AUTH_TIMEOUT_MS,
    options?.signal,
  );

  try {
    const result = await lark.registerApp({
      source: SOURCE,
      appPreset: {
        name: "KaijiBot",
        desc: "KaijiBot AI 助手",
      },
      onQRCodeReady: (info) => {
        renderQr(info.url);
      },
      onStatusChange: options?.onStatus ? (info) => options.onStatus!(info.status) : undefined,
      signal: combinedSignal,
    });

    return {
      ok: true,
      appId: result.client_id,
      appSecret: result.client_secret,
      ...(result.user_info?.open_id ? { openId: result.user_info.open_id } : {}),
    };
  } catch (err) {
    return { ok: false, error: mapRegisterError(err) };
  } finally {
    cleanup();
  }
}
