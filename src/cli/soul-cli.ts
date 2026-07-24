import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { readConfigFileSnapshot, replaceConfigFile } from "../config/config.js";
import { removeSoulFromConfig, setSoulInConfig } from "../config/soul-config-helpers.js";
import { SOUL_PRESETS, type SoulPreset } from "../config/types.soul.js";
import { danger } from "../globals.js";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";
import { t } from "./i18n/translate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = existsSync(join(__dirname, "soul-presets"))
  ? join(__dirname, "soul-presets")
  : join(__dirname, "..", "soul-presets");

function soulPresetName(preset: SoulPreset): string {
  return t(`cli.soul.preset.${preset}`);
}

type MutableConfig = Record<string, unknown> & {
  agents?: {
    list?: Array<{ id: string; soul?: { preset?: SoulPreset } }>;
  };
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

function resolveCurrentPreset(config: MutableConfig, agentId: string): SoulPreset | undefined {
  const entry = config.agents?.list?.find((e) => e.id.toLowerCase() === agentId.toLowerCase());
  return entry?.soul?.preset;
}

async function resolveEffectiveAgentId(
  sourceConfig: MutableConfig,
  agentId?: string,
): Promise<string> {
  if (agentId) {
    return agentId;
  }
  return resolveDefaultAgentId(sourceConfig as Parameters<typeof resolveDefaultAgentId>[0]);
}

async function runSoulList(agentId?: string): Promise<void> {
  const snapshot = await readConfigFileSnapshot();
  const effectiveAgentId = await resolveEffectiveAgentId(
    snapshot.sourceConfig as MutableConfig,
    agentId,
  );
  const currentPreset = resolveCurrentPreset(
    snapshot.sourceConfig as MutableConfig,
    effectiveAgentId,
  );

  for (const key of SOUL_PRESETS) {
    const name = soulPresetName(key);
    const isCurrent = key === currentPreset;
    const prefix = isCurrent ? theme.accent("→") : " ";
    const suffix = isCurrent ? ` ${theme.muted("(current)")}` : "";
    defaultRuntime.log(
      `  ${prefix} ${theme.heading(key.toUpperCase().padEnd(4))}  ${name}${suffix}`,
    );
  }
  defaultRuntime.log("");
  defaultRuntime.log(
    `Use ${theme.command(`kaijibot soul set <type> --agent ${effectiveAgentId}`)} to select a soul preset.`,
  );
  defaultRuntime.log(
    `Use ${theme.command(`kaijibot soul unset --agent ${effectiveAgentId}`)} to revert to the default SOUL.md.`,
  );
}

async function runSoulGet(agentId?: string): Promise<void> {
  const snapshot = await readConfigFileSnapshot();
  const effectiveAgentId = await resolveEffectiveAgentId(
    snapshot.sourceConfig as MutableConfig,
    agentId,
  );
  const currentPreset = resolveCurrentPreset(
    snapshot.sourceConfig as MutableConfig,
    effectiveAgentId,
  );

  if (!currentPreset) {
    defaultRuntime.log("No soul preset is currently active. Using default SOUL.md.");
    return;
  }

  const name = soulPresetName(currentPreset);
  defaultRuntime.log(
    `Current soul preset: ${theme.heading(currentPreset.toUpperCase())} — ${theme.success(name)} [agent: ${effectiveAgentId}]`,
  );
  defaultRuntime.log("");
  defaultRuntime.log("--- Preview ---");
  defaultRuntime.log(loadPresetContent(currentPreset));
}

async function runSoulSet(presetInput: string, agentId?: string): Promise<void> {
  const preset = resolvePresetKey(presetInput);
  if (!preset) {
    defaultRuntime.error(
      danger(`Unknown soul preset: "${presetInput}". Valid presets: ${SOUL_PRESETS.join(", ")}`),
    );
    defaultRuntime.exit(1);
    return;
  }

  const snapshot = await readConfigFileSnapshot();
  const sourceConfig = { ...snapshot.sourceConfig } as MutableConfig;
  const effectiveAgentId = await resolveEffectiveAgentId(sourceConfig, agentId);
  setSoulInConfig(sourceConfig, effectiveAgentId, preset);

  await replaceConfigFile({ nextConfig: sourceConfig });

  const name = soulPresetName(preset);
  defaultRuntime.log(
    `Soul preset set to ${theme.heading(preset.toUpperCase())} — ${theme.success(name)} [agent: ${effectiveAgentId}]`,
  );
  defaultRuntime.log("");
  defaultRuntime.log("Change takes effect on the next message (hot-reload).");
}

async function runSoulUnset(agentId?: string): Promise<void> {
  const snapshot = await readConfigFileSnapshot();
  const sourceConfig = { ...snapshot.sourceConfig } as MutableConfig;
  const effectiveAgentId = await resolveEffectiveAgentId(sourceConfig, agentId);

  const currentPreset = resolveCurrentPreset(sourceConfig, effectiveAgentId);
  if (!currentPreset) {
    defaultRuntime.log("No soul preset is currently active.");
    return;
  }

  removeSoulFromConfig(sourceConfig, effectiveAgentId);
  await replaceConfigFile({ nextConfig: sourceConfig });

  defaultRuntime.log(
    `Soul preset removed [agent: ${effectiveAgentId}]. Reverted to default SOUL.md.`,
  );
  defaultRuntime.log("");
  defaultRuntime.log("Change takes effect on the next message (hot-reload).");
}

export function registerSoulCli(program: Command) {
  const soul = program
    .command("soul")
    .description("Manage soul presets (MBTI-based personality profiles)")
    .option("--agent <id>", "Target a specific agent (default: resolved from config)")
    .action(async (opts: { agent?: string }) => {
      await runSoulList(opts.agent);
    });

  soul
    .command("list")
    .description("List all available soul presets")
    .option("--agent <id>", "Target a specific agent")
    .action(async (opts: { agent?: string }) => {
      await runSoulList(opts.agent);
    });

  soul
    .command("get")
    .description("Show the currently active soul preset")
    .option("--agent <id>", "Target a specific agent")
    .action(async (opts: { agent?: string }) => {
      await runSoulGet(opts.agent);
    });

  soul
    .command("set")
    .description("Set the active soul preset (e.g., kaijibot soul set intj)")
    .argument("<type>", "MBTI type (e.g., intj, entp, infj)")
    .option("--agent <id>", "Target a specific agent")
    .action(async (type: string, opts: { agent?: string }) => {
      await runSoulSet(type, opts.agent);
    });

  soul
    .command("unset")
    .description("Remove the soul preset and revert to default SOUL.md")
    .option("--agent <id>", "Target a specific agent")
    .action(async (opts: { agent?: string }) => {
      await runSoulUnset(opts.agent);
    });
}
