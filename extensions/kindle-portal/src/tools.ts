/**
 * Agent tools for Kindle Portal configuration.
 *
 * `kindle_setup`  — enables the plugin + switches the gateway bind from
 *   loopback to LAN so the Kindle can reach `/kindle/`. Polls the gateway
 *   until the `/kindle/api/fleet` endpoint responds, then returns the URL.
 *   The user just says "帮我接上 Kindle" and the agent calls this tool.
 *
 * `kindle_status` — reports whether the portal is enabled, the bind mode,
 *   the detected LAN IP, and whether the route is currently reachable.
 *
 * Both tools read/write `~/.kaijibot/kaijibot.json` directly (not injected)
 * because they need fresh values and must survive config hot-reloads.
 */

import { readFile, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { homedir, networkInterfaces } from "node:os";
import path from "node:path";
import type { AnyAgentTool } from "kaijibot/plugin-sdk/core";
import { Type } from "typebox";

// ── Constants ────────────────────────────────────────────────────────────

const GATEWAY_PORT = 18789;
const GATEWAY_PROBE_URL = `http://127.0.0.1:${GATEWAY_PORT}/kindle/api/fleet`;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_TIMEOUT_MS = 30_000;

// Empty parameter schemas — both tools take no arguments.
const EMPTY_SCHEMA = Type.Object({}, { additionalProperties: false });

// ── Dependency interfaces ────────────────────────────────────────────────

export interface KindleSetupDeps {
  /** Optional logger for diagnostics. */
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
  /** Override the gateway poll interval (ms). Defaults to 2000. */
  pollIntervalMs?: number;
  /** Override the gateway poll timeout (ms). Defaults to 30000. */
  pollTimeoutMs?: number;
}

export interface KindleStatusDeps {
  /** Optional logger for diagnostics. */
  logger?: { info?: (m: string) => void; warn?: (m: string) => void };
}

// ── LAN IP detection ─────────────────────────────────────────────────────

/**
 * Returns true if `ip` is a private LAN IPv4 address
 * (RFC 1918: 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12).
 */
function isLanIp(ip: string): boolean {
  if (ip.startsWith("192.168.")) {
    return true;
  }
  if (ip.startsWith("10.")) {
    return true;
  }
  const m = ip.match(/^172\.(\d+)\./);
  if (m) {
    const octet = Number(m[1]);
    if (octet >= 16 && octet <= 31) {
      return true;
    }
  }
  return false;
}

/**
 * Scan all network interfaces and return the first non-internal LAN IPv4
 * address. Returns null if none found.
 */
export function detectLanIp(): string | null {
  const interfaces = networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) {
      continue;
    }
    for (const a of addrs) {
      if (a.family === "IPv4" && !a.internal && isLanIp(a.address)) {
        return a.address;
      }
    }
  }
  return null;
}

// ── Config file I/O ──────────────────────────────────────────────────────

function configPath(): string {
  return path.join(homedir(), ".kaijibot", "kaijibot.json");
}

