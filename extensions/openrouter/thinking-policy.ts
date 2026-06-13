import { isOpenRouterDeepSeekV4ModelId } from "./models.js";

type OpenRouterThinkingLevel = { id: string };
type OpenRouterThinkingProfile = {
  levels: OpenRouterThinkingLevel[];
  defaultLevel: string;
};

const OPENROUTER_DEEPSEEK_V4_THINKING_LEVEL_IDS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

function buildOpenRouterDeepSeekV4ThinkingLevel(
  id: (typeof OPENROUTER_DEEPSEEK_V4_THINKING_LEVEL_IDS)[number],
) {
  return { id };
}

const OPENROUTER_DEEPSEEK_V4_THINKING_PROFILE: OpenRouterThinkingProfile = {
  levels: OPENROUTER_DEEPSEEK_V4_THINKING_LEVEL_IDS.map(buildOpenRouterDeepSeekV4ThinkingLevel),
  defaultLevel: "high",
};

export function supportsOpenRouterXHighThinking(modelId: string): boolean {
  return isOpenRouterDeepSeekV4ModelId(modelId);
}

export function resolveOpenRouterThinkingProfile(
  modelId: string,
): OpenRouterThinkingProfile | undefined {
  return isOpenRouterDeepSeekV4ModelId(modelId)
    ? OPENROUTER_DEEPSEEK_V4_THINKING_PROFILE
    : undefined;
}
