import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import type { KaijiBotConfig } from "../config/types.kaijibot.js";
import { loadCostUsageSummary } from "../infra/session-cost-usage.js";
import { loadProviderUsageSummary } from "../infra/provider-usage.load.js";
import { VERSION } from "../version.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { isLocalDirectRequest } from "./auth.js";
import { sendJson, sendMethodNotAllowed } from "./http-common.js";
import { authorizeGatewayHttpRequestOrReply } from "./http-utils.js";
import { loadCognitiveStatsSummary } from "./server-methods/cognitive.js";

function isLanIp(ip: string): boolean {
  return (
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)
  );
}

function detectLanIp(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.family === "IPv4" && !a.internal && isLanIp(a.address)) {
        return a.address;
      }
    }
  }
  return null;
}

/**
 * HTTP handler for `GET /api/status`. Returns a lightweight aggregate snapshot
 * of the gateway: version, uptime, configured agents, provider usage, cost
 * usage, and cognitive stats. Each data source is independently fault-tolerant
 * — a failure in one section degrades to `null` rather than failing the entire
 * response.
 *
 * Local loopback requests bypass token auth. Remote requests require a valid
 * gateway bearer token (or shared secret) via {@link authorizeGatewayHttpRequestOrReply}.
 *
 * Config and data-source modules are loaded lazily inside the handler to keep
 * the module's static import graph lightweight.
 */
export async function handleStatusHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/status") {
    return false;
  }
  if (req.method !== "GET") {
    sendMethodNotAllowed(res, "GET");
    return true;
  }

  // Lazy-load config — the config module graph is heavy. Load it here so this
  // module stays cheap to import even when /api/status is never hit.
  let cfg: KaijiBotConfig | null = null;
  try {
    const { loadConfig } = await import("../config/config.js");
    cfg = loadConfig();
  } catch {
    // Config unavailable — degrade to empty agents / no proxy fallbacks.
  }

  const trustedProxies = opts.trustedProxies ?? cfg?.gateway?.trustedProxies;
  const allowRealIpFallback = opts.allowRealIpFallback ?? cfg?.gateway?.allowRealIpFallback;

  // Local loopback requests bypass token auth; remote requests must present
  // valid gateway credentials. authorizeGatewayHttpRequestOrReply already
  // sends the 401/429 response on failure, so we only need to bail out.
  if (!isLocalDirectRequest(req, trustedProxies, allowRealIpFallback)) {
    const requestAuth = await authorizeGatewayHttpRequestOrReply({
      req,
      res,
      auth: opts.auth,
      trustedProxies,
      allowRealIpFallback,
      rateLimiter: opts.rateLimiter,
    });
    if (!requestAuth) {
      return true;
    }
  }

  // Aggregate all data sources in parallel. Each source is individually
  // wrapped so a single failure degrades gracefully to null instead of
  // taking down the entire status response.
  const [providers, usage, cognitive] = await Promise.all([
    loadProviderUsageSummary({ timeoutMs: 3000 }).catch(() => null),
    loadCostUsageSummary({ days: 30 }).catch(() => null),
    (async () => {
      try {
        const { resolveConfigDir } = await import("../utils.js");
        return await loadCognitiveStatsSummary(resolveConfigDir());
      } catch {
        return null;
      }
    })(),
  ]);

  const agents = (cfg?.agents?.list ?? []).map((entry) => ({
    id: entry.id,
    model: typeof entry.model === "string" ? entry.model : entry.model?.primary,
    default: Boolean(entry.default),
  }));

  const todayStr = new Date().toISOString().substring(0, 10);
  const todayEntry = usage?.daily?.find((d) => d.date === todayStr) ?? null;

  const lanIp = detectLanIp();
  const port = cfg?.gateway?.port ?? 18789;

  sendJson(res, 200, {
    version: VERSION,
    uptime: Math.floor(process.uptime()),
    lanIp,
    port,
    agents,
    usage: usage
      ? {
          today: todayEntry
            ? { totalTokens: todayEntry.totalTokens, totalCost: todayEntry.totalCost }
            : null,
          month: usage.totals
            ? { totalTokens: usage.totals.totalTokens, totalCost: usage.totals.totalCost }
            : null,
        }
      : null,
    providers: providers?.providers ?? null,
    cognitive,
  });

  return true;
}
