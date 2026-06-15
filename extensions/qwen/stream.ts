import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { ProviderWrapStreamFnContext } from "kaijibot/plugin-sdk/plugin-entry";
import { normalizeProviderId } from "kaijibot/plugin-sdk/provider-model-shared";

type QwenThinkingLevel = ProviderWrapStreamFnContext["thinkingLevel"];
type QwenThinkingFormat = string | undefined;

function isQwenProviderId(providerId: string): boolean {
  const normalized = normalizeProviderId(providerId);
  return (
    normalized === "qwen" ||
    normalized === "modelstudio" ||
    normalized === "qwencloud" ||
    normalized === "dashscope"
  );
}

function setQwenChatTemplateThinking(payload: Record<string, unknown>, enabled: boolean): void {
  const existing = payload.chat_template_kwargs;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    const next: Record<string, unknown> = {
      ...(existing as Record<string, unknown>),
      enable_thinking: enabled,
    };
    if (!Object.hasOwn(next, "preserve_thinking")) {
      next.preserve_thinking = true;
    }
    payload.chat_template_kwargs = next;
    return;
  }
  payload.chat_template_kwargs = {
    enable_thinking: enabled,
    preserve_thinking: true,
  };
}

function readQwenThinkingFormatFromModel(model: Parameters<StreamFn>[0]): QwenThinkingFormat {
  if (model.api !== "openai-completions") {
    return undefined;
  }
  const compat =
    model.compat && typeof model.compat === "object"
      ? (model.compat as { thinkingFormat?: unknown })
      : undefined;
  return typeof compat?.thinkingFormat === "string" ? compat.thinkingFormat : undefined;
}

function isOpenAICompatibleThinkingEnabled(params: {
  thinkingLevel: QwenThinkingLevel;
  options: Parameters<StreamFn>[2];
}): boolean {
  if (params.thinkingLevel === "off" || params.thinkingLevel === undefined) return false;
  return true;
}

function createQwenPayloadPatchStreamWrapper(
  baseStreamFn: StreamFn | undefined,
  patchFn: (params: {
    payload: Record<string, unknown>;
    model: Parameters<StreamFn>[0];
    options: Parameters<StreamFn>[2];
  }) => void,
  opts: {
    shouldPatch?: (params: {
      model: Parameters<StreamFn>[0];
      context: Parameters<StreamFn>[1];
      options: Parameters<StreamFn>[2];
    }) => boolean;
  },
): StreamFn {
  const wrapper: StreamFn = (model, context, options) => {
    if (!baseStreamFn) {
      throw new Error("qwen stream: base stream fn not provided");
    }
    const shouldPatch = opts.shouldPatch?.({ model, context, options }) ?? true;
    if (!shouldPatch) {
      return baseStreamFn(model, context, options);
    }
    const originalOnPayload = options?.onPayload;
    return baseStreamFn(model, context, {
      ...options,
      onPayload: (payload) => {
        if (payload && typeof payload === "object") {
          patchFn({
            payload: payload as Record<string, unknown>,
            model,
            options,
          });
        }
        return originalOnPayload?.(payload, model);
      },
    });
  };
  return wrapper;
}

export function createQwenThinkingWrapper(
  baseStreamFn: StreamFn | undefined,
  thinkingLevel: QwenThinkingLevel,
  thinkingFormat?: QwenThinkingFormat,
): StreamFn {
  return createQwenPayloadPatchStreamWrapper(
    baseStreamFn,
    ({ payload: payloadObj, model, options }) => {
      const enableThinking = isOpenAICompatibleThinkingEnabled({ thinkingLevel, options });
      const effectiveThinkingFormat = thinkingFormat ?? readQwenThinkingFormatFromModel(model);
      if (effectiveThinkingFormat === "qwen-chat-template") {
        setQwenChatTemplateThinking(payloadObj, enableThinking);
        delete payloadObj.enable_thinking;
      } else {
        payloadObj.enable_thinking = enableThinking;
      }
      delete payloadObj.reasoning_effort;
      delete payloadObj.reasoningEffort;
      delete payloadObj.reasoning;
    },
    {
      shouldPatch: ({ model }) => model.api === "openai-completions" && model.reasoning,
    },
  );
}

export function wrapQwenProviderStream(ctx: ProviderWrapStreamFnContext): StreamFn | undefined {
  if (!isQwenProviderId(ctx.provider) || (ctx.model && ctx.model.api !== "openai-completions")) {
    return undefined;
  }
  return createQwenThinkingWrapper(
    ctx.streamFn,
    ctx.thinkingLevel,
    ctx.model ? readQwenThinkingFormatFromModel(ctx.model) : undefined,
  );
}
