import {
  DEFAULT_COGNITIVE_LOCALE,
  detectCognitiveLocale,
  L,
  pickLocalized,
  type CognitiveLocale,
} from "./cognitive-locale.js";
import { formatCorrectionsPrompt, selectRelevantCorrections } from "./correction/injector.js";
import type { CorrectionRecord } from "./correction/types.js";
import { getPhaseBehaviorAdvice, getInteractionPhase } from "./feedback/trust-calculator.js";
import type { InsightCandidate } from "./insight/types.js";
import { classifyMode, buildModePromptSection } from "./mode-router.js";
import { buildPersonaContext } from "./persona/context-builder.js";
import type { CognitiveMode, ModeClassification, PersonaTree } from "./types.js";

type PendingInsightDelivery = {
  candidate: InsightCandidate;
  generatedAt: number;
  opportunityType: string;
} | null;

const SKILL_EVOLUTION_PROMPT = {
  heading: L("## Skill Evolution", "## Skill Evolution"),
  instructions: [
    L(
      "当看到 [Evolution Signal] 系统事件时，根据对话上下文自主判断这个任务模式是否值得做成可复用技能。",
      "When you see an [Evolution Signal] system event, decide autonomously based on the full conversation context whether this task pattern is worth turning into a reusable skill.",
    ),
    L(
      "优先检查已有技能是否可以覆盖——如果可以，用 patch_skill 改进已有技能。",
      "First check whether an existing skill already covers it — if so, use patch_skill to improve the existing skill.",
    ),
    L(
      "如果确实值得做成新技能，调用 evaluate_skill_evolution 工具，它会自动生成并保存技能。保存后告诉用户你自主进化了什么。",
      "If it is genuinely worth a new skill, call the evaluate_skill_evolution tool; it will generate and save the skill automatically. Tell the user what you self-evolved after saving.",
    ),
    L(
      "如果觉得不值得，直接告诉用户原因。",
      "If you decide it is not worth it, tell the user why directly.",
    ),
    L(
      "无论哪种结果，都必须告知用户，绝不能静默处理。",
      "Whichever outcome, you must inform the user — never handle it silently.",
    ),
    L(
      "如果用户对已保存的技能不满意，可以说「删除技能 xxx」来移除。",
      'If the user is unsatisfied with a saved skill, they can say "delete skill xxx" to remove it.',
    ),
  ],
};

function buildSkillEvolutionSection(locale: CognitiveLocale): string {
  const lines = [pickLocalized(SKILL_EVOLUTION_PROMPT.heading, locale)];
  for (const instruction of SKILL_EVOLUTION_PROMPT.instructions) {
    lines.push(pickLocalized(instruction, locale));
  }
  return lines.join("\n");
}

function formatHandshakeGap(hours: number): string {
  return hours < 24 ? `${Math.round(hours)} 小时` : `${Math.round(hours / 24)} 天`;
}

function buildHandshakeSection(params: {
  persona: PersonaTree;
  pendingInsightDelivery: PendingInsightDelivery;
  hoursSinceLastInteraction: number;
}): string {
  const { persona, pendingInsightDelivery, hoursSinceLastInteraction } = params;
  const gap = formatHandshakeGap(hoursSinceLastInteraction);

  const lines: string[] = ["## Continuity Handshake"];
  lines.push(
    `距上次交互已 ${gap}。回答用户问题前，先用一两句自然承接上文，让用户感到被记住，然后正常回答。`,
  );

  const cues: string[] = [];
  if (persona.identity.displayName) {
    cues.push(`用户称呼：${persona.identity.displayName}`);
  }
  if (persona.recentFocus.length > 0) {
    cues.push(`最近关注：${persona.recentFocus.slice(0, 3).join("、")}`);
  }
  if (pendingInsightDelivery) {
    cues.push(
      `有条之前没来得及告诉你的洞察（未送达）：${pendingInsightDelivery.candidate.content}`,
    );
  }

  if (cues.length > 0) {
    lines.push("可承接的线索（选最相关的一条，不要全部列举）：");
    for (const cue of cues) {
      lines.push(`- ${cue}`);
    }
  }

  lines.push(
    "要求：自然简短，不要机械罗列或生硬转折。如果当前问题与历史完全无关，可轻轻一带或省略。",
  );

  return lines.join("\n");
}

export function buildCognitiveModePrompt(params: {
  message: string;
  isHeartbeat?: boolean;
  isCron?: boolean;
  recentModes?: CognitiveMode[];
  cognitiveEnabled?: boolean;
  evolutionEnabled?: boolean;
  persona?: PersonaTree;
  corrections?: CorrectionRecord[];
  /** Optional locale override; defaults to detecting from `persona`. */
  locale?: CognitiveLocale;
  /** Undelivered insight to surface as a handshake cue (distinct from already-delivered insights). */
  pendingInsightDelivery?: PendingInsightDelivery;
  /** Current timestamp (ms); defaults to Date.now(). Used for handshake gap calculation. */
  now?: number;
  /** Continuity handshake config. When enabled and the gap since last interaction exceeds minGapHours, a handshake section is injected. */
  handshakeConfig?: { enabled?: boolean; minGapHours?: number };
}): { prompt: string; classification: ModeClassification } {
  const {
    message,
    isHeartbeat,
    isCron,
    recentModes,
    cognitiveEnabled,
    evolutionEnabled,
    persona,
    corrections,
    locale,
    pendingInsightDelivery,
    now,
    handshakeConfig,
  } = params;

  const classification = classifyMode(message, {
    isHeartbeat,
    isCron,
    recentModes,
  });

  if (cognitiveEnabled === false) {
    return { prompt: "", classification };
  }

  const resolvedLocale = locale ?? detectCognitiveLocale(persona) ?? DEFAULT_COGNITIVE_LOCALE;

  const parts: string[] = [];

  if (persona) {
    const personaCtx = buildPersonaContext(persona);
    if (personaCtx) {
      parts.push(personaCtx);
    }

    const phase = getInteractionPhase(persona.rapport.trustScore);
    const advice = getPhaseBehaviorAdvice(phase);
    if (advice) {
      parts.push(`## Interaction Guidance\n${advice}`);
    }
  }

  if (persona && persona.lifecycle.lastActiveAt > 0 && handshakeConfig?.enabled !== false) {
    const currentTime = now ?? Date.now();
    const minGap = handshakeConfig?.minGapHours ?? 6;
    const hoursSinceLastInteraction = (currentTime - persona.lifecycle.lastActiveAt) / 3_600_000;
    if (hoursSinceLastInteraction >= minGap) {
      parts.push(
        buildHandshakeSection({
          persona,
          pendingInsightDelivery: pendingInsightDelivery ?? null,
          hoursSinceLastInteraction,
        }),
      );
    }
  }

  if (evolutionEnabled !== false) {
    parts.push(buildSkillEvolutionSection(resolvedLocale));
  }

  if (corrections && corrections.length > 0) {
    const selected = selectRelevantCorrections(corrections, message);
    if (selected.length > 0) {
      parts.push(formatCorrectionsPrompt(selected, resolvedLocale));
    }
  }

  parts.push(buildModePromptSection(classification.mode));

  return { prompt: parts.join("\n\n"), classification };
}
