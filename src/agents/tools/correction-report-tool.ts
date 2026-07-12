import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { t } from "../../cli/i18n/translate.js";
import { resolveCorrectionUserId } from "../../cognitive/correction/userid.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, textResult } from "./common.js";

const log = createSubsystemLogger("correction-tool");

export const RecordCorrectionSchema = Type.Object({
  domain: Type.String({ description: "Cognitive domain (e.g. 'feishu-doc', 'code-review')" }),
  trigger: Type.String({
    description: "When this correction applies (e.g. 'when creating Feishu docs')",
  }),
  mistake: Type.String({ description: "What was done wrong" }),
  correction: Type.String({ description: "The correct approach" }),
});

export function createCorrectionReportTool(deps: {
  config?: KaijiBotConfig;
  sessionKey?: string;
  deliveryTo?: string;
  agentId?: string;
}): AnyAgentTool | null {
  if (deps.config?.cognitive?.enabled === false) {
    return null;
  }

  return {
    name: "record_correction",
    label: "Record Correction",
    description: t("cli.tool.correction.description"),
    parameters: RecordCorrectionSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as {
        domain: string;
        trigger: string;
        mistake: string;
        correction: string;
      };

      try {
        const userId = resolveCorrectionUserId(deps.sessionKey, deps.deliveryTo);
        if (!userId) {
          return textResult("No user session; correction not recorded.", { status: "no_session" });
        }

        log.info("correction recorded", {
          userId,
          domain: params.domain,
          agentId: deps.agentId ?? "main",
        });

        const { CorrectionStore } = await import("../../cognitive/correction/store.js");
        const { resolveConfigDir } = await import("../../utils.js");

        const store = new CorrectionStore(resolveConfigDir());
        const record = {
          id: randomUUID(),
          domain: params.domain.toLowerCase().trim(),
          trigger: params.trigger,
          mistake: params.mistake,
          correction: params.correction,
          provenance: "self" as const,
          reinforcedCount: 0,
          createdAt: Date.now(),
          lastReinforced: Date.now(),
        };

        const result = await store.addOrReinforce(deps.agentId ?? "main", userId, record);

        if (result === "reinforced") {
          return jsonResult({
            status: "reinforced",
            id: record.id,
            domain: record.domain,
            message: t("cli.tool.correction.reinforcedMessage"),
          });
        }

        return jsonResult({
          status: "saved",
          id: record.id,
          domain: record.domain,
          message: t("cli.tool.correction.savedMessage"),
        });
      } catch (err) {
        return textResult(`Correction recording failed: ${String(err)}`, { status: "error" });
      }
    },
  };
}
