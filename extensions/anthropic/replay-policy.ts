import type {
  ProviderReplayPolicy,
  ProviderReplayPolicyContext,
} from "kaijibot/plugin-sdk/plugin-entry";
import { buildNativeAnthropicReplayPolicyForModel } from "kaijibot/plugin-sdk/provider-model-shared";

/**
 * Returns the provider-owned replay policy for Anthropic transports.
 */
export function buildAnthropicReplayPolicy(ctx: ProviderReplayPolicyContext): ProviderReplayPolicy {
  return buildNativeAnthropicReplayPolicyForModel(ctx.modelId);
}
