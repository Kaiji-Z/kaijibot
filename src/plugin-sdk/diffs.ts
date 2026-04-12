// Narrow plugin-sdk surface for the bundled diffs plugin.
// Keep this list additive and scoped to the bundled diffs surface.

export { definePluginEntry } from "./plugin-entry.js";
export type { KaijiBotConfig } from "../config/config.js";
export { resolvePreferredKaijiBotTmpDir } from "../infra/tmp-kaijibot-dir.js";
export type {
  AnyAgentTool,
  KaijiBotPluginApi,
  KaijiBotPluginConfigSchema,
  KaijiBotPluginToolContext,
  PluginLogger,
} from "../plugins/types.js";
