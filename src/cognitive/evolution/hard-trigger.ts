import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  DEFAULT_COGNITIVE_LOCALE,
  L,
  pickLocalized,
  type CognitiveLocale,
} from "../cognitive-locale.js";
import { resolveCorrectionUserId } from "../correction/userid.js";

const log = createSubsystemLogger("cognitive/evolution/hard-trigger");

export type HardTriggerParams = {
  toolMetas: ReadonlyArray<{ toolName?: string; meta?: string }>;
  sessionKey: string;
  trigger?: string;
  senderId?: string | null;
  started: number;
  configDir?: string;
  /** Locale for the generated signal text. Defaults to zh (legacy behavior). */
  locale?: CognitiveLocale;
};

const SIGNAL_HEADER = L("[Evolution Signal]", "[Evolution Signal]");
const SIGNAL_BODY_TEMPLATE = L(
  "刚完成的任务涉及 {toolCalls} 次工具调用（{uniqueTools} 种），持续 {duration} 秒。",
  "The completed task involved {toolCalls} tool calls ({uniqueTools} unique), lasting {duration} seconds.",
);
const SIGNAL_INSTRUCTIONS = [
  L(
    "请根据对话上下文自主判断：这个任务模式是否值得做成可复用技能？",
    "Decide autonomously based on the conversation context: is this task pattern worth turning into a reusable skill?",
  ),
  L(
    "优先检查已有技能是否能覆盖——如果能，用 patch_skill 改进已有技能。",
    "First check whether an existing skill covers it — if so, use patch_skill to improve the existing skill.",
  ),
  L(
    "如果确实需要新技能，调用 evaluate_skill_evolution 工具生成技能草稿，然后让用户审核。",
    "If a new skill is genuinely needed, call the evaluate_skill_evolution tool to generate a skill draft, then let the user review it.",
  ),
  L("如果觉得不值得，忽略即可。", "If you decide it is not worth it, simply ignore this signal."),
];
const EXISTING_SKILLS_HEADER = L("已有技能：", "Existing skills:");

export async function evaluateHardTrigger(params: HardTriggerParams): Promise<void> {
  log.debug("evaluating", {
    trigger: params.trigger,
    toolMetas: params.toolMetas.length,
    sessionKey: params.sessionKey,
    senderId: params.senderId,
  });

  if (params.trigger !== "user" && params.trigger !== "manual" && params.trigger !== undefined) {
    log.debug("skipped: trigger mismatch", { trigger: params.trigger });
    return;
  }

  const userId = resolveCorrectionUserId(params.sessionKey, params.senderId ?? undefined);
  if (!userId) {
    log.debug("skipped: no userId resolved", {
      sessionKey: params.sessionKey,
      senderId: params.senderId,
    });
    return;
  }

  const toolCalls = params.toolMetas
    .map((m) => m.toolName)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  if (toolCalls.length < 3) {
    log.debug("skipped: toolCalls < 3", { count: toolCalls.length });
    return;
  }

  log.debug("proceeding", {
    userId,
    toolCalls: toolCalls.length,
    uniqueTools: new Set(toolCalls).size,
  });

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
        if (meta) {
          skills.push({ name: meta.name, description: meta.description });
        }
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
    if (parsed) {
      agentId = parsed.agentId;
    }
  } catch {}

  const signalText = buildEvolutionSignal({
    toolCalls,
    uniqueToolCount: uniqueTools.size,
    durationMs,
    existingSkills,
    agentId,
    locale: params.locale ?? DEFAULT_COGNITIVE_LOCALE,
  });

  try {
    const { enqueueSystemEvent } = await import("../../infra/system-events.js");
    const { requestHeartbeatNow } = await import("../../infra/heartbeat-wake.js");

    enqueueSystemEvent(signalText, { sessionKey: params.sessionKey });
    requestHeartbeatNow({
      reason: "cognitive-evolution",
      sessionKey: params.sessionKey,
    });
    log.debug("evolution signal enqueued", {
      sessionKey: params.sessionKey,
      signalLength: signalText.length,
    });
  } catch (err) {
    log.debug("failed to enqueue evolution signal", { error: String(err) });
  }
}

function buildEvolutionSignal(params: {
  toolCalls: string[];
  uniqueToolCount: number;
  durationMs: number;
  existingSkills?: Array<{ name: string; description: string }>;
  agentId?: string;
  locale?: CognitiveLocale;
}): string {
  const durationSec = Math.round(params.durationMs / 1000);
  const locale = params.locale ?? DEFAULT_COGNITIVE_LOCALE;
  const header = pickLocalized(SIGNAL_HEADER, locale);
  const agentSuffix =
    params.agentId && params.agentId !== "main" ? ` [agent: ${params.agentId}]` : "";
  const body = pickLocalized(SIGNAL_BODY_TEMPLATE, locale)
    .replace("{toolCalls}", String(params.toolCalls.length))
    .replace("{uniqueTools}", String(params.uniqueToolCount))
    .replace("{duration}", String(durationSec));
  const lines = [`${header} ${body}${agentSuffix}`, ""];
  for (const instruction of SIGNAL_INSTRUCTIONS) {
    lines.push(pickLocalized(instruction, locale));
  }

  if (params.existingSkills && params.existingSkills.length > 0) {
    lines.push("");
    lines.push(pickLocalized(EXISTING_SKILLS_HEADER, locale));
    for (const skill of params.existingSkills) {
      lines.push(`- ${skill.name}: ${skill.description}`);
    }
  }

  return lines.join("\n");
}
