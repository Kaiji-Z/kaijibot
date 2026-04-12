import type { KaijiBotConfig } from "kaijibot/plugin-sdk/browser-config-runtime";
import {
  normalizePluginsConfig,
  resolveEffectiveEnableState,
} from "kaijibot/plugin-sdk/browser-config-runtime";

export function isDefaultBrowserPluginEnabled(cfg: KaijiBotConfig): boolean {
  return resolveEffectiveEnableState({
    id: "browser",
    origin: "bundled",
    config: normalizePluginsConfig(cfg.plugins),
    rootConfig: cfg,
    enabledByDefault: true,
  }).enabled;
}
