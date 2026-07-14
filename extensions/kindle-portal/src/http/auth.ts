/**
 * Auth gate for the Kindle Portal HTTP routes.
 *
 * Model:
 *   - **Loopback** (127.0.0.1 / ::1 / ::ffff:127.0.0.1) is *always* allowed,
 *     regardless of token configuration. The gateway listens on the local
 *     machine, so same-origin requests never need a secret.
 *   - **Non-loopback** (LAN/remote) requests require `?token=<accessToken>`
 *     when `accessToken` is configured. If `accessToken` is unset, the plugin
 *     runs LAN-open (suitable for trusted home networks) — every non-loopback
 *     request is permitted.
 *
 * Token comparison uses a constant-time compare to avoid timing oracles on
 * the shared secret.
 */
import type { IncomingMessage } from "node:http";

export interface AuthorizeOptions {
  /** Shared secret. When unset, non-loopback requests are rejected. */
  readonly accessToken?: string;
  /** Always `true`. Loopback is unconditionally trusted; kept for intent. */
  readonly loopbackAllowed: true;
}

export type AuthorizeRejectCode = "forbidden" | "missing-token" | "token-mismatch";

export interface AuthorizeResult {
  readonly ok: boolean;
  readonly code?: AuthorizeRejectCode;
}

/**
 * Recognize loopback remote addresses across IPv4 / IPv6 / IPv4-mapped-IPv6.
 * Node surfaces IPv4-mapped addresses as `::ffff:127.0.0.1`.
 */
export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) {
    return false;
  }
  return (
    remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1"
  );
}

/**
 * Decide whether `req` may proceed.
 *
 * Order of checks:
 *   1. loopback → ok
 *   2. no `accessToken` configured → non-loopback is forbidden
 *   3. `?token=` absent or empty → missing-token
 *   4. mismatch → token-mismatch
 */
export function authorize(req: IncomingMessage, opts: AuthorizeOptions): AuthorizeResult {
  // 1. Loopback always allowed.
  const remote = req.socket?.remoteAddress;
  if (isLoopbackAddress(remote)) {
    return { ok: true };
  }

  // 2. No secret configured: LAN-open mode (trusted home network).
  //    Every non-loopback request is permitted without a token.
  if (!opts.accessToken) {
    return { ok: true };
  }

  // 3. Token configured: require ?token= query parameter.
  const url = new URL(req.url ?? "/", "http://localhost");
  const provided = url.searchParams.get("token");
  if (!provided) {
    return { ok: false, code: "missing-token" };
  }

  // 4. Constant-time compare.
  if (!safeEqualSecret(provided, opts.accessToken)) {
    return { ok: false, code: "token-mismatch" };
  }
  return { ok: true };
}

/**
 * Constant-time string comparison to mitigate timing attacks on the secret.
 * Returns `false` immediately on length mismatch (length is not secret here:
 * the attacker-controlled `a` may be any length, and we never leak the
 * configured length beyond what a length check already reveals).
 */
export function safeEqualSecret(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
