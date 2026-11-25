import { OPERATOR_USER_ID, resolveCognitiveUserId, resolveOperatorSenderId } from "../identity.js";

function resolveUserIdFromDeliveryTarget(deliveryTo?: string): string | undefined {
  if (!deliveryTo) {
    return undefined;
  }
  const stripped = deliveryTo.replace(/^(user:|feishu:|webchat:|wechat:)/, "");
  if (!stripped || stripped === "main") {
    return undefined;
  }
  return resolveOperatorSenderId(stripped) ?? stripped;
}

/**
 * Correction-pipeline userId resolution.
 *
 * The user named by the session key (DM peer or `:sender:` segment) wins: the delivery target
 * of a group or topic reply is the chat or thread id, not the person. A key that names no
 * user yields to the delivery target — under dmScope "main" every direct message shares
 * `agent:<id>:main`, so the target is the only thing that tells who is writing.
 */
export function resolveCorrectionUserId(sessionKey?: string, deliveryTo?: string): string | null {
  const fromDeliveryTarget = resolveUserIdFromDeliveryTarget(deliveryTo);
  const fromSessionKey = resolveCognitiveUserId(sessionKey);
  if (fromSessionKey && fromSessionKey !== OPERATOR_USER_ID) {
    return fromSessionKey;
  }
  return fromDeliveryTarget ?? fromSessionKey;
}
