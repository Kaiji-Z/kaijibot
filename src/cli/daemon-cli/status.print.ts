import { formatConfigIssueLine } from "../../config/issue-format.js";
import {
  resolveGatewayLaunchAgentLabel,
  resolveGatewaySystemdServiceName,
} from "../../daemon/constants.js";
import { renderGatewayServiceCleanupHints } from "../../daemon/inspect.js";
import { resolveGatewayLogPaths } from "../../daemon/launchd.js";
import {
  isSystemdUnavailableDetail,
  renderSystemdUnavailableHints,
} from "../../daemon/systemd-hints.js";
import { classifySystemdUnavailableDetail } from "../../daemon/systemd-unavailable.js";
import { resolveControlUiLinks } from "../../gateway/control-ui-links.js";
import { isWSLEnv } from "../../infra/wsl.js";
import { defaultRuntime } from "../../runtime.js";
import { colorize } from "../../terminal/theme.js";
import { shortenHomePath } from "../../utils.js";
import { formatCliCommand } from "../command-format.js";
import { t } from "../i18n/translate.js";
import {
  createCliStatusTextStyles,
  filterDaemonEnv,
  formatRuntimeStatus,
  resolveDaemonContainerContext,
  resolveRuntimeStatusColor,
  renderRuntimeHints,
  safeDaemonEnv,
} from "./shared.js";
import {
  type DaemonStatus,
  renderPortDiagnosticsForCli,
  resolvePortListeningAddresses,
} from "./status.gather.js";

function sanitizeDaemonStatusForJson(status: DaemonStatus): DaemonStatus {
  const command = status.service.command;
  if (!command?.environment) {
    return status;
  }
  const safeEnv = filterDaemonEnv(command.environment);
  const nextCommand = {
    ...command,
    environment: Object.keys(safeEnv).length > 0 ? safeEnv : undefined,
  };
  return {
    ...status,
    service: {
      ...status.service,
      command: nextCommand,
    },
  };
}

