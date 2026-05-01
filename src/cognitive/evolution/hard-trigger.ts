import type { KaijiBotConfig } from "../../config/types.kaijibot.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { EvolutionCandidate } from "./types.js";

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

  const { EvolutionEngine } = await import("./engine.js");
  const { EvolutionStore } = await import("./store.js");
  const { consumeToolErrorProfile } = await import("../../agents/tool-error-summary.js");
  const { resolveConfigDir } = await import("../../utils.js");

  const errorProfile = consumeToolErrorProfile(params.sessionKey);
  const uniqueTools = new Set(toolCalls);

  const candidate: EvolutionCandidate = {
    taskSummary: "auto",
    toolCalls,
    uniqueToolCount: uniqueTools.size,
    durationMs: Date.now() - params.started,
    reasoningTurns: Math.max(1, Math.floor(toolCalls.length / 2)),
    domain: "auto",
    errorProfile,
  };

  const configDir = resolveConfigDir();
  const store = new EvolutionStore(configDir);
  const engine = new EvolutionEngine(store);

  const decision = await engine.evaluate(candidate, userId);
  log.debug("evaluate decision", { shouldSuggest: decision.shouldSuggest, complexityScore: decision.complexityScore, reasoning: decision.reasoning });
  if (!decision.shouldSuggest) return;

  // Instead of generating a draft and delivering outbound, enqueue a system event
  // that the agent will pick up in its next heartbeat turn. The agent has full
  // conversation context and can naturally decide whether to suggest a skill.
  const signalText = buildEvolutionSignal(candidate);
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

/**
 * Build the evolution signal that the agent will see as a system event.
 * This is an instruction to the agent, not a user-facing message.
 * The agent decides whether to act on it based on conversation context.
 */
function buildEvolutionSignal(candidate: EvolutionCandidate): string {
  const durationSec = Math.round(candidate.durationMs / 1000);
  const toolSeq = candidate.toolCalls.join(", ");
  return [
    `[Evolution Signal] 刚完成的任务涉及 ${candidate.toolCalls.length} 次工具调用（${candidate.uniqueToolCount} 种），持续 ${durationSec} 秒。`,
    `工具序列: ${toolSeq}`,
    "",
    "请评估：这个任务模式是否值得做成可复用技能？",
    "如果是，用自然语言告诉用户你的想法，然后调用 evaluate_skill_evolution 工具生成技能草稿。",
    "如果觉得不值得，忽略即可。",
  ].join("\n");
}
