/**
 * Unified userId resolution for the correction pipeline.
 * Both Path A (agent tool) and Path B (post-session extraction) must
 * agree with the read path (sessionCtx.SenderId) to avoid orphaned records.
 */

/**
 * Resolve a userId from session key and/or delivery target.
 * Priority:
 *  1. deliveryTo — strip user:/feishu: prefix, validate not "main"
 *  2. sessionKey tail — must be a valid ou_xxx open_id
 *  3. sessionKey parts[1] fallback
 */
export function resolveCorrectionUserId(
  sessionKey?: string,
  deliveryTo?: string,
): string | null {
  // 1. Try deliveryTo with prefix stripping
  if (deliveryTo) {
    const stripped = deliveryTo.replace(/^(user:|feishu:)/, "");
    if (stripped && stripped !== "main") {
      return stripped;
    }
  }

  if (!sessionKey) {return null;}

  const parts = sessionKey.split(":");

  // 2. Try tail — must look like ou_xxx (feishu open_id)
  const tail = parts[parts.length - 1];
  if (tail && tail !== "main" && tail.startsWith("ou_")) {
    return tail;
  }

  // 3. Fallback: parts[1] for agent:ou_xxx:rest format
  if (
    parts.length >= 3 &&
    parts[1] &&
    parts[1] !== "main" &&
    parts[1]!.startsWith("ou_")
  ) {
    return parts[1];
  }

  return null;
}
