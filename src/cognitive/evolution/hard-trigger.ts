import type { KaijiBotConfig } from "../../config/types.kaijibot.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/evolution/hard-trigger");

export type HardTriggerParams = {
  toolMetas: ReadonlyArray<{ toolName?: string; meta?: string }>;
  sessionKey: string;
  trigger?: string;
  config: KaijiBotConfig;
  senderId?: string | null;
  started: number;
  userPrompt?: string;
};

export async function evaluateHardTrigger(params: HardTriggerParams): Promise<void> {
  log.debug("evaluating", { trigger: params.trigger, toolMetas: params.toolMetas.length, sessionKey: params.sessionKey, senderId: params.senderId });

  if (params.trigger !== "user" && params.trigger !== "manual" && params.trigger !== undefined) {
    log.debug("skipped: trigger mismatch", { trigger: params.trigger });
    return;
  }

  const userId = resolveUserIdFromSession(params.sessionKey, params.senderId);
  if (!userId) {
    log.debug("skipped: no userId resolved", { sessionKey: params.sessionKey, senderId: params.senderId });
    return;
  }

  const toolCalls = params.toolMetas
    .map((m) => m.toolName)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  if (toolCalls.length < 3) {
    log.debug("skipped: toolCalls < 3", { count: toolCalls.length });
    return;
  }

  log.debug("proceeding", { userId, toolCalls: toolCalls.length, uniqueTools: new Set(toolCalls).size });

  // Get error profile as reference context for the Agent (NOT used for gating)
  let errorInfo: { errorCount: number; failedToolNames: string[] } | undefined;
  try {
    const { consumeToolErrorProfile } = await import("../../agents/tool-error-summary.js");
    const profile = consumeToolErrorProfile(params.sessionKey);
    if (profile && profile.errorCount > 0) {
      errorInfo = { errorCount: profile.errorCount, failedToolNames: profile.failedToolNames };
    }
  } catch {
    // Non-critical: error info is optional context
  }

  const uniqueTools = new Set(toolCalls);
  const durationMs = Date.now() - params.started;

  // 3+ tool calls → directly enqueue evolution signal.
  // The Agent decides worthiness based on full conversation context.
  const signalText = buildEvolutionSignal({
    toolCalls,
    uniqueToolCount: uniqueTools.size,
    durationMs,
    errorInfo,
  });

  const targetSessionKey = resolveTargetSessionKey(params.sessionKey, params.config, userId);

  try {
    const { enqueueSystemEvent } = await import("../../infra/system-events.js");
    const { requestHeartbeatNow } = await import("../../infra/heartbeat-wake.js");

    enqueueSystemEvent(signalText, { sessionKey: targetSessionKey });
    requestHeartbeatNow({
      reason: "cognitive-evolution",
      sessionKey: targetSessionKey,
    });
    log.debug("evolution signal enqueued", { sessionKey: targetSessionKey, signalLength: signalText.length });
  } catch (err) {
    log.debug("failed to enqueue evolution signal", { error: String(err) });
  }
}

function resolveUserIdFromSession(sessionKey: string, senderId?: string | null): string | null {
  if (senderId) return senderId;
  const tail = sessionKey.split(":").pop();
  if (!tail || tail === "main") return null;
  return tail;
}

/**
 * Resolve the session key to use for the evolution signal.
 * Falls back to the current session key if no dedicated target is found.
 */
function resolveTargetSessionKey(sessionKey: string, config: KaijiBotConfig, userId: string): string {
  try {
    // Attempt to resolve a dedicated cognitive delivery session for this user
    // (same pattern as insight delivery). If unavailable, use the current session.
    const { resolveCognitiveDeliveryTarget } = require("../../gateway/cognitive-delivery.js") as typeof import("../../gateway/cognitive-delivery.js");
    const target = resolveCognitiveDeliveryTarget(config, userId);
    return target?.sessionKey ?? sessionKey;
  } catch {
    return sessionKey;
  }
}

function buildEvolutionSignal(params: {
  toolCalls: string[];
  uniqueToolCount: number;
  durationMs: number;
  errorInfo?: { errorCount: number; failedToolNames: string[] };
}): string {
  const durationSec = Math.round(params.durationMs / 1000);
  const toolSeq = params.toolCalls.join(", ");
  const lines = [
    `[Evolution Signal] 刚完成的任务涉及 ${params.toolCalls.length} 次工具调用（${params.uniqueToolCount} 种），持续 ${durationSec} 秒。`,
    `工具序列: ${toolSeq}`,
  ];
  if (params.errorInfo) {
    lines.push(`⚠ 工具错误: ${params.errorInfo.errorCount} 次错误（${params.errorInfo.failedToolNames.join(", ")}）`);
  }
  lines.push(
    "",
    "请根据完整对话上下文自主判断：这个任务模式是否值得做成可复用技能？",
    "如果是，用自然语言告诉用户你的想法，然后调用 evaluate_skill_evolution 工具生成技能草稿。",
    "如果觉得不值得，忽略即可。",
  );
  return lines.join("\n");
}
