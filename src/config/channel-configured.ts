import { getBootstrapChannelPlugin } from "../channels/plugins/bootstrap-registry.js";
import { hasBundledChannelConfiguredState } from "../channels/plugins/configured-state.js";
import { hasBundledChannelPersistedAuthState } from "../channels/plugins/persisted-auth-state.js";
import {
  hasMeaningfulChannelConfigShallow,
  resolveChannelConfigRecord,
} from "./channel-configured-shared.js";
import type { KaijiBotConfig } from "./config.js";

export function isChannelConfigured(
  cfg: KaijiBotConfig,
  channelId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (hasBundledChannelConfiguredState({ channelId, cfg, env })) {
    return true;
  }
  const pluginPersistedAuthState = hasBundledChannelPersistedAuthState({ channelId, cfg, env });
  if (pluginPersistedAuthState) {
    return true;
  }
  if (hasMeaningfulChannelConfigShallow(resolveChannelConfigRecord(cfg, channelId))) {
    return true;
  }
  const plugin = getBootstrapChannelPlugin(channelId);
  return Boolean(plugin?.config?.hasConfiguredState?.({ cfg, env }));
}
