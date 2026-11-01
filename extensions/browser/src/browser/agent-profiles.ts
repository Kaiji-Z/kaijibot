/**
 * Per-agent persistent browser profiles for the login-proxy capability
 * (browser.proxy.enabled).
 *
 * Naming convention: an agent's dedicated profile is `agent-<sanitized-id>`.
 * The profile is a normal `browser.profiles` entry with an allocated CDP
 * port; its user-data-dir (`CONFIG_DIR/browser/<name>/user-data` via
 * resolveKaijiBotUserDataDir) persists across restarts, which is what keeps
 * manually established logins alive between sessions.
 */
import type { BrowserConfig, BrowserProfileConfig, KaijiBotConfig } from "../config/config.js";
import { loadConfig, writeConfigFile } from "../config/config.js";
import { resolveBrowserConfig, type ResolvedBrowserConfig } from "./config.js";
import {
  allocateCdpPort,
  allocateColor,
  getUsedColors,
  getUsedPorts,
  isValidProfileName,
} from "./profiles.js";

/** Prefix that keeps agent profiles clear of the reserved defaults ("kaijibot", "user"). */
const AGENT_PROFILE_PREFIX = "agent-";
/** Keeps `agent-<slug>` under the 64-char profile-name cap with margin. */
const MAX_AGENT_SLUG_CHARS = 48;

export function agentBrowserProfileName(agentId: string): string {
  const slug = agentId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_AGENT_SLUG_CHARS)
    .replace(/-+$/g, "");
  const name = `${AGENT_PROFILE_PREFIX}${slug || "default"}`;
  // The prefix guarantees regex validity, but assert for safety.
  return isValidProfileName(name) ? name : `${AGENT_PROFILE_PREFIX}default`;
}

/** Read-only: the agent's persistent profile name when it already exists in config. */
export function findAgentBrowserProfile(cfg: KaijiBotConfig, agentId: string): string | null {
  const name = agentBrowserProfileName(agentId);
  return cfg.browser?.profiles?.[name] ? name : null;
}

export type EnsureAgentProfileResult = {
  profile: string;
  created: boolean;
};

export type EnsureAgentProfileDeps = {
  loadConfig?: () => KaijiBotConfig;
  writeConfigFile?: (cfg: KaijiBotConfig) => Promise<void>;
  resolveBrowserConfig?: (
    browser: BrowserConfig | undefined,
    rootConfig: KaijiBotConfig,
  ) => ResolvedBrowserConfig;
};

/**
 * Ensure the agent's persistent profile exists, creating it (config write with
 * an allocated CDP port + color) when missing. Route contexts pick the new
 * entry up via request-time hot reload (resolveBrowserProfileWithHotReload).
 */
export async function ensureAgentBrowserProfile(
  agentId: string,
  deps: EnsureAgentProfileDeps = {},
): Promise<EnsureAgentProfileResult> {
  const load = deps.loadConfig ?? loadConfig;
  const write = deps.writeConfigFile ?? writeConfigFile;
  const resolve = deps.resolveBrowserConfig ?? resolveBrowserConfig;
  const name = agentBrowserProfileName(agentId);

  const cfg = load();
  if (cfg.browser?.profiles?.[name]) {
    return { profile: name, created: false };
  }

  const resolved = resolve(cfg.browser, cfg);
  const cdpPort = allocateCdpPort(getUsedPorts(resolved.profiles), {
    start: resolved.cdpPortRangeStart,
    end: resolved.cdpPortRangeEnd,
  });
  if (cdpPort === null) {
    throw new Error("no available CDP port in range for the agent browser profile");
  }
  const color = allocateColor(getUsedColors(resolved.profiles));
  const profileConfig: BrowserProfileConfig = { cdpPort, color };

  await write({
    ...cfg,
    browser: {
      ...cfg.browser,
      profiles: {
        ...cfg.browser?.profiles,
        [name]: profileConfig,
      },
    },
  });
  return { profile: name, created: true };
}
