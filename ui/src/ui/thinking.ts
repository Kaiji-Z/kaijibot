import { normalizeLowercaseStringOrEmpty } from "./string-coerce.ts";

export type ThinkingCatalogEntry = {
  provider: string;
  id: string;
  reasoning?: boolean;
};

const BASE_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "adaptive"] as const;
const BINARY_THINKING_LEVELS = ["off", "on"] as const;
const GLM53_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const ANTHROPIC_CLAUDE_46_MODEL_RE = /^claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])/i;
const AMAZON_BEDROCK_CLAUDE_46_MODEL_RE = /claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])/i;
const ZAI_GLM53_MODEL_RE = /^glm-5\.3(?:$|-)/i;

export function normalizeThinkingProviderId(provider?: string | null): string {
  if (!provider) {
    return "";
  }
  const normalized = normalizeLowercaseStringOrEmpty(provider);
  if (normalized === "z.ai" || normalized === "z-ai") {
    return "zai";
  }
  if (normalized === "bedrock" || normalized === "aws-bedrock") {
    return "amazon-bedrock";
  }
  return normalized;
}

// GLM-5.3 models always think, and Z.AI takes a thinking level as a reasoning effort. They
// offer every level up to xhigh where the other Z.AI models only switch thinking on or off.
export function isZaiGlm53Model(provider?: string | null, model?: string | null): boolean {
  return (
    normalizeThinkingProviderId(provider) === "zai" &&
    ZAI_GLM53_MODEL_RE.test(normalizeLowercaseStringOrEmpty(model).trim())
  );
}

export function isBinaryThinkingProvider(provider?: string | null, model?: string | null): boolean {
  return normalizeThinkingProviderId(provider) === "zai" && !isZaiGlm53Model(provider, model);
}

export function normalizeThinkLevel(raw?: string | null): string | undefined {
  if (!raw) {
    return undefined;
  }
  const key = normalizeLowercaseStringOrEmpty(raw);
  const collapsed = key.replace(/[\s_-]+/g, "");
  if (collapsed === "adaptive" || collapsed === "auto") {
    return "adaptive";
  }
  if (collapsed === "xhigh" || collapsed === "extrahigh") {
    return "xhigh";
  }
  if (key === "off") {
    return "off";
  }
  if (["on", "enable", "enabled"].includes(key)) {
    return "low";
  }
  if (["min", "minimal"].includes(key)) {
    return "minimal";
  }
  if (["low", "thinkhard", "think-hard", "think_hard"].includes(key)) {
    return "low";
  }
  if (["mid", "med", "medium", "thinkharder", "think-harder", "harder"].includes(key)) {
    return "medium";
  }
  if (
    ["high", "ultra", "ultrathink", "think-hard", "thinkhardest", "highest", "max"].includes(key)
  ) {
    return "high";
  }
  if (key === "think") {
    return "minimal";
  }
  return undefined;
}

export function listThinkingLevelLabels(
  provider?: string | null,
  model?: string | null,
): readonly string[] {
  if (isZaiGlm53Model(provider, model)) {
    return GLM53_THINKING_LEVELS;
  }
  return isBinaryThinkingProvider(provider, model) ? BINARY_THINKING_LEVELS : BASE_THINKING_LEVELS;
}

export function formatThinkingLevels(provider?: string | null, model?: string | null): string {
  return listThinkingLevelLabels(provider, model).join(", ");
}

export function resolveThinkingDefaultForModel(params: {
  provider: string;
  model: string;
  catalog?: ThinkingCatalogEntry[];
}): string {
  const normalizedProvider = normalizeThinkingProviderId(params.provider);
  const modelId = params.model.trim();
  if (normalizedProvider === "anthropic" && ANTHROPIC_CLAUDE_46_MODEL_RE.test(modelId)) {
    return "adaptive";
  }
  if (normalizedProvider === "amazon-bedrock" && AMAZON_BEDROCK_CLAUDE_46_MODEL_RE.test(modelId)) {
    return "adaptive";
  }
  // Z.AI picks the effort for this level, which is how the model runs unless the user chooses.
  if (isZaiGlm53Model(normalizedProvider, modelId)) {
    return "high";
  }
  const candidate = params.catalog?.find(
    (entry) => entry.provider === params.provider && entry.id === params.model,
  );
  return candidate?.reasoning ? "low" : "off";
}