async function readConfig(): Promise<Record<string, unknown>> {
  const raw = await readFile(configPath(), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function writeConfig(config: Record<string, unknown>): Promise<void> {
  const content = JSON.stringify(config, null, 2);
  await writeFile(configPath(), content, "utf8");
}

// ── Nested config helpers ────────────────────────────────────────────────

/** Read a dot-nested path from a plain object, returning undefined on miss. */
function getPath(obj: Record<string, unknown>, keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Set a dot-nested path, creating intermediate objects as needed. */
function setPath(obj: Record<string, unknown>, keys: string[], value: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const next = cur[k];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

// ── Gateway readiness probe ─────────────────────────────────────────────

/**
 * Return true if the gateway's `/kindle/api/fleet` endpoint responds 200.
 * Never throws — any error resolves false.
 */
function probeGateway(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (v: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const req = httpGet(GATEWAY_PROBE_URL, (res) => {
        res.resume();
        res.on("end", () => settle(res.statusCode === 200));
        res.on("error", () => settle(false));
      });
      req.on("error", () => settle(false));
      // Guard against the probe hanging forever.
      req.setTimeout(3_000, () => {
        req.destroy();
        settle(false);
      });
    } catch {
      settle(false);
    }
  });
}

/**
 * Poll the gateway until it responds 200 or the timeout elapses.
 */
async function waitForGateway(opts: {
  pollIntervalMs: number;
  pollTimeoutMs: number;
}): Promise<boolean> {
  const deadline = Date.now() + opts.pollTimeoutMs;
  while (Date.now() < deadline) {
    if (await probeGateway()) {
      return true;
    }
    await new Promise<void>((r) => setTimeout(r, opts.pollIntervalMs));
  }
  return false;
}

// ── Tool: kindle_setup ───────────────────────────────────────────────────

/**
 * Factory for the `kindle_setup` agent tool.
 *
 * Enables Kindle Portal in config, switches the gateway to LAN bind if
 * currently loopback/unset, waits for the gateway to become ready, and
 * returns the URL for the user.
 */
export function createKindleSetupTool(deps: KindleSetupDeps = {}): AnyAgentTool {
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const pollTimeoutMs = deps.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;

  return {
    name: "kindle_setup",
    label: "Kindle Setup",
    description:
      "Enable the Kindle Portal plugin and open the gateway to LAN access, then return the URL to open on the Kindle browser. Call this when the user wants to connect or set up their Kindle dashboard. No parameters needed.",
    parameters: EMPTY_SCHEMA,

    execute: async () => {
      try {
        // 1. Detect LAN IP.
        const lanIp = detectLanIp();
        if (!lanIp) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: No LAN IP address detected. Make sure this machine is connected to a local network (192.168.*, 10.*, or 172.16-31.*).",
              },
            ],
            details: { error: "no-lan-ip" as const },
          };
        }

        // 2. Read current config.
        const config = await readConfig();

        // 3. Modify: enable plugin + widen bind if loopback/unset.
        setPath(config, ["plugins", "entries", "kindle-portal", "enabled"], true);

        const currentBind = getPath(config, ["gateway", "bind"]);
        const bindChanged = currentBind === "loopback" || currentBind === undefined;
        if (bindChanged) {
          setPath(config, ["gateway", "bind"], "lan");
        }

        // 4. Write config (chokidar watcher picks up the change → gateway restart).
        await writeConfig(config);
        deps.logger?.info?.(
          `[kindle-portal] config written: enabled=true, bind=${bindChanged ? `lan (was ${String(currentBind)})` : String(currentBind)}`,
        );

        // 5. Poll for gateway readiness.
        const ready = await waitForGateway({ pollIntervalMs, pollTimeoutMs });
        if (!ready) {
          deps.logger?.warn?.("[kindle-portal] gateway did not become ready within timeout");
        }

        // 6. Return result.
        const url = `http://${lanIp}:${GATEWAY_PORT}/kindle/`;
        const note = ready
          ? ""
          : "\n\n网关正在重启中，如果一分钟后仍无法打开，请手动运行 `pnpm gw:deploy`。";
        return {
          content: [
            {
              type: "text" as const,
              text: `Kindle Portal 已开启。在 Kindle 浏览器输入：${url}${note}`,
            },
          ],
          details: { url, lanIp, bindChanged, ready },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error setting up Kindle Portal: ${String(err)}`,
            },
          ],
          details: { error: "exception" as const },
        };
      }
    },
  };
}

// ── Tool: kindle_status ──────────────────────────────────────────────────

/**
 * Factory for the `kindle_status` agent tool.
 *
 * Reports the current state of Kindle Portal: enabled flag, bind mode,
 * detected LAN IP, URL, and whether `/kindle/api/fleet` is reachable.
 */
export function createKindleStatusTool(deps: KindleStatusDeps = {}): AnyAgentTool {
  return {
    name: "kindle_status",
    label: "Kindle Status",
    description:
      "Check whether the Kindle Portal is enabled, the gateway bind mode, the detected LAN IP, and whether the /kindle/ route is currently reachable. Returns the portal URL.",
    parameters: EMPTY_SCHEMA,

    execute: async () => {
      try {
        const config = await readConfig();
        const enabled =
          getPath(config, ["plugins", "entries", "kindle-portal", "enabled"]) === true;
        const rawBind = getPath(config, ["gateway", "bind"]);
        const bind = typeof rawBind === "string" ? rawBind : "loopback";
        const lanIp = detectLanIp();
        const reachable = await probeGateway();
        const url = lanIp ? `http://${lanIp}:${GATEWAY_PORT}/kindle/` : null;

        deps.logger?.info?.(
          `[kindle-portal] status: enabled=${enabled}, bind=${bind}, reachable=${reachable}`,
        );

        const lines = [
          `Kindle Portal: ${enabled ? "enabled" : "disabled"}`,
          `Gateway bind: ${bind}`,
          `LAN IP: ${lanIp ?? "not detected"}`,
          `URL: ${url ?? "unavailable (no LAN IP)"}`,
          `Reachable: ${reachable ? "yes" : "no"}`,
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: { enabled, url, bind, reachable, lanIp },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error checking Kindle Portal status: ${String(err)}`,
            },
          ],
          details: { error: "exception" as const },
        };
      }
    },
  };
}
