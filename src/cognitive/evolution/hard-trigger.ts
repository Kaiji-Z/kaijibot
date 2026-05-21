import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/evolution/hard-trigger");

export type HardTriggerParams = {
  toolMetas: ReadonlyArray<{ toolName?: string; meta?: string }>;
  sessionKey: string;
  trigger?: string;
  senderId?: string | null;
  started: number;
  configDir?: string;
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

  const uniqueTools = new Set(toolCalls);
  const durationMs = Date.now() - params.started;

  let existingSkills: Array<{ name: string; description: string }> | undefined;
  if (params.configDir) {
    try {
      const { SkillPersistenceWriter } = await import("./skill-writer.js");
      const writer = new SkillPersistenceWriter(params.configDir);
      const names = await writer.listSkillNames();
      const skills: Array<{ name: string; description: string }> = [];
      for (const name of names) {
        const meta = await writer.readSkillMeta(name);
        if (meta) skills.push({ name: meta.name, description: meta.description });
      }
      existingSkills = skills.length > 0 ? skills : undefined;
    } catch {
      // Non-critical; proceed without skill list
    }
  }

  let agentId: string | undefined;
  try {
    const { parseAgentSessionKey } = await import("../../routing/session-key.js");
    const parsed = parseAgentSessionKey(params.sessionKey);
    if (parsed) agentId = parsed.agentId;
  } catch {}

  const signalText = buildEvolutionSignal({
    toolCalls,
    uniqueToolCount: uniqueTools.size,
    durationMs,
    existingSkills,
    agentId,
  });

  try {
    const { enqueueSystemEvent } = await import("../../infra/system-events.js");
    const { requestHeartbeatNow } = await import("../../infra/heartbeat-wake.js");

    enqueueSystemEvent(signalText, { sessionKey: params.sessionKey });
    requestHeartbeatNow({
      reason: "cognitive-evolution",
      sessionKey: params.sessionKey,
    });
    log.debug("evolution signal enqueued", { sessionKey: params.sessionKey, signalLength: signalText.length });
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

function buildEvolutionSignal(params: {
  toolCalls: string[];
  uniqueToolCount: number;
  durationMs: number;
  existingSkills?: Array<{ name: string; description: string }>;
  agentId?: string;
}): string {
  const durationSec = Math.round(params.durationMs / 1000);
  const lines = [
    `[Evolution Signal] 刚完成的任务涉及 ${params.toolCalls.length} 次工具调用（${params.uniqueToolCount} 种），持续 ${durationSec} 秒。${params.agentId && params.agentId !== "main" ? ` [agent: ${params.agentId}]` : ""}`,
    "",
    "请根据对话上下文自主判断：这个任务模式是否值得做成可复用技能？",
    "优先检查已有技能是否能覆盖——如果能，用 patch_skill 改进已有技能。",
    "如果确实需要新技能，调用 evaluate_skill_evolution 工具生成技能草稿，然后让用户审核。",
    "如果觉得不值得，忽略即可。",
  ];

  if (params.existingSkills && params.existingSkills.length > 0) {
    lines.push("");
    lines.push("已有技能：");
    for (const skill of params.existingSkills) {
      lines.push(`- ${skill.name}: ${skill.description}`);
    }
  }

  return lines.join("\n");
}
