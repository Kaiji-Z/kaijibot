import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { resolveCorrectionUserId } from "../../cognitive/correction/userid.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, textResult } from "./common.js";

const log = createSubsystemLogger("correction-tool");

export const RecordCorrectionSchema = Type.Object({
  domain: Type.String({ description: "Cognitive domain (e.g. 'feishu-doc', 'code-review')" }),
  trigger: Type.String({ description: "When this correction applies (e.g. '创建飞书文档')" }),
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
    description:
      "当你发现自己犯了错误并纠正了，或者用户指出了你的错误，调用此工具记录纠正。" +
      "记录的纠正会在未来的对话中自动注入系统提示，帮助你避免重复同样的错误。" +
      "不需要每次都调用——只在犯实质性错误时记录。",
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
            message: "已强化已有的纠错记录，下次对话会自动提醒。",
          });
        }

        return jsonResult({
          status: "saved",
          id: record.id,
          domain: record.domain,
          message: "已记录纠错，下次对话会自动提醒避免此错误。",
        });
      } catch (err) {
        return textResult(`Correction recording failed: ${String(err)}`, { status: "error" });
      }
    },
  };
}
