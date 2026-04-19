import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import type { ProviderWrapStreamFnContext } from "kaijibot/plugin-sdk/plugin-entry";
import {
  composeProviderStreamWrappers,
  createToolStreamWrapper,
} from "kaijibot/plugin-sdk/provider-stream-shared";

const MAX_SESSION_ID_LENGTH = 256;

function isInjectableSessionId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_SESSION_ID_LENGTH) return false;
  return value.trim().length > 0;
}

export function createZaiSessionIdHeaderWrapper(baseStreamFn: StreamFn | undefined): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    const sessionId = (options as { sessionId?: unknown } | undefined)?.sessionId;
    if (!isInjectableSessionId(sessionId)) {
      return underlying(model, context, options);
    }
    return underlying(model, context, {
      ...options,
      headers: {
        ...options?.headers,
        "X-Session-Id": sessionId,
      },
    });
  };
}

export function wrapZaiProviderStream(ctx: ProviderWrapStreamFnContext): StreamFn | undefined {
  const toolStreamEnabled = ctx.extraParams?.tool_stream !== false;
  return composeProviderStreamWrappers(ctx.streamFn, (streamFn) => {
    const toolStreamWrapped = createToolStreamWrapper(streamFn, toolStreamEnabled);
    return createZaiSessionIdHeaderWrapper(toolStreamWrapped);
  });
}
