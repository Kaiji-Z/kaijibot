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
      "当看到 [Evolution Signal] 系统事件时，评估是否值得做成可复用技能。",
      "优先检查已有技能是否可以覆盖这个场景——如果可以，用 patch_skill 改进已有技能，而不是创建新的。",
      "如果确实需要新技能，调用 evaluate_skill_evolution 工具生成技能草稿，然后让用户审核。",
      "如果觉得不值得，忽略即可。如果用户想修改已有技能，使用 patch_skill 工具。",
    ].join("\n"));
  }

  return { prompt: parts.join("\n\n"), classification };
}
