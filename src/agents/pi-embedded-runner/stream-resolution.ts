import type { StreamFn } from "@earendil-works/pi-agent-core";
import { getInitialSystemMessage } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { createAnthropicVertexStreamFnForModel } from "../anthropic-vertex-stream.js";
import { createOpenAIWebSocketStreamFn } from "../openai-ws-stream.js";
import { createBoundaryAwareStreamFnForModel } from "../provider-transport-stream.js";
import { stripSystemPromptCacheBoundary } from "../system-prompt-cache-boundary.js";
import type { EmbeddedRunAttemptParams } from "./run/types.js";

let embeddedAgentBaseStreamFnCache = new WeakMap<object, StreamFn | undefined>();

export function resolveEmbeddedAgentBaseStreamFn(params: {
  session: { agent: { streamFunction: StreamFn } };
}): StreamFn {
  if (embeddedAgentBaseStreamFnCache.has(params.session)) {
    return embeddedAgentBaseStreamFnCache.get(params.session) as StreamFn;
  }
  const baseStreamFn = params.session.agent.streamFunction;
  embeddedAgentBaseStreamFnCache.set(params.session, baseStreamFn);
  return baseStreamFn;
}

export function resetEmbeddedAgentBaseStreamFnCacheForTest(): void {
  embeddedAgentBaseStreamFnCache = new WeakMap<object, StreamFn | undefined>();
}

export function describeEmbeddedAgentStreamStrategy(params: {
  currentStreamFn: StreamFn | undefined;
  providerStreamFn?: StreamFn;
  shouldUseWebSocketTransport: boolean;
  wsApiKey?: string;
  model: EmbeddedRunAttemptParams["model"];
}): string {
  if (params.providerStreamFn) {
    return "provider";
  }
  if (params.shouldUseWebSocketTransport) {
    return params.wsApiKey ? "openai-websocket" : "session-http-fallback";
  }
  if (params.model.provider === "anthropic-vertex") {
    return "anthropic-vertex";
  }
  if (params.currentStreamFn === undefined || params.currentStreamFn === streamSimple) {
    return createBoundaryAwareStreamFnForModel(params.model)
      ? `boundary-aware:${params.model.api}`
      : "stream-simple";
  }
  return "session-custom";
}

export async function resolveEmbeddedAgentApiKey(params: {
  provider: string;
  resolvedApiKey?: string;
  authStorage?: { getApiKey(provider: string): Promise<string | undefined> };
}): Promise<string | undefined> {
  const resolvedApiKey = params.resolvedApiKey?.trim();
  if (resolvedApiKey) {
    return resolvedApiKey;
  }
  return params.authStorage ? await params.authStorage.getApiKey(params.provider) : undefined;
}

export function resolveEmbeddedAgentStreamFn(params: {
  currentStreamFn: StreamFn | undefined;
  providerStreamFn?: StreamFn;
  shouldUseWebSocketTransport: boolean;
  wsApiKey?: string;
  sessionId: string;
  signal?: AbortSignal;
  model: EmbeddedRunAttemptParams["model"];
  resolvedApiKey?: string;
  authStorage?: { getApiKey(provider: string): Promise<string | undefined> };
  /** True when currentStreamFn is the untouched session base (pi 1.6 base is no longer `streamSimple`). */
  sessionDefault?: boolean;
}): StreamFn {
  if (params.providerStreamFn) {
    const inner = params.providerStreamFn;
    // pi-ai 1.6 carries the system prompt as the transcript's leading system
    // message, so strip the cache boundary marker there instead of on a
    // context-level systemPrompt field.
    const normalizeContext = (context: Parameters<StreamFn>[1]) => {
      const messages = context.messages ?? [];
      const systemMessage = getInitialSystemMessage(messages);
      if (!systemMessage || typeof systemMessage.content !== "string") {
        return context;
      }
      const stripped = stripSystemPromptCacheBoundary(systemMessage.content);
      if (stripped === systemMessage.content) {
        return context;
      }
      const nextMessages = [{ ...systemMessage, content: stripped }, ...messages.slice(1)];
      return { messages: nextMessages } as Parameters<StreamFn>[1];
    };
    // Provider-owned transports bypass pi-coding-agent's default auth lookup,
    // so keep injecting the resolved runtime apiKey for streamSimple-compatible
    // transports that still read credentials from options.apiKey.
    if (params.authStorage || params.resolvedApiKey) {
      const { authStorage, model, resolvedApiKey } = params;
      return async (m, context, options) => {
        const apiKey = await resolveEmbeddedAgentApiKey({
          provider: model.provider,
          resolvedApiKey,
          authStorage,
        });
        return inner(m, normalizeContext(context), {
          ...options,
          apiKey: apiKey ?? options?.apiKey,
        });
      };
    }
    return (m, context, options) => inner(m, normalizeContext(context), options);
  }

  const currentStreamFn = params.currentStreamFn ?? streamSimple;
  if (params.shouldUseWebSocketTransport) {
    return params.wsApiKey
      ? createOpenAIWebSocketStreamFn(params.wsApiKey, params.sessionId, {
          signal: params.signal,
        })
      : currentStreamFn;
  }

  if (params.model.provider === "anthropic-vertex") {
    return createAnthropicVertexStreamFnForModel(params.model);
  }

  if (params.sessionDefault || params.currentStreamFn === undefined) {
    const boundaryAwareStreamFn = createBoundaryAwareStreamFnForModel(params.model);
    if (boundaryAwareStreamFn) {
      return boundaryAwareStreamFn;
    }
  }

  return currentStreamFn;
}
