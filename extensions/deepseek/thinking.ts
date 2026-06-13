import { isDeepSeekV4ModelId } from "./models.js";

type DeepSeekV4ThinkingLevel = { id: string };
type DeepSeekV4ThinkingProfile = {
  levels: DeepSeekV4ThinkingLevel[];
  defaultLevel: string;
};

const V4_THINKING_LEVEL_IDS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

function buildDeepSeekV4ThinkingLevel(id: (typeof V4_THINKING_LEVEL_IDS)[number]) {
  return { id };
}

const DEEPSEEK_V4_THINKING_PROFILE: DeepSeekV4ThinkingProfile = {
  levels: V4_THINKING_LEVEL_IDS.map(buildDeepSeekV4ThinkingLevel),
  defaultLevel: "high",
};

export function resolveDeepSeekV4ThinkingProfile(
  modelId: string,
): DeepSeekV4ThinkingProfile | undefined {
  return isDeepSeekV4ModelId(modelId) ? DEEPSEEK_V4_THINKING_PROFILE : undefined;
}
