import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SAFETY_MARGIN, estimateMessagesTokens } from "../../compaction.js";
import { estimateMessageTokens } from "../../token-estimation.js";
import { estimateToolResultReductionPotential } from "../tool-result-truncation.js";

export const PREEMPTIVE_OVERFLOW_ERROR_TEXT =
  "Context overflow: prompt too large for the model (precheck).";

const TRUNCATION_ROUTE_BUFFER_TOKENS = 512;

export type PreemptiveCompactionRoute =
  | "fits"
  | "compact_only"
  | "truncate_tool_results_only"
  | "compact_then_truncate";

export function estimatePrePromptTokens(params: {
  messages: AgentMessage[];
  systemPrompt?: string;
  prompt: string;
  lastUsageTokens?: number;
}): number {
  const { messages, systemPrompt, prompt, lastUsageTokens } = params;

  const syntheticMessages: AgentMessage[] = [];
  if (typeof systemPrompt === "string" && systemPrompt.trim().length > 0) {
    syntheticMessages.push({
      role: "system",
      content: systemPrompt,
      timestamp: 0,
    } as unknown as AgentMessage);
  }
  syntheticMessages.push({ role: "user", content: prompt, timestamp: 0 } as AgentMessage);

  const syntheticTokens = syntheticMessages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0,
  );

  if (lastUsageTokens !== undefined && lastUsageTokens > 0) {
    const lastUsageIndex = findLastAssistantUsageIndex(messages);
    let trailingTokens = 0;
    if (lastUsageIndex !== null) {
      for (let i = lastUsageIndex + 1; i < messages.length; i++) {
        trailingTokens += estimateMessageTokens(messages[i]);
      }
    } else {
      trailingTokens = estimateMessagesTokens(messages);
    }
    return Math.max(0, Math.ceil((lastUsageTokens + trailingTokens + syntheticTokens) * SAFETY_MARGIN));
  }

  const estimated = estimateMessagesTokens(messages) + syntheticTokens;
  return Math.max(0, Math.ceil(estimated * SAFETY_MARGIN));
}

function findLastAssistantUsageIndex(messages: AgentMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as unknown as Record<string, unknown>;
    if (msg.role === "assistant") {
      const usage = (msg as { usage?: Record<string, unknown> }).usage;
      const stopReason = (msg as { stopReason?: string }).stopReason;
      if (usage && typeof usage === "object" && stopReason !== "aborted" && stopReason !== "error") {
        return i;
      }
    }
  }
  return null;
}

export function shouldPreemptivelyCompactBeforePrompt(params: {
  messages: AgentMessage[];
  systemPrompt?: string;
  prompt: string;
  contextTokenBudget: number;
  reserveTokens: number;
  lastUsageTokens?: number;
}): {
  route: PreemptiveCompactionRoute;
  shouldCompact: boolean;
  estimatedPromptTokens: number;
  promptBudgetBeforeReserve: number;
  overflowTokens: number;
  toolResultReducibleChars: number;
} {
  const estimatedPromptTokens = estimatePrePromptTokens({
    messages: params.messages,
    systemPrompt: params.systemPrompt,
    prompt: params.prompt,
    lastUsageTokens: params.lastUsageTokens,
  });
  const promptBudgetBeforeReserve = Math.max(
    1,
    Math.floor(params.contextTokenBudget) - Math.max(0, Math.floor(params.reserveTokens)),
  );
  const overflowTokens = Math.max(0, estimatedPromptTokens - promptBudgetBeforeReserve);
  const toolResultPotential = estimateToolResultReductionPotential({
    messages: params.messages,
    contextWindowTokens: params.contextTokenBudget,
  });
  const CONSERVATIVE_CHARS_PER_TOKEN = 2;
  const overflowChars = overflowTokens * CONSERVATIVE_CHARS_PER_TOKEN;
  const truncationBufferChars = TRUNCATION_ROUTE_BUFFER_TOKENS * CONSERVATIVE_CHARS_PER_TOKEN;
  const truncateOnlyThresholdChars = Math.max(
    overflowChars + truncationBufferChars,
    Math.ceil(overflowChars * 1.5),
  );
  const toolResultReducibleChars = toolResultPotential.maxReducibleChars;

  let route: PreemptiveCompactionRoute = "fits";
  if (overflowTokens > 0) {
    if (toolResultReducibleChars <= 0) {
      route = "compact_only";
    } else if (toolResultReducibleChars >= truncateOnlyThresholdChars) {
      route = "truncate_tool_results_only";
    } else {
      route = "compact_then_truncate";
    }
  }
  return {
    route,
    shouldCompact: route === "compact_only" || route === "compact_then_truncate",
    estimatedPromptTokens,
    promptBudgetBeforeReserve,
    overflowTokens,
    toolResultReducibleChars,
  };
}
