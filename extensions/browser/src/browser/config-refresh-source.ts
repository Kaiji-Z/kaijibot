import { createConfigIO, getRuntimeConfigSnapshot, type KaijiBotConfig } from "../config/config.js";

export function loadBrowserConfigForRuntimeRefresh(): KaijiBotConfig {
  return getRuntimeConfigSnapshot() ?? createConfigIO().loadConfig();
}
