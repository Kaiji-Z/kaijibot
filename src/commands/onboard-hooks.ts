import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { KaijiBotConfig } from "../config/config.js";
import { buildWorkspaceHookStatus } from "../hooks/hooks-status.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

export async function setupInternalHooks(
  cfg: KaijiBotConfig,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<KaijiBotConfig> {
  // Discover available hooks using the hook discovery system
  const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  const report = buildWorkspaceHookStatus(workspaceDir, { config: cfg });

  const eligibleHooks = report.hooks.filter((h) => h.loadable);

  if (eligibleHooks.length === 0) {
    return cfg;
  }

  // Auto-enable all eligible hooks — bundled hooks are core functionality.
  const entries = { ...cfg.hooks?.internal?.entries };
  const names: string[] = [];
  for (const hook of eligibleHooks) {
    entries[hook.name] = { enabled: true };
    names.push(hook.name);
  }

  const next: KaijiBotConfig = {
    ...cfg,
    hooks: {
      ...cfg.hooks,
      internal: {
        enabled: true,
        entries,
      },
    },
  };

  await prompter.note(
    [
      `Enabled ${names.length} hook${names.length > 1 ? "s" : ""}: ${names.join(", ")}`,
      "",
      "You can manage hooks later with:",
      `  ${formatCliCommand("kaijibot hooks list")}`,
      `  ${formatCliCommand("kaijibot hooks enable <name>")}`,
      `  ${formatCliCommand("kaijibot hooks disable <name>")}`,
    ].join("\n"),
    "Hooks Configured",
  );

  return next;
}
