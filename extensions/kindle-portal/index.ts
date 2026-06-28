import { definePluginEntry, type KaijiBotPluginApi } from "./api.js";
import { KINDLE_PORTAL_CONFIG_SCHEMA, resolveKindleConfigSafe } from "./src/config.js";
import { registerKindlePortalPlugin } from "./src/plugin.js";

/**
 * Kindle Portal — KaijiBot extension that serves two Kindle-friendly pages
 * over the gateway HTTP port (default :18789):
 *
 *   /kindle/          — Live agent state monitor (XHR polling, ES5 HTML)
 *   /kindle/map       — Cognitive map rendered as server-side PNG
 *   /kindle/api/fleet   — JSON snapshot of active agent runs
 *   /kindle/api/map.json — JSON graph of persona domains + wiki concepts
 *   /kindle/api/map.png  — 16-gray PNG of the cognitive map
 *
 * Auth: loopback (127.0.0.1 / ::1) is always allowed. Non-loopback requests
 * require `?token=<accessToken>` when `accessToken` is configured. If
 * `accessToken` is unset, the plugin is LAN-open (suitable for home networks).
 *
 * The plugin registers no routes when `enabled: false` (the default).
 * When enabled, wiring (HTTP routes + background service) is performed by
 * `registerKindlePortalPlugin` in `src/plugin.ts`.
 */
export default definePluginEntry({
  id: "kindle-portal",
  name: "Kindle Portal",
  description:
    "Kindle e-ink dashboard: live agent state monitor and cognitive map visualization. Served at /kindle/ on the gateway HTTP port for Kindle's experimental browser.",
  configSchema: KINDLE_PORTAL_CONFIG_SCHEMA,
  async register(api: KaijiBotPluginApi) {
    const cfg = resolveKindleConfigSafe(api.pluginConfig, (issues) => {
      api.logger.warn?.(
        `[kindle-portal] config validation failed: ${JSON.stringify(issues)}`,
      );
    });
    if (!cfg) {
      api.logger.warn?.("[kindle-portal] config invalid, plugin stays dormant.");
      return;
    }
    registerKindlePortalPlugin(api, cfg);
  },
});
