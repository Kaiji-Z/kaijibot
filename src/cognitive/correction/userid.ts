/**
 * Correction-pipeline userId resolution.
 *
 * Delegates to {@link resolveCognitiveUserId} for sessionKey-based resolution.
 * The deliveryTo parameter is kept for backward compatibility with agent tools
 * that pass the reply delivery target — it is stripped of channel prefixes and
 * used as a userId hint before falling back to sessionKey resolution.
 */

import { resolveCognitiveUserId, resolveOperatorSenderId } from "../identity.js";

export function resolveCorrectionUserId(sessionKey?: string, deliveryTo?: string): string | null {
  if (deliveryTo) {
    const stripped = deliveryTo.replace(/^(user:|feishu:|webchat:|wechat:)/, "");
    if (stripped && stripped !== "main") {
      return resolveOperatorSenderId(stripped) ?? stripped;
    }
  }
  return resolveCognitiveUserId(sessionKey);
}
