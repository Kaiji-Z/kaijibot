import { classifyMode, buildModePromptSection } from "./mode-router.js";
import type { CognitiveMode, ModeClassification, PersonaTree } from "./types.js";
import { buildPersonaContext } from "./persona/context-builder.js";
import { getPhaseBehaviorAdvice, getInteractionPhase } from "./feedback/trust-calculator.js";

export function buildCognitiveModePrompt(params: {
  message: string;
  isHeartbeat?: boolean;
  isCron?: boolean;
  recentModes?: CognitiveMode[];
  cognitiveEnabled?: boolean;
  evolutionEnabled?: boolean;
  persona?: PersonaTree;
}): { prompt: string; classification: ModeClassification } {
  const { message, isHeartbeat, isCron, recentModes, cognitiveEnabled, evolutionEnabled, persona } = params;

  const classification = classifyMode(message, {
    isHeartbeat,
    isCron,
    recentModes,
  });

  if (cognitiveEnabled === false) {
    return { prompt: "", classification };
  }

  const parts: string[] = [];

  parts.push(buildModePromptSection(classification.mode));

  if (persona) {
    const personaCtx = buildPersonaContext(persona);
    if (personaCtx) parts.push(personaCtx);

    const phase = getInteractionPhase(persona.rapport.trustScore);
    const advice = getPhaseBehaviorAdvice(phase);
    if (advice) {
      parts.push(`## Interaction Guidance\n${advice}`);
    }
  }

  if (evolutionEnabled !== false) {
    parts.push([
      "## Skill Evolution",
      "当看到 [Evolution Signal] 系统事件时，说明刚完成的任务可能值得保存为技能。请根据对话上下文判断：如果确实复杂且有复用价值，调用 evaluate_skill_evolution 工具生成技能草稿。",
      "你可以选择：1) 直接告诉用户并当场确认；2) 如果用户正忙或最近已建议过类似内容，静默创建技能（用 skill-creator），稍后聊天时顺便提一下。",
      "evaluate_skill_evolution 会返回 recentSuggestions 上下文——如果同一领域用户之前拒绝过，谨慎处理；如果用户接受了之前的建议，可以继续积极建议。",
      "如果觉得不值得做成技能，忽略信号即可。如果用户想修改已有技能，使用 patch_skill 工具。",
    ].join("\n"));
  }

  return { prompt: parts.join("\n\n"), classification };
}
