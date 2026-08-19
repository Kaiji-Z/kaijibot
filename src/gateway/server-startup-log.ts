import chalk from "chalk";
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  MissingAgentModelConfigError,
} from "../agents/defaults.js";
import { resolveConfiguredModelRef } from "../agents/model-selection.js";
import type { loadConfig } from "../config/config.js";
import { getResolvedLoggerSettings } from "../logging.js";
import { collectEnabledInsecureOrDangerousFlags } from "../security/dangerous-config-flags.js";

export function logGatewayStartup(params: {
  cfg: ReturnType<typeof loadConfig>;
  bindHost: string;
  bindHosts?: string[];
  port: number;
  pluginCount: number;
  startupStartedAt?: number;
  tlsEnabled?: boolean;
  log: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string) => void };
  isNixMode: boolean;
}) {
  // `gateway --allow-unconfigured` (the Docker image default CMD) must boot
  // without an agent model; degrade the banner instead of aborting startup.
  let modelRef: string | null = null;
  try {
    const { provider: agentProvider, model: agentModel } = resolveConfiguredModelRef({
      cfg: params.cfg,
      defaultProvider: DEFAULT_PROVIDER,
      defaultModel: DEFAULT_MODEL,
    });
    modelRef = `${agentProvider}/${agentModel}`;
  } catch (err) {
    if (!(err instanceof MissingAgentModelConfigError)) {
      throw err;
    }
  }
  if (modelRef) {
    params.log.info(`agent model: ${modelRef}`, {
      consoleMessage: `agent model: ${chalk.whiteBright(modelRef)}`,
    });
  } else {
    params.log.warn(
      "agent model: not configured — set `agents.defaults.model.primary` in kaijibot.json or run `kaijibot onboard`",
    );
  }
  const startupDurationMs =
    typeof params.startupStartedAt === "number" ? Date.now() - params.startupStartedAt : null;
  const startupDurationLabel =
    startupDurationMs == null ? null : `${(startupDurationMs / 1000).toFixed(1)}s`;
  params.log.info(
    `ready (${params.pluginCount} ${params.pluginCount === 1 ? "plugin" : "plugins"}${startupDurationLabel ? `, ${startupDurationLabel}` : ""})`,
  );
  params.log.info(`log file: ${getResolvedLoggerSettings().file}`);
  if (params.isNixMode) {
    params.log.info("gateway: running in Nix mode (config managed externally)");
  }

  const enabledDangerousFlags = collectEnabledInsecureOrDangerousFlags(params.cfg);
  if (enabledDangerousFlags.length > 0) {
    const warning =
      `security warning: dangerous config flags enabled: ${enabledDangerousFlags.join(", ")}. ` +
      "Run `kaijibot security audit`.";
    params.log.warn(warning);
  }
}
