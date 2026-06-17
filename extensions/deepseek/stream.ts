import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { ProviderWrapStreamFnContext } from "kaijibot/plugin-sdk/plugin-entry";
import { isDeepSeekV4ModelRef } from "./models.js";

type DeepSeekThinkingLevel = ProviderWrapStreamFnContext["thinkingLevel"];

export function createDeepSeekV4ThinkingWrapper(
  baseStreamFn: ProviderWrapStreamFnContext["streamFn"],
  thinkingLevel: DeepSeekThinkingLevel,
): ProviderWrapStreamFnContext["streamFn"] | undefined {
  if (!baseStreamFn) {
    return undefined;
  }
  const wrapper: StreamFn = (model, context, options) => {
    const enabled = thinkingLevel !== "off" && thinkingLevel !== undefined;
    const originalOnPayload = options?.onPayload;
    return baseStreamFn(model, context, {
      ...options,
      onPayload: (payload) => {
        if (payload && typeof payload === "object" && isDeepSeekV4ModelRef(model)) {
          const p = payload as Record<string, unknown>;
          if (enabled) {
            p.thinking = { type: "enabled" };
          } else {
            p.thinking = { type: "disabled" };
            delete p.reasoning_effort;
            delete p.reasoningEffort;
          }
        }
        return originalOnPayload?.(payload, model);
      },
    });
  };
  return wrapper;
}
