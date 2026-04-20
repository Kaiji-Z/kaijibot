import { Type } from "@sinclair/typebox";
import type { KaijiBotConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, textResult } from "./common.js";

export const EvolutionPatchSchema = Type.Object({
  name: Type.String({ description: "Name of the existing skill to patch" }),
  instructions: Type.String({ description: "Natural-language instructions for what to change" }),
  replacements: Type.Optional(
    Type.Array(
      Type.Object({
        oldText: Type.String(),
        newText: Type.String(),
      }),
      { description: "Specific old→new text replacements" },
    ),
  ),
});

export function createEvolutionPatchTool(deps: {
  config?: KaijiBotConfig;
}): AnyAgentTool | null {
  if (deps.config?.cognitive?.enabled === false) return null;
  if (deps.config?.cognitive?.evolution?.enabled === false) return null;

  return {
    name: "patch_skill",
    label: "Patch Skill",
    description:
      "Update an existing skill with patch instructions. Use when the user wants to modify, fix, or improve a skill that was already created.",
    parameters: EvolutionPatchSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as {
        name: string;
        instructions: string;
        replacements?: Array<{ oldText: string; newText: string }>;
      };

      try {
        const { EvolutionEngine } = await import("../../cognitive/evolution/engine.js");
        const { EvolutionStore } = await import("../../cognitive/evolution/store.js");
        const { SkillPersistenceWriter } = await import("../../cognitive/evolution/skill-writer.js");
        const { resolveConfigDir } = await import("../../utils.js");

        const configDir = resolveConfigDir();
        const store = new EvolutionStore(configDir);
        const writer = new SkillPersistenceWriter(configDir);
        const engine = new EvolutionEngine(store);

        const result = await engine.patchSkill(
          {
            name: params.name,
            instructions: params.instructions,
            replacements: params.replacements,
          },
          { writer },
        );

        if (!result.ok) {
          return jsonResult({ status: "error", error: result.error });
        }

        return jsonResult({
          status: "patched",
          skillName: params.name,
          updatedPath: result.updatedPath,
        });
      } catch (err) {
        return textResult(
          `Skill patch failed: ${String(err)}`,
          { status: "error" },
        );
      }
    },
  };
}
