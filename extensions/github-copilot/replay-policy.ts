import { normalizeLowercaseStringOrEmpty } from "kaijibot/plugin-sdk/text-runtime";

export function buildGithubCopilotReplayPolicy(modelId?: string) {
  return normalizeLowercaseStringOrEmpty(modelId).includes("claude")
    ? {
        dropThinkingBlocks: true,
      }
    : {};
}
