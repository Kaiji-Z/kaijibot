import type { SoulPreset } from "./types.soul.js";

type MutableConfig = Record<string, unknown> & {
  agents?: {
    list?: Array<{ id: string; soul?: { preset?: SoulPreset } }>;
  };
};

export function setSoulInConfig(
  sourceConfig: MutableConfig,
  agentId: string,
  preset: SoulPreset,
): void {
  if (!sourceConfig.agents) {
    sourceConfig.agents = {};
  }
  if (!Array.isArray(sourceConfig.agents.list)) {
    sourceConfig.agents.list = [];
  }
  const entry = sourceConfig.agents.list.find((e) => e.id.toLowerCase() === agentId.toLowerCase());
  if (entry) {
    entry.soul = { ...entry.soul, preset };
  } else {
    sourceConfig.agents.list.push({ id: agentId, soul: { preset } });
  }
}

export function removeSoulFromConfig(sourceConfig: MutableConfig, agentId: string): void {
  const list = sourceConfig.agents?.list;
  if (!Array.isArray(list)) {
    return;
  }
  const entry = list.find((e) => e.id.toLowerCase() === agentId.toLowerCase());
  if (entry) {
    delete entry.soul;
  }
}
