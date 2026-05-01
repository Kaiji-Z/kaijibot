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
      "当看到 [Evolution Signal] 系统事件时，说明刚完成的任务可能值得保存为技能。请根据对话上下文判断：如果确实复杂且有复用价值，用自然语言告诉用户你的想法，然后调用 evaluate_skill_evolution 工具生成技能草稿。如果觉得不值得，直接忽略即可。",
      "当任务中工具调用出过错（3+ 工具），也可以主动调用 evaluate_skill_evolution 评估。",
      "如果评估结果为 suggested，向用户展示技能草稿并询问是否保存。用户确认后，使用 skill-creator 工具创建技能。如果用户想修改已有技能，使用 patch_skill 工具。",
    ].join("\n"));
  }

  return { prompt: parts.join("\n\n"), classification };
}
