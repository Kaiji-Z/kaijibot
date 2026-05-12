import { Type } from "@sinclair/typebox";
import type { SoulPreset } from "../../config/types.soul.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, textResult } from "./common.js";

export const SwitchSoulSchema = Type.Object({
  preset: Type.String({
    description:
      "MBTI soul preset key (e.g. 'intj', 'entp', 'infj'). Use 'default' to remove the preset.",
  }),
});

const SOUL_PRESET_NAMES: Record<string, string> = {
  intj: "建筑师 (Architect)",
  intp: "逻辑学家 (Logician)",
  entj: "指挥官 (Commander)",
  entp: "辩论家 (Debater)",
  infj: "提倡者 (Advocate)",
  infp: "调停者 (Mediator)",
  enfj: "主人公 (Protagonist)",
  enfp: "竞选者 (Campaigner)",
  istj: "物流师 (Logistician)",
  isfj: "守卫者 (Defender)",
  estj: "总经理 (Executive)",
  esfj: "执政官 (Consul)",
  istp: "鉴赏家 (Virtuoso)",
  isfp: "探险家 (Adventurer)",
  estp: "企业家 (Entrepreneur)",
  esfp: "表演者 (Entertainer)",
};

export function createSwitchSoulTool(): AnyAgentTool {
  return {
    name: "switch_soul",
    label: "Switch Soul Preset",
    description:
      "切换灵魂预设。当用户要求改变你的性格或切换灵魂时使用。" +
      "可用的预设: intj, intp, entj, entp, infj, infp, enfj, enfp, istj, isfj, estj, esfj, istp, isfp, estp, esfp。" +
      "传入 'default' 恢复默认灵魂。",
    parameters: SwitchSoulSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as { preset: string };
      const preset = params.preset.toLowerCase().trim();

      try {
        const { readConfigFileSnapshot, replaceConfigFile } = await import(
          "../../config/config.js"
        );
        const { clearAllBootstrapSnapshots } = await import("../bootstrap-cache.js");

        if (preset === "default" || preset === "none" || preset === "reset") {
          const snapshot = await readConfigFileSnapshot();
          const sourceConfig = { ...snapshot.sourceConfig };
          delete sourceConfig.soul;
          await replaceConfigFile({ nextConfig: sourceConfig });
          clearAllBootstrapSnapshots();

          return jsonResult({
            status: "reset",
            message: "灵魂预设已移除，下一条消息起恢复默认灵魂。",
          });
        }

        if (!SOUL_PRESET_NAMES[preset]) {
          const validKeys = Object.keys(SOUL_PRESET_NAMES).join(", ");
          return textResult(
            `Unknown soul preset: "${preset}". Valid presets: ${validKeys}`,
            { status: "invalid" },
          );
        }

        const snapshot = await readConfigFileSnapshot();
        const sourceConfig = { ...snapshot.sourceConfig };
        sourceConfig.soul = { ...sourceConfig.soul, preset: preset as SoulPreset };
        await replaceConfigFile({ nextConfig: sourceConfig });
        clearAllBootstrapSnapshots();

        const name = SOUL_PRESET_NAMES[preset];
        return jsonResult({
          status: "switched",
          preset,
          name,
          message: `灵魂预设已切换为 ${preset.toUpperCase()} — ${name}。下一条消息起生效。`,
        });
      } catch (err) {
        return textResult(`Soul switch failed: ${String(err)}`, { status: "error" });
      }
    },
  };
}
