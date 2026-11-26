import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ThinkingLevelMap } from "@earendil-works/pi-ai";
import type { ReasoningLevel, ThinkLevel } from "../../auto-reply/thinking.js";

export function mapThinkingLevel(level?: ThinkLevel): ThinkingLevel {
  // pi-agent-core supports "xhigh"; KaijiBot enables it for specific models.
  if (!level) {
    return "off";
  }
  // "adaptive" maps to "medium" at the pi-agent-core layer.  The Pi SDK
  // provider then translates this to `thinking.type: "adaptive"` with
  // `output_config.effort: "medium"` for models that support it (Opus 4.6,
  // Sonnet 4.6).
  if (level === "adaptive") {
    return "medium";
  }
  return level;
}

export function resolveSessionThinkingLevel(
  level: ThinkLevel | undefined,
  model?: { thinkingLevelMap?: ThinkingLevelMap },
): ThinkingLevel {
  const mapped = mapThinkingLevel(level);
  if (mapped !== "off") {
    return mapped;
  }
  // pi-ai builds `thinking: { type: "disabled" }` whenever no reasoning effort
  // is set, which always-thinking models (glm-5.3 family) reject with HTTP 400.
  // pi 1.6's provider-request hook chain can rebuild the payload after the
  // extension's onPayload patch, so the fix must happen before the session
  // exists: naming the model's declared "off" effort here keeps the whole
  // pipeline on the effort path and pi-ai sends `reasoning_effort` natively.
  const offEffort = model?.thinkingLevelMap?.off;
  if (typeof offEffort === "string" && offEffort.length > 0) {
    // Effort names in thinkingLevelMap ("low"/"high"/"max") are valid
    // pi-agent-core ThinkingLevel values by contract.
    return offEffort as ThinkingLevel;
  }
  return mapped;
}

export type { ReasoningLevel, ThinkLevel };
