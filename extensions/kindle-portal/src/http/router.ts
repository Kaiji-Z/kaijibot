/**
 * HTTP router for `/kindle/*`.
 *
 * Entry point produced by {@link createKindleHttpHandler}: a single function
 * matching the {@link KaijiBotPluginHttpRouteHandler} contract. It:
 *   1. Matches the `/kindle` path prefix; non-matching paths return `false`
 *      so the gateway can fall through to the next route.
 *   2. Rejects path-traversal attempts (`..`, NUL bytes) — both raw and
 *      percent-encoded forms, since `new URL()` silently normalizes raw `..`.
 *   3. Applies the auth gate (loopback bypass; `?token=` for LAN).
 *   4. Dispatches to the per-sub-path handler.
 *
 * `RouterContext` is structurally identical to {@link ApiHandlerContext}
 * (same fields), so the two are interchangeable — handlers receive exactly
 * the context they were designed for in T10.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { authorize } from "./auth.js";
import {
  handleFleetJson,
  handleMapJson,
  handleCognitiveJson,
  type ApiHandlerContext,
} from "./api-json.js";
import { handleMonitorHtml, handleMapHtml } from "./pages.js";
import { handleMapPng } from "./png.js";
import { handleMapSvg } from "./svg.js";

export type RouterContext = ApiHandlerContext;

const KINDLE_PREFIX = "/kindle";
const NOT_FOUND_BODY = "Not found";
const FORBIDDEN_BODY = "Forbidden";
const INTERNAL_ERROR_BODY = "Internal error";

/**
 * Build the HTTP handler bound to a given {@link RouterContext}.
 *
 * @returns A handler returning `true` when it consumed the request (the
 *          gateway stops walking routes), or `false` for non-`/kindle` paths
 *          so the next registered route gets a chance.
 */
export function createKindleHttpHandler(
  ctx: RouterContext,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async function handler(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const rawUrl = req.url ?? "/";

    // ── Path-traversal protection ──
    // Check the raw path *before* URL parsing: `new URL()` normalizes raw
    // `..` segments away (e.g. `/kindle/../../etc` → `/etc`), which would
    // otherwise bypass a post-parse-only check. Also re-check the decoded
    // pathname to catch percent-encoded traversal (`%2e%2e`).
    const rawPath = rawPathOnly(rawUrl);
    if (rawPath.includes("..") || rawPath.includes("\0")) {
      return notFound(res);
    }

    const url = new URL(rawUrl, "http://localhost");
    const pathname = url.pathname;

    // Not our route → pass through to the next handler.
    if (!pathname.startsWith(KINDLE_PREFIX)) {
      return false;
    }

    const decoded = safeDecode(pathname);
    if (decoded.includes("..") || decoded.includes("\0")) {
      return notFound(res);
    }

    // ── Auth gate ──
    const auth = authorize(req, {
      accessToken: ctx.cfg.accessToken,
      loopbackAllowed: true,
    });
    if (!auth.ok) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "text/plain");
      res.end(FORBIDDEN_BODY);
      return true;
    }

    // ── Sub-route dispatch ──
    const subPath = pathname.slice(KINDLE_PREFIX.length);

    try {
      if (subPath === "" || subPath === "/") {
        await handleMonitorHtml(req, res, ctx);
        return true;
      }
      if (subPath === "/map") {
        await handleMapHtml(req, res, ctx);
        return true;
      }
      if (subPath === "/api/fleet") {
        await handleFleetJson(req, res, ctx);
        return true;
      }
      if (subPath === "/api/map.json") {
        await handleMapJson(req, res, ctx);
        return true;
      }
      if (subPath === "/api/map.png") {
        await handleMapPng(req, res, ctx);
        return true;
      }
      if (subPath === "/api/map.svg") {
        await handleMapSvg(req, res, ctx);
        return true;
      }
      if (subPath === "/api/cognitive.json") {
        await handleCognitiveJson(req, res, ctx);
        return true;
      }
      return notFound(res);
    } catch (err) {
      console.warn("[kindle-portal] handler error:", String(err));
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain");
      res.end(INTERNAL_ERROR_BODY);
      return true;
    }
  };
}

// ── Root-path and short-path handlers (T2) ──
//
// Separate from createKindleHttpHandler because `/` and `/k` do not share
// the `/kindle` prefix. T4 wires each creator to its path.

/**
 * Kindle UA contains "Kindle" or "Linux armv" (ARM Linux = Kindle/e-ink).
 * The armv fallback covers non-Kindle-branded e-readers on the same engine.
 */
export function isKindleUserAgent(userAgent: string | undefined): boolean {
  if (!userAgent) {return false;}
  const ua = userAgent.toLowerCase();
  return ua.includes("kindle") || ua.includes("linux armv");
}

/**
 * `/`: Kindle UA → 302 to `/kindle/` (+ `?token=` when accessToken is set,
 * so the redirect lands inside the auth gate without a second round-trip).
 * Non-Kindle UA → returns `false` (pass-through to next registered handler).
 */
export function createRootRedirectHandler(ctx: RouterContext) {
  return async function handler(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    if (!isKindleUserAgent(req.headers["user-agent"])) {
      return false;
    }
    const tokenQuery = ctx.cfg.accessToken
      ? "?token=" + encodeURIComponent(ctx.cfg.accessToken)
      : "";
    res.statusCode = 302;
    res.setHeader("Location", "/kindle/" + tokenQuery);
    res.end();
    return true;
  };
}

/**
 * `/k`: serves the monitor HTML with the same auth gate as `/kindle/`
 * (loopback always allowed; `?token=` required on LAN when configured).
 */
export function createShortPathHandler(ctx: RouterContext) {
  return async function handler(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const auth = authorize(req, {
      accessToken: ctx.cfg.accessToken,
      loopbackAllowed: true,
    });
    if (!auth.ok) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "text/plain");
      res.end(FORBIDDEN_BODY);
      return true;
    }
    await handleMonitorHtml(req, res, ctx);
    return true;
  };
}

// ── Helpers ──

/** Strip the query string so `..` inside `?…` is not flagged as traversal. */
function rawPathOnly(rawUrl: string): string {
  const q = rawUrl.indexOf("?");
  return q === -1 ? rawUrl : rawUrl.slice(0, q);
}

/** `decodeURIComponent` that never throws on malformed input. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function notFound(res: ServerResponse): boolean {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain");
  res.end(NOT_FOUND_BODY);
  return true;
}
