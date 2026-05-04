import { Type } from "@sinclair/typebox";
import type { KaijiBotConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, textResult } from "./common.js";

export const EvolutionArchiveSchema = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("recover")], {
    description: "'list' to show archived skills, 'recover' to restore one",
  }),
  name: Type.Optional(Type.String({ description: "Skill name to recover (required for 'recover' action)" })),
});

export function createEvolutionArchiveTool(deps: {
  config?: KaijiBotConfig;
  sessionKey?: string;
}): AnyAgentTool | null {
  if (deps.config?.cognitive?.enabled === false) return null;
  if (deps.config?.cognitive?.evolution?.enabled === false) return null;

  return {
    name: "manage_archived_skills",
    label: "Manage Archived Skills",
    description:
      "List or recover archived evolution-generated skills. Use 'list' to see archived skills, " +
      "'recover' to restore one. Archived skills were auto-removed because they were unused for 30+ days.",
    parameters: EvolutionArchiveSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as { action: "list" | "recover" | "remove"; name?: string };

      try {
        const { SkillPersistenceWriter } = await import("../../cognitive/evolution/skill-writer.js");
        const { resolveConfigDir } = await import("../../utils.js");

        let skillBaseDir = resolveConfigDir();
        if (deps.config) {
          const { resolveAgentIdFromSessionKey } = await import("../../routing/session-key.js");
          const { resolveAgentWorkspaceDir } = await import("../../agents/agent-scope.js");
          const agentId = resolveAgentIdFromSessionKey(deps.sessionKey);
          skillBaseDir = resolveAgentWorkspaceDir(deps.config, agentId);
        }

        const writer = new SkillPersistenceWriter(skillBaseDir);

        if (params.action === "list") {
          const names = await writer.listArchivedSkillNames();
          const skills = [];
          for (const name of names) {
            const meta = await writer.readArchivedSkillMeta(name);
            if (meta) skills.push({ name: meta.name, description: meta.description });
          }
          return jsonResult({
            status: "listed",
            archivedSkills: skills,
            count: skills.length,
          });
        }

        if (params.action === "recover") {
          if (!params.name) {
            return textResult("Skill name is required for recover action.", { status: "error" });
          }
          const recoveredPath = await writer.recoverSkill(params.name);
          return jsonResult({
            status: "recovered",
            skillName: params.name,
            recoveredPath,
          });
        }

        return textResult("Unknown action.", { status: "error" });
      } catch (err) {
        return textResult(
          `Archive operation failed: ${String(err)}`,
          { status: "error" },
        );
      }
    },
  };
}
