import type { KaijiBotConfig } from "./runtime-api.js";
import { inspectTelegramAccount } from "./src/account-inspect.js";

export function inspectTelegramReadOnlyAccount(cfg: KaijiBotConfig, accountId?: string | null) {
  return inspectTelegramAccount({ cfg, accountId });
}
