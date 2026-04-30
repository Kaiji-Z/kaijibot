import { randomUUID } from "node:crypto";
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
  const { generateSkillDraftLLM } = await import("./llm-draft-generator.js");
  const { createStandaloneGenerateText } = await import("./standalone-generate.js");
  const { consumeToolErrorProfile } = await import("../../agents/tool-error-summary.js");
  const { resolveConfigDir } = await import("../../utils.js");

  const errorProfile = consumeToolErrorProfile(params.sessionKey);
  const uniqueTools = new Set(toolCalls);

  const candidate: EvolutionCandidate = {
    taskSummary: extractUserText(params.userPrompt)
      ?? `Multi-step task with ${toolCalls.length} tool calls (${uniqueTools.size} unique)`,
    toolCalls,
    uniqueToolCount: uniqueTools.size,
    durationMs: Date.now() - params.started,
    reasoningTurns: Math.max(1, Math.floor(toolCalls.length / 2)),
    domain: "auto",
    errorProfile,
  };

  const configDir = resolveConfigDir();
  const store = new EvolutionStore(configDir);

  let engine: InstanceType<typeof EvolutionEngine>;
  try {
    const generateText = await createStandaloneGenerateText(params.config, {
      maxTokens: 4000,
      timeout: 60_000,
    });
    engine = new EvolutionEngine(store, undefined, undefined, (c) =>
      generateSkillDraftLLM(c, { generateText }),
    );
  } catch {
    engine = new EvolutionEngine(store);
  }

  const decision = await engine.evaluate(candidate, userId, { skipCooldown: true });
  log.debug("evaluate decision", { shouldSuggest: decision.shouldSuggest, complexityScore: decision.complexityScore, reasoning: decision.reasoning });
  if (!decision.shouldSuggest) return;

  const draft = await engine.generate(candidate);
  log.debug("draft generated", { name: draft.name, description: draft.description?.slice(0, 80) });

  await store.save({
    id: randomUUID(),
    userId,
    candidate,
    decision,
    draft,
    timestamp: Date.now(),
  });

  const suggestionText = buildSuggestionText(candidate, draft, params.sessionKey);
  try {
    const { resolveCognitiveDeliveryTarget } = await import("../../gateway/cognitive-delivery.js");
    const { deliverOutboundPayloads } = await import("../../infra/outbound/deliver.js");
    const { buildOutboundSessionContext } = await import("../../infra/outbound/session-context.js");

    const target = resolveCognitiveDeliveryTarget(params.config, userId);
    if (target) {
      const session = buildOutboundSessionContext({
        cfg: params.config,
        sessionKey: target.sessionKey,
      });
      await deliverOutboundPayloads({
        cfg: params.config,
        channel: target.channel,
        to: target.to,
        accountId: target.accountId,
        payloads: [{ text: suggestionText }],
        session,
        bestEffort: true,
      });
      log.debug("delivered via outbound", { name: draft.name, channel: target.channel, to: target.to });
    } else {
      log.debug("no delivery target found for userId", { userId });
    }
  } catch (err) {
    log.debug("delivery failed", { error: String(err) });
  }
}

function resolveUserIdFromSession(sessionKey: string, senderId?: string | null): string | null {
  if (senderId) return senderId;
  const tail = sessionKey.split(":").pop();
  if (!tail || tail === "main") return null;
  return tail;
}

function buildSuggestionText(
  candidate: EvolutionCandidate,
  draft: { name: string; description: string },
  sessionKey: string,
): string {
  const agentId = sessionKey.split(":")[1] ?? "main";
  const workspaceDir = agentId === "main"
    ? "~/.kaijibot/workspace"
    : `~/.kaijibot/workspace-${agentId}`;
  const saveDir = `${workspaceDir}/skills/${draft.name}`;
  return [
    `[系统提示] 刚才完成的任务涉及 ${candidate.toolCalls.length} 次工具调用（${candidate.uniqueToolCount} 种工具），耗时 ${Math.round(candidate.durationMs / 1000)} 秒。`,
    `系统已自动生成技能「${draft.name}」：${draft.description}`,
    "",
    `如果觉得有用，回复\u201C保存技能\u201D，我会保存到 ${saveDir}/SKILL.md；如果需要调整，告诉我怎么改；不需要的话直接忽略即可。`,
  ].join("\n");
}

function extractUserText(prompt?: string): string | null {
  if (!prompt) return null;
  const lines = prompt.split("\n");
  const userLines: string[] = [];
  let inCodeBlock = false;
  let foundUserContent = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (
      line.startsWith("Conversation info") ||
      line.startsWith("Sender (untrusted") ||
      line.startsWith("[message_id:") ||
      line.startsWith("Recipients") ||
      line.startsWith("Channel") ||
      line.startsWith("#")
    ) {
      if (foundUserContent) userLines.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (
      !foundUserContent &&
      (trimmed.startsWith("ou_") || trimmed.match(/^[a-f0-9]{32}:/))
    ) {
      continue;
    }
    if (trimmed === "" && !foundUserContent) continue;
    foundUserContent = true;
    userLines.push(line);
  }
  const result = userLines.join("\n").trim();
  if (!result || result.length < 5) return null;
  return result.slice(0, 500);
}
