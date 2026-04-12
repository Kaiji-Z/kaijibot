import type { KaijiBotConfig } from "../config/config.js";
import type { TtsMode } from "../config/types.tts.js";
export { normalizeTtsAutoMode } from "./tts-auto-mode.js";

export function resolveConfiguredTtsMode(cfg: KaijiBotConfig): TtsMode {
  return cfg.messages?.tts?.mode ?? "final";
}
