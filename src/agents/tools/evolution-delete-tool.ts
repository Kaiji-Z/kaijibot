import { Type } from "typebox";
import type { KaijiBotConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, textResult } from "./common.js";

export const EvolutionDeleteSchema = Type.Object({
  name: Type.String({ description: "Name of the skill to delete permanently" }),
  confirm: Type.Boolean({
    description: "Must be true to confirm deletion. Refuses otherwise.",
  }),
});

export function createEvolutionDeleteTool(deps: {
  config?: KaijiBotConfig;
  sessionKey?: string;
}): AnyAgentTool | null {
  if (deps.config?.cognitive?.enabled === false) {
    return null;
  }
  if (deps.config?.cognitive?.evolution?.enabled === false) {
    return null;
  }

  return {
    name: "delete_skill",
    label: "Delete Skill",
    description:
      "Delete a skill permanently. Requires an explicit confirmation (confirm: true). " +
      "Use only when the user clearly asks to remove a skill that was created earlier.",
    parameters: EvolutionDeleteSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as { name: string; confirm?: boolean };

      if (params.confirm !== true) {
        return textResult("Deletion requires confirm: true to proceed.", {
          status: "confirm_required",
        });
      }

      try {
        const { SkillPersistenceWriter } =
          await import("../../cognitive/evolution/skill-writer.js");
        const { resolveConfigDir } = await import("../../utils.js");

        const configDir = resolveConfigDir();

        let skillBaseDir = configDir;
        if (deps.config) {
          const { resolveAgentIdFromSessionKey } = await import("../../routing/session-key.js");
          const { resolveAgentWorkspaceDir } = await import("../agent-scope.js");
          const agentId = resolveAgentIdFromSessionKey(deps.sessionKey);
          skillBaseDir = resolveAgentWorkspaceDir(deps.config, agentId);
        }

        const writer = new SkillPersistenceWriter(skillBaseDir);
        await writer.removeSkill(params.name);

        try {
          const { AuditLog } = await import("../../cognitive/evolution/audit-log.js");
          const audit = new AuditLog(configDir);
          await audit.append({
            operation: "skill.delete",
            actor: deps.sessionKey ?? "agent",
            target: params.name,
            outcome: "success",
          });
        } catch {
          /* non-fatal */
        }

        return jsonResult({
          status: "deleted",
          skillName: params.name,
        });
      } catch (err) {
        return textResult(`Skill deletion failed: ${String(err)}`, { status: "error" });
      }
    },
  };
}
