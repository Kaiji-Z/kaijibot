import type { ModelCompatConfig } from "kaijibot/plugin-sdk/provider-model-shared";

const GROQ_QWEN3_32B_ID = "qwen/qwen3-32b";
const GROQ_GPT_OSS_REASONING_IDS = new Set([
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-safeguard-20b",
]);

function normalizeGroqModelId(modelId: string | undefined): string {
  return modelId?.trim().toLowerCase() ?? "";
}

export function resolveGroqReasoningCompatPatch(
  modelId: string,
): Pick<ModelCompatConfig, "supportsReasoningEffort"> | null {
  const normalized = normalizeGroqModelId(modelId);
  if (normalized === GROQ_QWEN3_32B_ID) {
    return { supportsReasoningEffort: true };
  }
  if (GROQ_GPT_OSS_REASONING_IDS.has(normalized)) {
    return { supportsReasoningEffort: true };
  }
  return null;
}

export function contributeGroqResolvedModelCompat(params: {
  modelId: string;
  model: { api?: unknown; provider?: unknown };
}): Partial<ModelCompatConfig> | undefined {
  if (params.model.api !== "openai-completions" || params.model.provider !== "groq") {
    return undefined;
  }
  return resolveGroqReasoningCompatPatch(params.modelId) ?? undefined;
}
