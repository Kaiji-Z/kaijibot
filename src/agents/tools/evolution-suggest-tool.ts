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
  deliveryTo?: string;
}): AnyAgentTool | null {
  if (deps.config?.cognitive?.enabled === false) return null;
  if (deps.config?.cognitive?.evolution?.enabled === false) return null;

  return {
    name: "evaluate_skill_evolution",
    label: "Evaluate Skill Evolution",
    description:
      "Evaluate whether a completed complex task should be preserved as a reusable Skill. " +
      "When you see an [Evolution Signal] system event, call this tool to generate a skill draft. " +
      "You can also call it proactively after complex tasks. The engine evaluates complexity and generates a skill draft. " +
      "If suggested, present the draft to the user naturally. If they want to modify an existing skill, use patch_skill instead.",
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
        const { consumeToolErrorProfile } = await import("../tool-error-summary.js");

        const store = new EvolutionStore(resolveConfigDir());

        let engine: InstanceType<typeof import("../../cognitive/evolution/engine.js").EvolutionEngine>;
        try {
          if (deps.config) {
            const { createStandaloneGenerateText } = await import("../../cognitive/evolution/standalone-generate.js");
            const { generateSkillDraftLLM } = await import("../../cognitive/evolution/llm-draft-generator.js");
            const generateText = await createStandaloneGenerateText(deps.config, { maxTokens: 4000, timeout: 60_000 });
            engine = new EvolutionEngine(store, undefined, undefined, (c) => generateSkillDraftLLM(c, { generateText }));
          } else {
            engine = new EvolutionEngine(store);
          }
        } catch {
          // Falls back to deterministic draft generation.
          engine = new EvolutionEngine(store);
        }

        const userId = resolveUserId(deps.sessionKey, deps.deliveryTo);
        if (!userId) {
          return textResult("No user session; evolution evaluation skipped.", { status: "no_session" });
        }

        const errorProfile = deps.sessionKey
          ? consumeToolErrorProfile(deps.sessionKey)
          : undefined;

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
          errorProfile,
        };

        const decision = await engine.evaluate(candidate, userId);

        if (!decision.shouldSuggest) {
          return jsonResult({
            status: "skipped",
            reason: decision.reasoning,
            complexityScore: decision.complexityScore,
            recentSuggestions: decision.recentSuggestions,
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
          recentSuggestions: decision.recentSuggestions,
          suggestionText: `这个任务用了 ${params.toolCalls.length} 个工具、${params.reasoningTurns} 轮推理，比较复杂。我起草了一个技能「${draft.name}」—— ${draft.description}。要不要保存？要调整的话告诉我怎么改。`,
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

function resolveUserId(sessionKey?: string, deliveryTo?: string): string | null {
  if (deliveryTo) {
    const stripped = deliveryTo.replace(/^(user:|feishu:)/, "");
    if (stripped && stripped !== "main") return stripped;
  }
  if (!sessionKey) return null;
  const tail = sessionKey.split(":").pop();
  if (!tail || tail === "main") return null;
  return tail;
}
