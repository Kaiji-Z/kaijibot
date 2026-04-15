import { Type } from "@sinclair/typebox";
import type { KaijiBotConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, textResult } from "./common.js";
import { stringEnum } from "../schema/typebox.js";

export const CognitiveFeedbackSchema = Type.Object({
  targetId: Type.String({ description: "The message or insight ID this feedback refers to" }),
  sentiment: stringEnum(["positive", "negative", "neutral"] as const, { description: "User's sentiment toward the target" }),
  topic: Type.Optional(Type.String({ description: "The domain or topic this feedback relates to" })),
  textResponse: Type.Optional(Type.String({ description: "Optional free-text feedback" })),
});

export function createCognitiveFeedbackTool(deps: {
  config?: KaijiBotConfig;
  sessionKey?: string;
}): AnyAgentTool | null {
  if (deps.config?.cognitive?.enabled === false) return null;

  return {
    name: "cognitive_feedback",
    label: "Cognitive Feedback",
    description:
      "Collect explicit feedback about the AI's responses and insights. Use this when the user explicitly reacts (positive, negative, or neutral) to a response or insight.",
    parameters: CognitiveFeedbackSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as {
        targetId: string;
        sentiment: string;
        topic?: string;
        textResponse?: string;
      };

      try {
        const { processFeedback } = await import("../../cognitive/feedback/collector.js");
        const { PersonaStore } = await import("../../cognitive/persona/store.js");
        const { resolveConfigDir } = await import("../../utils.js");

        const store = new PersonaStore(resolveConfigDir());
        // TUI/admin sessions have no senderId → skip persona extraction
        const userId = deps.sessionKey?.split(":").pop();
        if (!userId || userId === "main") {
          return textResult(
            "No user profile found; feedback stored but not applied to profile.",
            { status: "no_profile", sentiment: params.sentiment, topic: params.topic },
          );
        }

        const persona = await store.load("main", userId);
        if (!persona) {
          return textResult(
            "No user profile found; feedback stored but not applied to profile.",
            { status: "no_profile", sentiment: params.sentiment, topic: params.topic },
          );
        }

        const feedback = {
          targetId: params.targetId,
          type: params.sentiment === "positive"
            ? "positive" as const
            : params.sentiment === "negative"
              ? "negative" as const
              : "neutral" as const,
          mechanism: "text" as const,
          topic: params.topic,
          timestamp: Date.now(),
          textResponse: params.textResponse,
        };

        const updated = processFeedback(persona, feedback);
        await store.save("main", userId, updated);

        return jsonResult({
          status: "recorded",
          sentiment: params.sentiment,
          topic: params.topic,
          trustScore: updated.rapport.trustScore.toFixed(2),
        });
      } catch (err) {
        return textResult(
          `Feedback acknowledged but could not persist: ${String(err)}`,
          { status: "error" },
        );
      }
    },
  };
}
