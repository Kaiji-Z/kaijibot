import { getRuntimeConfigSnapshot, type KaijiBotConfig } from "../../config/config.js";

export function resolveSkillRuntimeConfig(config?: KaijiBotConfig): KaijiBotConfig | undefined {
  return getRuntimeConfigSnapshot() ?? config;
}
