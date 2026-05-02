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
      "当看到 [Evolution Signal] 系统事件时，说明刚完成的任务涉及多次工具调用，可能值得保存为技能。",
      "你拥有完整对话上下文，请自主判断：这个任务模式是否复杂且有复用价值？",
      "- 如果值得，调用 evaluate_skill_evolution 生成技能草稿，然后自然地告诉用户。",
      "- 如果觉得太简单或不值得，忽略信号即可。",
      "- 如果近期已建议过类似内容但这次确实值得，可以静默创建技能（用 skill-creator），稍后自然地提到。",
      "- evaluate_skill_evolution 返回 recentSuggestions 上下文供你参考频率判断。",
      "- 如果用户想修改已有技能，使用 patch_skill 工具。",
    ].join("\n"));
  }

  return { prompt: parts.join("\n\n"), classification };
}
