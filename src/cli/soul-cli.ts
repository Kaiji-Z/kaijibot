import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfigFileSnapshot, replaceConfigFile } from "../config/config.js";
import { SOUL_PRESETS, type SoulPreset } from "../config/types.soul.js";
import { danger } from "../globals.js";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Build copies presets to dist/soul-presets/ (not dist/cli/soul-presets/),
// so we need to go up one level from __dirname (dist/cli/) to reach dist/soul-presets/.
const PRESETS_DIR = join(__dirname, "..", "soul-presets");

const SOUL_PRESET_NAMES: Record<SoulPreset, string> = {
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

function resolvePresetKey(input: string): SoulPreset | null {
  const lower = input.toLowerCase().trim();
  if (SOUL_PRESETS.includes(lower as SoulPreset)) {
    return lower as SoulPreset;
  }
  return null;
}

function loadPresetContent(preset: SoulPreset): string {
  const filePath = join(PRESETS_DIR, `${preset}.md`);
  return readFileSync(filePath, "utf-8");
}

async function runSoulList(): Promise<void> {
  const snapshot = await readConfigFileSnapshot();
  const currentPreset = snapshot.resolved?.soul?.preset;

  for (const key of SOUL_PRESETS) {
    const name = SOUL_PRESET_NAMES[key];
    const isCurrent = key === currentPreset;
    const prefix = isCurrent ? theme.accent("→") : " ";
    const suffix = isCurrent ? ` ${theme.muted("(current)")}` : "";
    defaultRuntime.log(`  ${prefix} ${theme.heading(key.toUpperCase().padEnd(4))}  ${name}${suffix}`);
  }
  defaultRuntime.log("");
  defaultRuntime.log(`Use ${theme.command("kaijibot soul set <type>")} to select a soul preset.`);
  defaultRuntime.log(`Use ${theme.command("kaijibot soul unset")} to revert to the default SOUL.md.`);
}

async function runSoulGet(): Promise<void> {
  const snapshot = await readConfigFileSnapshot();
  const currentPreset = snapshot.resolved?.soul?.preset;

  if (!currentPreset) {
    defaultRuntime.log("No soul preset is currently active. Using default SOUL.md.");
    return;
  }

  const name = SOUL_PRESET_NAMES[currentPreset];
  defaultRuntime.log(`Current soul preset: ${theme.heading(currentPreset.toUpperCase())} — ${theme.success(name)}`);
  defaultRuntime.log("");
  defaultRuntime.log("--- Preview ---");
  defaultRuntime.log(loadPresetContent(currentPreset));
}

async function runSoulSet(presetInput: string): Promise<void> {
  const preset = resolvePresetKey(presetInput);
  if (!preset) {
    defaultRuntime.error(
      danger(`Unknown soul preset: "${presetInput}". Valid presets: ${SOUL_PRESETS.join(", ")}`),
    );
    defaultRuntime.exit(1);
    return;
  }

  const snapshot = await readConfigFileSnapshot();
  const sourceConfig = { ...snapshot.sourceConfig };
  sourceConfig.soul = { ...sourceConfig.soul, preset: preset as SoulPreset };

  await replaceConfigFile({ nextConfig: sourceConfig });

  const name = SOUL_PRESET_NAMES[preset];
  defaultRuntime.log(`Soul preset set to ${theme.heading(preset.toUpperCase())} — ${theme.success(name)}`);
  defaultRuntime.log("");
  defaultRuntime.log("Change takes effect on the next message (hot-reload).");
}

async function runSoulUnset(): Promise<void> {
  const snapshot = await readConfigFileSnapshot();
  const sourceConfig = { ...snapshot.sourceConfig };

  if (!sourceConfig.soul?.preset) {
    defaultRuntime.log("No soul preset is currently active.");
    return;
  }

  delete sourceConfig.soul;
  await replaceConfigFile({ nextConfig: sourceConfig });

  defaultRuntime.log("Soul preset removed. Reverted to default SOUL.md.");
  defaultRuntime.log("");
  defaultRuntime.log("Change takes effect on the next message (hot-reload).");
}

export function registerSoulCli(program: Command) {
  const soul = program
    .command("soul")
    .description("Manage soul presets (MBTI-based personality profiles)")
    .action(async () => {
      await runSoulList();
    });

  soul
    .command("list")
    .description("List all available soul presets")
    .action(async () => {
      await runSoulList();
    });

  soul
    .command("get")
    .description("Show the currently active soul preset")
    .action(async () => {
      await runSoulGet();
    });

  soul
    .command("set")
    .description("Set the active soul preset (e.g., kaijibot soul set intj)")
    .argument("<type>", "MBTI type (e.g., intj, entp, infj)")
    .action(async (type: string) => {
      await runSoulSet(type);
    });

  soul
    .command("unset")
    .description("Remove the soul preset and revert to default SOUL.md")
    .action(async () => {
      await runSoulUnset();
    });
}
