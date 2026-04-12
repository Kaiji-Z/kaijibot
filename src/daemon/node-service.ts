import {
  NODE_SERVICE_KIND,
  NODE_SERVICE_MARKER,
  NODE_WINDOWS_TASK_SCRIPT_NAME,
  resolveNodeLaunchAgentLabel,
  resolveNodeSystemdServiceName,
  resolveNodeWindowsTaskName,
} from "./constants.js";
import type { GatewayService, GatewayServiceInstallArgs } from "./service.js";
import { resolveGatewayService } from "./service.js";

function withNodeServiceEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...env,
    KAIJIBOT_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
    KAIJIBOT_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
    KAIJIBOT_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
    KAIJIBOT_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
    KAIJIBOT_LOG_PREFIX: "node",
    KAIJIBOT_SERVICE_MARKER: NODE_SERVICE_MARKER,
    KAIJIBOT_SERVICE_KIND: NODE_SERVICE_KIND,
  };
}

function withNodeInstallEnv(args: GatewayServiceInstallArgs): GatewayServiceInstallArgs {
  return {
    ...args,
    env: withNodeServiceEnv(args.env),
    environment: {
      ...args.environment,
      KAIJIBOT_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
      KAIJIBOT_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
      KAIJIBOT_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
      KAIJIBOT_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
      KAIJIBOT_LOG_PREFIX: "node",
      KAIJIBOT_SERVICE_MARKER: NODE_SERVICE_MARKER,
      KAIJIBOT_SERVICE_KIND: NODE_SERVICE_KIND,
    },
  };
}

export function resolveNodeService(): GatewayService {
  const base = resolveGatewayService();
  return {
    ...base,
    stage: async (args) => {
      return base.stage(withNodeInstallEnv(args));
    },
    install: async (args) => {
      return base.install(withNodeInstallEnv(args));
    },
    uninstall: async (args) => {
      return base.uninstall({ ...args, env: withNodeServiceEnv(args.env) });
    },
    stop: async (args) => {
      return base.stop({ ...args, env: withNodeServiceEnv(args.env ?? {}) });
    },
    restart: async (args) => {
      return base.restart({ ...args, env: withNodeServiceEnv(args.env ?? {}) });
    },
    isLoaded: async (args) => {
      return base.isLoaded({ env: withNodeServiceEnv(args.env ?? {}) });
    },
    readCommand: (env) => base.readCommand(withNodeServiceEnv(env)),
    readRuntime: (env) => base.readRuntime(withNodeServiceEnv(env)),
  };
}
