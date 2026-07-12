import { Type } from "typebox";
import { t } from "../../cli/i18n/translate.js";
import { removeSoulFromConfig, setSoulInConfig } from "../../config/soul-config-helpers.js";
import type { SoulPreset } from "../../config/types.soul.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, textResult } from "./common.js";

export const SwitchSoulSchema = Type.Object({
  preset: Type.String({
    description:
      "MBTI soul preset key (e.g. 'intj', 'entp', 'infj'). Use 'default' to remove the preset.",
  }),
});

function soulPresetName(preset: string): string {
  return t(`cli.soul.preset.${preset}`);
}

export function createSwitchSoulTool(opts?: { agentId?: string }): AnyAgentTool {
  const agentId = opts?.agentId;
  return {
    name: "switch_soul",
    label: "Switch Soul Preset",
    description: t("cli.tool.soul.description"),
    parameters: SwitchSoulSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as { preset: string };
      const preset = params.preset.toLowerCase().trim();

      try {
        const { readConfigFileSnapshot, replaceConfigFile } =
          await import("../../config/config.js");
        const { clearAllBootstrapSnapshots } = await import("../bootstrap-cache.js");

        if (!agentId) {
          return textResult("switch_soul requires an agentId (session context).", {
            status: "error",
          });
        }

        if (preset === "default" || preset === "none" || preset === "reset") {
          const snapshot = await readConfigFileSnapshot();
          const sourceConfig = { ...snapshot.sourceConfig };
          removeSoulFromConfig(sourceConfig, agentId);
          await replaceConfigFile({ nextConfig: sourceConfig });
          clearAllBootstrapSnapshots();

          return jsonResult({
            status: "reset",
            message: t("cli.tool.soul.resetMessage"),
          });
        }

        const validPresets = [
          "intj",
          "intp",
          "entj",
          "entp",
          "infj",
          "infp",
          "enfj",
          "enfp",
          "istj",
          "isfj",
          "estj",
          "esfj",
          "istp",
          "isfp",
          "estp",
          "esfp",
        ];
        if (!validPresets.includes(preset)) {
          return textResult(
            `Unknown soul preset: "${preset}". Valid presets: ${validPresets.join(", ")}`,
            { status: "invalid" },
          );
        }

        const snapshot = await readConfigFileSnapshot();
        const sourceConfig = { ...snapshot.sourceConfig };
        setSoulInConfig(sourceConfig, agentId, preset as SoulPreset);
        await replaceConfigFile({ nextConfig: sourceConfig });
        clearAllBootstrapSnapshots();

        const name = soulPresetName(preset);
        return jsonResult({
          status: "switched",
          preset,
          name,
          message: t("cli.tool.soul.switchedMessage", {
            preset: preset.toUpperCase(),
            name,
          }),
        });
      } catch (err) {
        return textResult(`Soul switch failed: ${String(err)}`, { status: "error" });
      }
    },
  };
}
