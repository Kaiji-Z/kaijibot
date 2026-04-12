import { resolveActiveTalkProviderConfig } from "../../config/talk.js";
import type { KaijiBotConfig } from "../../config/types.js";

export { resolveActiveTalkProviderConfig };

export function getRuntimeConfigSnapshot(): KaijiBotConfig | null {
  return null;
}