export function printDaemonStatus(status: DaemonStatus, opts: { json: boolean }) {
  if (opts.json) {
    const sanitized = sanitizeDaemonStatusForJson(status);
    defaultRuntime.writeJson(sanitized);
    return;
  }

  const { rich, label, accent, infoText, okText, warnText, errorText } =
    createCliStatusTextStyles();
  const spacer = () => defaultRuntime.log("");

  const { service, rpc, extraServices } = status;
  const serviceStatus = service.loaded
    ? okText(service.loadedText)
    : warnText(service.notLoadedText);
  defaultRuntime.log(
    `${label(t("cli.daemon.label.service"))} ${accent(service.label)} (${serviceStatus})`,
  );
  if (status.logFile) {
    defaultRuntime.log(
      `${label(t("cli.daemon.label.fileLogs"))} ${infoText(shortenHomePath(status.logFile))}`,
    );
  }
  if (service.command?.programArguments?.length) {
    defaultRuntime.log(
      `${label(t("cli.daemon.label.command"))} ${infoText(service.command.programArguments.join(" "))}`,
    );
  }
  if (service.command?.sourcePath) {
    defaultRuntime.log(
      `${label(t("cli.daemon.label.serviceFile"))} ${infoText(shortenHomePath(service.command.sourcePath))}`,
    );
  }
  if (service.command?.workingDirectory) {
    defaultRuntime.log(
      `${label(t("cli.daemon.label.workingDir"))} ${infoText(shortenHomePath(service.command.workingDirectory))}`,
    );
  }
  const daemonEnvLines = safeDaemonEnv(service.command?.environment);
  if (daemonEnvLines.length > 0) {
    defaultRuntime.log(`${label(t("cli.daemon.label.serviceEnv"))} ${daemonEnvLines.join(" ")}`);
  }
  spacer();

  if (service.configAudit?.issues.length) {
    defaultRuntime.error(warnText(t("cli.daemon.status.configOutdated")));
    for (const issue of service.configAudit.issues) {
      const detail = issue.detail ? ` (${issue.detail})` : "";
      defaultRuntime.error(
        `${warnText(t("cli.daemon.status.configIssue"))} ${issue.message}${detail}`,
      );
    }
    defaultRuntime.error(
      warnText(
        t("cli.daemon.status.recommendation", {
          doctorCmd: formatCliCommand("kaijibot doctor"),
          doctorRepairCmd: formatCliCommand("kaijibot doctor --repair"),
        }),
      ),
    );
  }

  if (status.config) {
    const cliCfg = `${shortenHomePath(status.config.cli.path)}${status.config.cli.exists ? "" : " (missing)"}${status.config.cli.valid ? "" : " (invalid)"}`;
    defaultRuntime.log(`${label(t("cli.daemon.label.configCli"))} ${infoText(cliCfg)}`);
    if (!status.config.cli.valid && status.config.cli.issues?.length) {
      for (const issue of status.config.cli.issues.slice(0, 5)) {
        defaultRuntime.error(
          `${errorText(t("cli.daemon.status.configIssueLabel"))} ${formatConfigIssueLine(issue, "", { normalizeRoot: true })}`,
        );
      }
    }
    if (status.config.daemon) {
      const daemonCfg = `${shortenHomePath(status.config.daemon.path)}${status.config.daemon.exists ? "" : " (missing)"}${status.config.daemon.valid ? "" : " (invalid)"}`;
      defaultRuntime.log(`${label(t("cli.daemon.label.configService"))} ${infoText(daemonCfg)}`);
      if (!status.config.daemon.valid && status.config.daemon.issues?.length) {
        for (const issue of status.config.daemon.issues.slice(0, 5)) {
          defaultRuntime.error(
            `${errorText(t("cli.daemon.status.serviceConfigIssueLabel"))} ${formatConfigIssueLine(issue, "", { normalizeRoot: true })}`,
          );
        }
      }
    }
    if (status.config.mismatch) {
      defaultRuntime.error(errorText(t("cli.daemon.status.rootCause")));
      defaultRuntime.error(
        errorText(
          t("cli.daemon.status.fixConfigMismatch", {
            gatewayInstallCmd: formatCliCommand("kaijibot gateway install --force"),
          }),
        ),
      );
    }
    spacer();
  }

  if (status.gateway) {
    const bindHost = status.gateway.bindHost ?? "n/a";
    defaultRuntime.log(
      `${label(t("cli.daemon.label.gateway"))} bind=${infoText(status.gateway.bindMode)} (${infoText(bindHost)}), port=${infoText(String(status.gateway.port))} (${infoText(status.gateway.portSource)})`,
    );
    defaultRuntime.log(
      `${label(t("cli.daemon.label.probeTarget"))} ${infoText(status.gateway.probeUrl)}`,
    );
    const controlUiEnabled = status.config?.daemon?.controlUi?.enabled ?? true;
    if (!controlUiEnabled) {
      defaultRuntime.log(
        `${label(t("cli.daemon.label.dashboard"))} ${warnText(t("cli.daemon.status.dashboardDisabled"))}`,
      );
    } else {
      const links = resolveControlUiLinks({
        port: status.gateway.port,
        bind: status.gateway.bindMode,
        customBindHost: status.gateway.customBindHost,
        basePath: status.config?.daemon?.controlUi?.basePath,
      });
      defaultRuntime.log(`${label(t("cli.daemon.label.dashboard"))} ${infoText(links.httpUrl)}`);
    }
    if (status.gateway.probeNote) {
      defaultRuntime.log(
        `${label(t("cli.daemon.label.probeNote"))} ${infoText(status.gateway.probeNote)}`,
      );
    }
    spacer();
  }

  const runtimeLine = formatRuntimeStatus(service.runtime);
  if (runtimeLine) {
    const runtimeColor = resolveRuntimeStatusColor(service.runtime?.status);
    defaultRuntime.log(
      `${label(t("cli.daemon.label.runtime"))} ${colorize(rich, runtimeColor, runtimeLine)}`,
    );
  }

  if (rpc && !rpc.ok && service.loaded && service.runtime?.status === "running") {
    defaultRuntime.log(warnText(t("cli.daemon.status.warmUp")));
  }
  if (rpc) {
    if (rpc.ok) {
      defaultRuntime.log(
        `${label(t("cli.daemon.label.rpcProbe"))} ${okText(t("cli.daemon.status.rpcOk"))}`,
      );
    } else {
      defaultRuntime.error(
        `${label(t("cli.daemon.label.rpcProbe"))} ${errorText(t("cli.daemon.status.rpcFailed"))}`,
      );
      if (rpc.authWarning) {
        defaultRuntime.error(
          `${label(t("cli.daemon.label.rpcAuth"))} ${warnText(rpc.authWarning)}`,
        );
      }
      if (rpc.url) {
        defaultRuntime.error(`${label(t("cli.daemon.label.rpcTarget"))} ${rpc.url}`);
      }
      const lines = String(rpc.error ?? "unknown")
        .split(/\r?\n/)
        .filter(Boolean);
      for (const line of lines.slice(0, 12)) {
        defaultRuntime.error(`  ${errorText(line)}`);
      }
    }
    spacer();
  }

  if (
    status.health &&
    status.health.staleGatewayPids.length > 0 &&
    service.runtime?.status === "running" &&
    typeof service.runtime.pid === "number"
  ) {
    defaultRuntime.error(
      errorText(
        t("cli.daemon.status.pidNotOwningPort", {
          pids: status.health.staleGatewayPids.join(", "),
        }),
      ),
    );
    defaultRuntime.error(
      errorText(
        t("cli.daemon.status.fixPidNotOwning", {
          gatewayRestartCmd: formatCliCommand("kaijibot gateway restart"),
          gatewayStatusCmd: formatCliCommand("kaijibot gateway status --deep"),
        }),
      ),
    );
    spacer();
  }

  const systemdUnavailable =
    process.platform === "linux" && isSystemdUnavailableDetail(service.runtime?.detail);
  if (systemdUnavailable) {
    const container = Boolean(
      resolveDaemonContainerContext(service.command?.environment ?? process.env),
    );
    defaultRuntime.error(errorText(t("cli.daemon.status.systemdUnavailable")));
    for (const hint of renderSystemdUnavailableHints({
      wsl: isWSLEnv(),
      kind: classifySystemdUnavailableDetail(service.runtime?.detail),
      container,
    })) {
      defaultRuntime.error(errorText(hint));
    }
    spacer();
  }

  if (service.runtime?.missingUnit) {
    defaultRuntime.error(errorText(t("cli.daemon.status.serviceUnitNotFound")));
    for (const hint of renderRuntimeHints(service.runtime, process.env, status.logFile)) {
      defaultRuntime.error(errorText(hint));
    }
  } else if (service.loaded && service.runtime?.status === "stopped") {
    defaultRuntime.error(errorText(t("cli.daemon.status.serviceLoadedNotRunning")));
    for (const hint of renderRuntimeHints(
      service.runtime,
      service.command?.environment ?? process.env,
      status.logFile,
    )) {
      defaultRuntime.error(errorText(hint));
    }
    spacer();
  }

  if (service.runtime?.cachedLabel) {
    const env = service.command?.environment ?? process.env;
    const labelValue = resolveGatewayLaunchAgentLabel(env.KAIJIBOT_PROFILE);
    defaultRuntime.error(
      errorText(t("cli.daemon.status.cachedLabelMissing", { label: labelValue })),
    );
    defaultRuntime.error(
      errorText(
        t("cli.daemon.status.reinstallAfterClear", {
          gatewayInstallCmd: formatCliCommand("kaijibot gateway install"),
        }),
      ),
    );
    spacer();
  }

  for (const line of renderPortDiagnosticsForCli(status, rpc?.ok)) {
    defaultRuntime.error(errorText(line));
  }

  if (status.port) {
    const addrs = resolvePortListeningAddresses(status);
    if (addrs.length > 0) {
      defaultRuntime.log(`${label(t("cli.daemon.label.listening"))} ${infoText(addrs.join(", "))}`);
    }
  }

  if (status.portCli && status.portCli.port !== status.port?.port) {
    defaultRuntime.log(
      `${label(t("cli.daemon.label.note"))} CLI config resolves gateway port=${status.portCli.port} (${status.portCli.status}).`,
    );
  }

  if (
    service.loaded &&
    service.runtime?.status === "running" &&
    status.port &&
    status.port.status !== "busy"
  ) {
    defaultRuntime.error(
      errorText(t("cli.daemon.status.portNotListening", { port: status.port.port })),
    );
    if (status.lastError) {
      defaultRuntime.error(`${errorText(t("cli.daemon.status.lastError"))} ${status.lastError}`);
    }
    if (process.platform === "linux") {
      const env = service.command?.environment ?? process.env;
      const unit = resolveGatewaySystemdServiceName(env.KAIJIBOT_PROFILE);
      defaultRuntime.error(
        errorText(`Logs: journalctl --user -u ${unit}.service -n 200 --no-pager`),
      );
    } else if (process.platform === "darwin") {
      const logs = resolveGatewayLogPaths(service.command?.environment ?? process.env);
      defaultRuntime.error(
        `${errorText(t("cli.daemon.status.logs"))} ${shortenHomePath(logs.stdoutPath)}`,
      );
      defaultRuntime.error(
        `${errorText(t("cli.daemon.status.errors"))} ${shortenHomePath(logs.stderrPath)}`,
      );
    }
    spacer();
  }

  if (extraServices.length > 0) {
    defaultRuntime.error(errorText(t("cli.daemon.status.otherServicesDetected")));
    for (const svc of extraServices) {
      defaultRuntime.error(`- ${errorText(svc.label)} (${svc.scope}, ${svc.detail})`);
    }
    for (const hint of renderGatewayServiceCleanupHints()) {
      defaultRuntime.error(`${errorText(t("cli.daemon.status.cleanupHint"))} ${hint}`);
    }
    spacer();
  }

  if (extraServices.length > 0) {
    defaultRuntime.error(errorText(t("cli.daemon.status.singleGatewayRecommendation")));
    defaultRuntime.error(errorText(t("cli.daemon.status.multipleGatewaysNote")));
    spacer();
  }

  defaultRuntime.log(
    `${label(t("cli.daemon.label.troubles"))} run ${formatCliCommand("kaijibot status")}`,
  );
  defaultRuntime.log(
    `${label(t("cli.daemon.label.troubleshooting"))} ${t("cli.daemon.troubleshootingUrl")}`,
  );
}
