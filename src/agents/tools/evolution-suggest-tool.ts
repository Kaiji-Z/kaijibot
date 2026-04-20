import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { KaijiBotConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, textResult } from "./common.js";

export const EvolutionSuggestSchema = Type.Object({
  taskSummary: Type.String({ description: "Short summary of the completed task" }),
  toolCalls: Type.Array(Type.String(), { description: "Ordered list of tool calls made during the task" }),
  uniqueToolCount: Type.Number({ description: "Number of distinct tools used" }),
  reasoningTurns: Type.Number({ description: "Number of agent reasoning turns" }),
  durationMs: Type.Number({ description: "Wall-clock time in milliseconds" }),
  domain: Type.String({ description: "Cognitive domain (e.g. 'feishu-wiki', 'code-review')" }),
  transcript: Type.Optional(Type.String({ description: "Optional conversation transcript summary for richer context" })),
  hasTrialAndError: Type.Optional(Type.Boolean({ description: "Whether trial-and-error patterns were detected" })),
  userCorrections: Type.Optional(Type.Number({ description: "Number of user corrections during the task" })),
});

export function createEvolutionSuggestTool(deps: {
  config?: KaijiBotConfig;
  sessionKey?: string;
}): AnyAgentTool | null {
  if (deps.config?.cognitive?.enabled === false) return null;
  if (deps.config?.cognitive?.evolution?.enabled === false) return null;

  return {
    name: "evaluate_skill_evolution",
    label: "Evaluate Skill Evolution",
    description:
      "Evaluate whether a completed complex task should be preserved as a reusable Skill. Call this after completing multi-step tasks that involved multiple tools or took significant time. The engine decides whether to suggest a skill to the user.",
    parameters: EvolutionSuggestSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as {
        taskSummary: string;
        toolCalls: string[];
        uniqueToolCount: number;
        reasoningTurns: number;
        durationMs: number;
        domain: string;
        transcript?: string;
        hasTrialAndError?: boolean;
        userCorrections?: number;
      };

      try {
        const { EvolutionEngine } = await import("../../cognitive/evolution/engine.js");
        const { EvolutionStore } = await import("../../cognitive/evolution/store.js");
        const { resolveConfigDir } = await import("../../utils.js");

        const store = new EvolutionStore(resolveConfigDir());
        const engine = new EvolutionEngine(store);

        const userId = deps.sessionKey?.split(":").pop();
        if (!userId || userId === "main") {
          return textResult("No user session; evolution evaluation skipped.", { status: "no_session" });
        }

        const candidate = {
          taskSummary: params.taskSummary,
          toolCalls: params.toolCalls,
          uniqueToolCount: params.uniqueToolCount,
          reasoningTurns: params.reasoningTurns,
          durationMs: params.durationMs,
          domain: params.domain,
          transcript: params.transcript,
          hasTrialAndError: params.hasTrialAndError,
          userCorrections: params.userCorrections,
        };

        const decision = await engine.evaluate(candidate, userId);

        if (!decision.shouldSuggest) {
          return jsonResult({
            status: "skipped",
            reason: decision.reasoning,
            complexityScore: decision.complexityScore,
          });
        }

        const draft = await engine.generate(candidate);

        const record = {
          id: randomUUID(),
          userId,
          candidate,
          decision,
          draft,
          timestamp: Date.now(),
        };
        await store.save(record);

        return jsonResult({
          status: "suggested",
          complexityScore: decision.complexityScore,
          confidence: decision.confidence,
          skillName: draft.name,
          description: draft.description,
          triggerPhrases: draft.triggerPhrases,
          bodyMarkdown: draft.bodyMarkdown,
          suggestionText: `刚才帮你完成了「${params.taskSummary}」（用了 ${params.toolCalls.length} 个工具，经历了 ${params.reasoningTurns} 轮推理）。这个流程比较复杂，下次遇到类似问题可以直接套用。我已经帮你起草了一个技能「${draft.name}」，你看看有没有要调整的？`,
        });
      } catch (err) {
        return textResult(
          `Evolution evaluation failed: ${String(err)}`,
          { status: "error" },
        );
      }
    },
  };
}
