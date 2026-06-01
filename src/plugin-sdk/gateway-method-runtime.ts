// Gateway method dispatch surface for authenticated plugin request scopes.
// KaijiBot uses handleGatewayRequest from server-methods instead of
// the upstream dispatchGatewayMethodInProcessRaw from server-plugins.

import { handleGatewayRequest } from "../gateway/server-methods.js";
import { getPluginRuntimeGatewayRequestScope } from "../plugins/runtime/gateway-request-scope.js";

export type GatewayMethodDispatchError = {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
};

export type GatewayMethodDispatchResponse = {
  ok: boolean;
  payload?: unknown;
  error?: GatewayMethodDispatchError;
  meta?: Record<string, unknown>;
};

export type GatewayMethodDispatchOptions = {
  expectFinal?: boolean;
  timeoutMs?: number;
};

/**
 * Dispatch a Gateway control-plane method from an authenticated plugin request scope.
 */
export async function dispatchGatewayMethod(
  method: string,
  params?: unknown,
  options?: GatewayMethodDispatchOptions,
): Promise<GatewayMethodDispatchResponse> {
  const scope = getPluginRuntimeGatewayRequestScope();
  if (!scope?.context) {
    const pluginLabel = scope?.pluginId ? ` for plugin "${scope.pluginId}"` : "";
    throw new Error(
      `Gateway method dispatch requires a plugin gateway request scope with context${pluginLabel}.`,
    );
  }
  let result: { ok: boolean; payload?: unknown; error?: { code: string; message: string } } | undefined;
  await handleGatewayRequest({
    req: {
      type: "req",
      id: `plugin-gw-${method}`,
      method,
      params: params ?? {},
    },
    client: scope.client!,
    isWebchatConnect: scope.isWebchatConnect ?? (() => false),
    respond: (ok, payload, error) => {
      if (!result) {
        result = { ok, payload, error };
      }
    },
    context: scope.context!,
  });
  if (!result) {
    return { ok: false, error: { code: "no_response", message: `Gateway method "${method}" completed without a response.` } };
  }
  return {
    ok: result.ok,
    payload: result.payload,
    error: result.error
      ? { code: result.error.code ?? "unknown", message: result.error.message ?? "Unknown error" }
      : undefined,
  };
}
