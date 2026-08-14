import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { getActiveEmbeddedRunCount } from "../agents/pi-embedded-runner/runs.js";
import { registerSkillsChangeListener } from "../agents/skills/refresh.js";
import { initSubagentRegistry } from "../agents/subagent-registry.js";
import { getTotalPendingReplies } from "../auto-reply/reply/dispatcher-registry.js";
import type { CanvasHostServer } from "../canvas-host/server.js";
import { type ChannelId, listChannelPlugins } from "../channels/plugins/index.js";
import { runChannelPluginStartupMaintenance } from "../channels/plugins/lifecycle-startup.js";
import { formatCliCommand } from "../cli/command-format.js";
import { createDefaultDeps } from "../cli/deps.js";
import type { SchedulerEvent } from "../cognitive/scheduler/types.js";
import { isRestartEnabled } from "../config/commands.js";
import {
  type ConfigFileSnapshot,
  type KaijiBotConfig,
  applyConfigOverrides,
  getRuntimeConfig,
  isNixMode,
  loadConfig,
  registerConfigWriteListener,
  readConfigFileSnapshot,
  setRuntimeConfigSnapshot,
  writeConfigFile,
} from "../config/config.js";
import { formatConfigIssueLines } from "../config/issue-format.js";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { clearAgentRunContext, onAgentEvent } from "../infra/agent-events.js";
import {
  ensureControlUiAssetsBuilt,
  isPackageProvenControlUiRootSync,
  resolveControlUiRootOverrideSync,
  resolveControlUiRootSync,
} from "../infra/control-ui-assets.js";
import { isDiagnosticsEnabled } from "../infra/diagnostic-events.js";
import { isTruthyEnvValue, logAcceptedEnvOption } from "../infra/env.js";
import { createExecApprovalForwarder } from "../infra/exec-approval-forwarder.js";
import { onHeartbeatEvent } from "../infra/heartbeat-events.js";
import { startHeartbeatRunner, type HeartbeatRunner } from "../infra/heartbeat-runner.js";
import {
  shouldDisableNativeTools,
  buildDisabledToolsConfig,
  buildDisabledSkillEntries,
} from "../infra/lark-cli/auto-disable.ts";
import {
  buildLarkCliEnv,
  isLarkCliAvailable,
  healthCheck,
  registerLarkCliProfiles,
  buildAccountCredentialsList,
  resolveLarkCliBinDir,
} from "../infra/lark-cli/index.js";
import { getMachineDisplayName } from "../infra/machine-name.js";
import { ensureKaijiBotCliOnPath } from "../infra/path-env.js";
import { applyPathPrepend } from "../infra/path-prepend.js";
import { setGatewaySigusr1RestartPolicy, setPreRestartDeferralCheck } from "../infra/restart.js";
import {
  primeRemoteSkillsCache,
  refreshRemoteBinsForConnectedNodes,
  setSkillsRemoteRegistry,
} from "../infra/skills-remote.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { scheduleGatewayUpdateCheck } from "../infra/update-startup.js";
import { startDiagnosticHeartbeat, stopDiagnosticHeartbeat } from "../logging/diagnostic.js";
import { createSubsystemLogger, runtimeForLogger } from "../logging/subsystem.js";
import {
  resolveConfiguredDeferredChannelPluginIds,
  resolveGatewayStartupPluginIds,
} from "../plugins/channel-plugin-ids.js";
import { getGlobalHookRunner, runGlobalGatewayStopSafely } from "../plugins/hook-runner-global.js";
import { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
import { createEmptyPluginRegistry } from "../plugins/registry.js";
import { getActivePluginRegistry, setActivePluginRegistry } from "../plugins/runtime.js";
import { createPluginRuntime } from "../plugins/runtime/index.js";
import type { PluginServicesHandle } from "../plugins/services.js";
import { getTotalQueueSize } from "../process/command-queue.js";
import type { RuntimeEnv } from "../runtime.js";
import {
  resolveCommandSecretsFromActiveRuntimeSnapshot,
  type CommandSecretAssignment,
} from "../secrets/runtime-command-secrets.js";
import {
  GATEWAY_AUTH_SURFACE_PATHS,
  evaluateGatewayAuthSurfaceStates,
} from "../secrets/runtime-gateway-auth-surfaces.js";
import {
  activateSecretsRuntimeSnapshot,
  clearSecretsRuntimeSnapshot,
  getActiveSecretsRuntimeSnapshot,
  prepareSecretsRuntimeSnapshot,
} from "../secrets/runtime.js";
import { onSessionLifecycleEvent } from "../sessions/session-lifecycle-events.js";
import { onSessionTranscriptUpdate } from "../sessions/transcript-events.js";
import {
  getInspectableTaskRegistrySummary,
  startTaskRegistryMaintenance,
  stopTaskRegistryMaintenance,
} from "../tasks/task-registry.maintenance.js";
import { runSetupWizard } from "../wizard/setup.js";
import { createAuthRateLimiter, type AuthRateLimiter } from "./auth-rate-limit.js";
import { resolveGatewayAuth } from "./auth.js";
import { startChannelHealthMonitor } from "./channel-health-monitor.js";
import { resolveGatewayReloadSettings, startGatewayConfigReloader } from "./config-reload.js";
import type { ControlUiRootState } from "./control-ui.js";
import {
  GATEWAY_EVENT_UPDATE_AVAILABLE,
  type GatewayUpdateAvailableEventPayload,
} from "./events.js";
import { createExecApprovalIosPushDelivery } from "./exec-approval-ios-push.js";
import { ExecApprovalManager } from "./exec-approval-manager.js";
import { startMcpLoopbackServer } from "./mcp-http.js";
import { startGatewayModelPricingRefresh } from "./model-pricing-cache.js";
import { NodeRegistry } from "./node-registry.js";
import { createChannelManager } from "./server-channels.js";
import {
  createAgentEventHandler,
  createSessionEventSubscriberRegistry,
  createSessionMessageSubscriberRegistry,
} from "./server-chat.js";
import { createGatewayCloseHandler } from "./server-close.js";
import { buildGatewayCronService } from "./server-cron.js";
import { startGatewayDiscovery } from "./server-discovery-runtime.js";
import { applyGatewayLaneConcurrency } from "./server-lanes.js";
import { startGatewayMaintenanceTimers } from "./server-maintenance.js";
import { GATEWAY_EVENTS, listGatewayMethods } from "./server-methods-list.js";
import { coreGatewayHandlers } from "./server-methods.js";
import { createAuthHandlers } from "./server-methods/auth.js";
import { createExecApprovalHandlers } from "./server-methods/exec-approval.js";
import { safeParseJson } from "./server-methods/nodes.helpers.js";
import { createPluginApprovalHandlers } from "./server-methods/plugin-approval.js";
import { createSecretsHandlers } from "./server-methods/secrets.js";
import { hasConnectedMobileNode } from "./server-mobile-nodes.js";
import { loadGatewayModelCatalog } from "./server-model-catalog.js";
import { createNodeSubscriptionManager } from "./server-node-subscriptions.js";
import {
  loadGatewayStartupPlugins,
  reloadDeferredGatewayPlugins,
} from "./server-plugin-bootstrap.js";
import { setFallbackGatewayContextResolver } from "./server-plugins.js";
import { createGatewayReloadHandlers } from "./server-reload-handlers.js";
import { resolveGatewayRuntimeConfig } from "./server-runtime-config.js";
import { createGatewayRuntimeState } from "./server-runtime-state.js";
import { resolveSessionKeyForRun } from "./server-session-key.js";
import { logGatewayStartup } from "./server-startup-log.js";
import { runStartupSessionMigration } from "./server-startup-session-migration.js";
import { startGatewaySidecars } from "./server-startup.js";
import { startGatewayTailscaleExposure } from "./server-tailscale.js";
import { createWizardSessionTracker } from "./server-wizard-sessions.js";
import { attachGatewayWsHandlers } from "./server-ws-runtime.js";
import {
  getHealthCache,
  getHealthVersion,
  getPresenceVersion,
  incrementPresenceVersion,
  refreshGatewayHealthSnapshot,
} from "./server/health-state.js";
import { resolveHookClientIpConfig } from "./server/hooks.js";
import { createReadinessChecker } from "./server/readiness.js";
import { loadGatewayTlsRuntime } from "./server/tls.js";
import { resolveSharedGatewaySessionGeneration } from "./server/ws-shared-generation.js";
import { resolveSessionKeyForTranscriptFile } from "./session-transcript-key.js";
import {
  attachKaijiBotTranscriptMeta,
  loadGatewaySessionRow,
  loadSessionEntry,
  readSessionMessages,
} from "./session-utils.js";
import {
  ensureGatewayStartupAuth,
  mergeGatewayAuthConfig,
  mergeGatewayTailscaleConfig,
} from "./startup-auth.js";
import { maybeSeedControlUiAllowedOriginsAtStartup } from "./startup-control-ui-origins.js";

export { __resetModelCatalogCacheForTest } from "./server-model-catalog.js";

ensureKaijiBotCliOnPath();

const MAX_MEDIA_TTL_HOURS = 24 * 7;

function resolveMediaCleanupTtlMs(ttlHoursRaw: number): number {
  const ttlHours = Math.min(Math.max(ttlHoursRaw, 1), MAX_MEDIA_TTL_HOURS);
  const ttlMs = ttlHours * 60 * 60_000;
  if (!Number.isFinite(ttlMs) || !Number.isSafeInteger(ttlMs)) {
    throw new Error(`Invalid media.ttlHours: ${String(ttlHoursRaw)}`);
  }
  return ttlMs;
}

const log = createSubsystemLogger("gateway");
const logCanvas = log.child("canvas");
const logDiscovery = log.child("discovery");
const logTailscale = log.child("tailscale");
const logChannels = log.child("channels");

let cachedChannelRuntime: ReturnType<typeof createPluginRuntime>["channel"] | null = null;

function getChannelRuntime() {
  cachedChannelRuntime ??= createPluginRuntime().channel;
  return cachedChannelRuntime;
}

function pruneSkippedStartupSecretSurfaces(config: KaijiBotConfig): KaijiBotConfig {
  const skipChannels =
    isTruthyEnvValue(process.env.KAIJIBOT_SKIP_CHANNELS) ||
    isTruthyEnvValue(process.env.KAIJIBOT_SKIP_PROVIDERS);
  if (!skipChannels || !config.channels) {
    return config;
  }
  return {
    ...config,
    channels: undefined,
  };
}

const logHealth = log.child("health");
const logCron = log.child("cron");
const logReload = log.child("reload");
const logHooks = log.child("hooks");
const logPlugins = log.child("plugins");
const logWsControl = log.child("ws");
const logSecrets = log.child("secrets");
const gatewayRuntime = runtimeForLogger(log);
const canvasRuntime = runtimeForLogger(logCanvas);

type AuthRateLimitConfig = Parameters<typeof createAuthRateLimiter>[0];

function createGatewayAuthRateLimiters(rateLimitConfig: AuthRateLimitConfig | undefined): {
  rateLimiter?: AuthRateLimiter;
  browserRateLimiter: AuthRateLimiter;
} {
  const rateLimiter = rateLimitConfig ? createAuthRateLimiter(rateLimitConfig) : undefined;
  // Browser-origin WS auth attempts always use loopback-non-exempt throttling.
  const browserRateLimiter = createAuthRateLimiter({
    ...rateLimitConfig,
    exemptLoopback: false,
  });
  return { rateLimiter, browserRateLimiter };
}

function logGatewayAuthSurfaceDiagnostics(prepared: {
  sourceConfig: KaijiBotConfig;
  warnings: Array<{ code: string; path: string; message: string }>;
}): void {
  const states = evaluateGatewayAuthSurfaceStates({
    config: prepared.sourceConfig,
    defaults: prepared.sourceConfig.secrets?.defaults,
    env: process.env,
  });
  const inactiveWarnings = new Map<string, string>();
  for (const warning of prepared.warnings) {
    if (warning.code !== "SECRETS_REF_IGNORED_INACTIVE_SURFACE") {
      continue;
    }
    inactiveWarnings.set(warning.path, warning.message);
  }
  for (const path of GATEWAY_AUTH_SURFACE_PATHS) {
    const state = states[path];
    if (!state.hasSecretRef) {
      continue;
    }
    const stateLabel = state.active ? "active" : "inactive";
    const inactiveDetails =
      !state.active && inactiveWarnings.get(path) ? inactiveWarnings.get(path) : undefined;
    const details = inactiveDetails ?? state.reason;
    logSecrets.info(`[SECRETS_GATEWAY_AUTH_SURFACE] ${path} is ${stateLabel}. ${details}`);
  }
}

function applyGatewayAuthOverridesForStartupPreflight(
  config: KaijiBotConfig,
  overrides: Pick<GatewayServerOptions, "auth" | "tailscale">,
): KaijiBotConfig {
  if (!overrides.auth && !overrides.tailscale) {
    return config;
  }
  return {
    ...config,
    gateway: {
      ...config.gateway,
      auth: mergeGatewayAuthConfig(config.gateway?.auth, overrides.auth),
      tailscale: mergeGatewayTailscaleConfig(config.gateway?.tailscale, overrides.tailscale),
    },
  };
}

function assertValidGatewayStartupConfigSnapshot(
  snapshot: ConfigFileSnapshot,
  options: { includeDoctorHint?: boolean } = {},
): void {
  if (snapshot.valid) {
    return;
  }
  const issues =
    snapshot.issues.length > 0
      ? formatConfigIssueLines(snapshot.issues, "", { normalizeRoot: true }).join("\n")
      : "Unknown validation issue.";
  const doctorHint = options.includeDoctorHint
    ? `\nRun "${formatCliCommand("kaijibot doctor --fix")}" to repair, then retry.`
    : "";
  throw new Error(`Invalid config at ${snapshot.path}.\n${issues}${doctorHint}`);
}

async function prepareGatewayStartupConfig(params: {
  configSnapshot: ConfigFileSnapshot;
  // Keep startup auth/runtime behavior aligned with loadConfig(), which applies
  // runtime overrides beyond the raw on-disk snapshot.
  runtimeConfig: KaijiBotConfig;
  authOverride?: GatewayServerOptions["auth"];
  tailscaleOverride?: GatewayServerOptions["tailscale"];
  activateRuntimeSecrets: (
    config: KaijiBotConfig,
    options: { reason: "startup"; activate: boolean },
  ) => Promise<{ config: KaijiBotConfig }>;
}): Promise<Awaited<ReturnType<typeof ensureGatewayStartupAuth>>> {
  assertValidGatewayStartupConfigSnapshot(params.configSnapshot);

  // Fail fast before startup auth persists anything if required refs are unresolved.
  const startupPreflightConfig = applyGatewayAuthOverridesForStartupPreflight(
    params.runtimeConfig,
    {
      auth: params.authOverride,
      tailscale: params.tailscaleOverride,
    },
  );
  const preflightConfig = (
    await params.activateRuntimeSecrets(startupPreflightConfig, {
      reason: "startup",
      activate: false,
    })
  ).config;
  const preflightAuthOverride =
    typeof preflightConfig.gateway?.auth?.token === "string" ||
    typeof preflightConfig.gateway?.auth?.password === "string"
      ? {
          ...params.authOverride,
          ...(typeof preflightConfig.gateway?.auth?.token === "string"
            ? { token: preflightConfig.gateway.auth.token }
            : {}),
          ...(typeof preflightConfig.gateway?.auth?.password === "string"
            ? { password: preflightConfig.gateway.auth.password }
            : {}),
        }
      : params.authOverride;

  const authBootstrap = await ensureGatewayStartupAuth({
    cfg: params.runtimeConfig,
    env: process.env,
    authOverride: preflightAuthOverride,
    tailscaleOverride: params.tailscaleOverride,
    persist: true,
    baseHash: params.configSnapshot.hash,
  });
  const runtimeStartupConfig = applyGatewayAuthOverridesForStartupPreflight(authBootstrap.cfg, {
    auth: params.authOverride,
    tailscale: params.tailscaleOverride,
  });
  const activatedConfig = (
    await params.activateRuntimeSecrets(runtimeStartupConfig, {
      reason: "startup",
      activate: true,
    })
  ).config;
  return {
    ...authBootstrap,
    cfg: activatedConfig,
  };
}

export type GatewayServer = {
  close: (opts?: { reason?: string; restartExpectedMs?: number | null }) => Promise<void>;
};

export type GatewayServerOptions = {
  /**
   * Bind address policy for the Gateway WebSocket/HTTP server.
   * - loopback: 127.0.0.1
   * - lan: 0.0.0.0
   * - tailnet: bind only to the Tailscale IPv4 address (100.64.0.0/10)
   * - auto: prefer loopback, else LAN
   */
  bind?: import("../config/config.js").GatewayBindMode;
  /**
   * Advanced override for the bind host, bypassing bind resolution.
   * Prefer `bind` unless you really need a specific address.
   */
  host?: string;
  /**
   * If false, do not serve the browser Control UI.
   * Default: config `gateway.controlUi.enabled` (or true when absent).
   */
  controlUiEnabled?: boolean;
  /**
   * If false, do not serve `POST /v1/chat/completions`.
   * Default: config `gateway.http.endpoints.chatCompletions.enabled` (or false when absent).
   */
  openAiChatCompletionsEnabled?: boolean;
  /**
   * If false, do not serve `POST /v1/responses` (OpenResponses API).
   * Default: config `gateway.http.endpoints.responses.enabled` (or false when absent).
   */
  openResponsesEnabled?: boolean;
  /**
   * Override gateway auth configuration (merges with config).
   */
  auth?: import("../config/config.js").GatewayAuthConfig;
  /**
   * Override gateway Tailscale exposure configuration (merges with config).
   */
  tailscale?: import("../config/config.js").GatewayTailscaleConfig;
  /**
   * Test-only: allow canvas host startup even when NODE_ENV/VITEST would disable it.
   */
  allowCanvasHostInTests?: boolean;
  /**
   * Test-only: override the setup wizard runner.
   */
  wizardRunner?: (
    opts: import("../commands/onboard-types.js").OnboardOptions,
    runtime: import("../runtime.js").RuntimeEnv,
    prompter: import("../wizard/prompts.js").WizardPrompter,
  ) => Promise<void>;
  /**
   * Optional startup timestamp used for concise readiness logging.
   */
  startupStartedAt?: number;
};

export async function startGatewayServer(
  port = 18789,
  opts: GatewayServerOptions = {},
): Promise<GatewayServer> {
  const minimalTestGateway =
    process.env.VITEST === "1" && process.env.KAIJIBOT_TEST_MINIMAL_GATEWAY === "1";

  // Ensure all default port derivations (browser/canvas) see the actual runtime port.
  process.env.KAIJIBOT_GATEWAY_PORT = String(port);

  {
    const {
      readGatewayRestartHandoffSync,
      clearGatewayRestartHandoffSync,
      formatGatewayRestartHandoffDiagnostic,
    } = await import("../infra/restart-handoff.js");
    const restartHandoff = readGatewayRestartHandoffSync();
    if (restartHandoff) {
      log.info(formatGatewayRestartHandoffDiagnostic(restartHandoff));
      clearGatewayRestartHandoffSync();
    }
  }
  logAcceptedEnvOption({
    key: "KAIJIBOT_RAW_STREAM",
    description: "raw stream logging enabled",
  });
  logAcceptedEnvOption({
    key: "KAIJIBOT_RAW_STREAM_PATH",
    description: "raw stream log path override",
  });

  let configSnapshot = await readConfigFileSnapshot();
  if (configSnapshot.legacyIssues.length > 0) {
    if (isNixMode) {
      throw new Error(
        "Legacy config entries detected while running in Nix mode. Update your Nix config to the latest schema and restart.",
      );
    }
  }
  if (configSnapshot.exists) {
    assertValidGatewayStartupConfigSnapshot(configSnapshot, { includeDoctorHint: true });
  }

  const autoEnable = minimalTestGateway
    ? { config: configSnapshot.config, changes: [] as string[] }
    : applyPluginAutoEnable({ config: configSnapshot.config, env: process.env });
  if (autoEnable.changes.length > 0) {
    try {
      await writeConfigFile(autoEnable.config);
      configSnapshot = await readConfigFileSnapshot();
      assertValidGatewayStartupConfigSnapshot(configSnapshot);
      log.info(
        `gateway: auto-enabled plugins:\n${autoEnable.changes
          .map((entry) => `- ${entry}`)
          .join("\n")}`,
      );
    } catch (err) {
      log.warn(`gateway: failed to persist plugin auto-enable changes: ${String(err)}`);
    }
  }

  let secretsDegraded = false;
  const emitSecretsStateEvent = (
    code: "SECRETS_RELOADER_DEGRADED" | "SECRETS_RELOADER_RECOVERED",
    message: string,
    cfg: KaijiBotConfig,
  ) => {
    enqueueSystemEvent(`[${code}] ${message}`, {
      sessionKey: resolveMainSessionKey(cfg),
      contextKey: code,
    });
  };
  let secretsActivationTail: Promise<void> = Promise.resolve();
  const runWithSecretsActivationLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const run = secretsActivationTail.then(operation, operation);
    secretsActivationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  };
  const activateRuntimeSecrets = async (
    config: KaijiBotConfig,
    params: { reason: "startup" | "reload" | "restart-check"; activate: boolean },
  ) =>
    await runWithSecretsActivationLock(async () => {
      try {
        const prepared = await prepareSecretsRuntimeSnapshot({
          config: pruneSkippedStartupSecretSurfaces(config),
        });
        if (params.activate) {
          activateSecretsRuntimeSnapshot(prepared);
          logGatewayAuthSurfaceDiagnostics(prepared);
        }
        for (const warning of prepared.warnings) {
          logSecrets.warn(`[${warning.code}] ${warning.message}`);
        }
        if (secretsDegraded) {
          const recoveredMessage =
            "Secret resolution recovered; runtime remained on last-known-good during the outage.";
          logSecrets.info(`[SECRETS_RELOADER_RECOVERED] ${recoveredMessage}`);
          emitSecretsStateEvent("SECRETS_RELOADER_RECOVERED", recoveredMessage, prepared.config);
        }
        secretsDegraded = false;
        return prepared;
      } catch (err) {
        const details = String(err);
        if (!secretsDegraded) {
          logSecrets.error(`[SECRETS_RELOADER_DEGRADED] ${details}`);
          if (params.reason !== "startup") {
            emitSecretsStateEvent(
              "SECRETS_RELOADER_DEGRADED",
              `Secret resolution failed; runtime remains on last-known-good snapshot. ${details}`,
              config,
            );
          }
        } else {
          logSecrets.warn(`[SECRETS_RELOADER_DEGRADED] ${details}`);
        }
        secretsDegraded = true;
        if (params.reason === "startup") {
          throw new Error(`Startup failed: required secrets are unavailable. ${details}`, {
            cause: err,
          });
        }
        throw err;
      }
    });

  let cfgAtStart: KaijiBotConfig;
  let startupInternalWriteHash: string | null = null;
  const startupRuntimeConfig = applyConfigOverrides(configSnapshot.config);
  const authBootstrap = await prepareGatewayStartupConfig({
    configSnapshot,
    runtimeConfig: startupRuntimeConfig,
    authOverride: opts.auth,
    tailscaleOverride: opts.tailscale,
    activateRuntimeSecrets,
  });
  cfgAtStart = authBootstrap.cfg;
  if (authBootstrap.generatedToken) {
    if (authBootstrap.persistedGeneratedToken) {
      log.info(
        "Gateway auth token was missing. Generated a new token and saved it to config (gateway.auth.token).",
      );
    } else {
      log.warn(
        "Gateway auth token was missing. Generated a runtime token for this startup without changing config; restart will generate a different token. Persist one with `kaijibot config set gateway.auth.mode token` and `kaijibot config set gateway.auth.token <token>`.",
      );
    }
  }
  const diagnosticsEnabled = isDiagnosticsEnabled(cfgAtStart);
  if (diagnosticsEnabled) {
    startDiagnosticHeartbeat(undefined, { getConfig: getRuntimeConfig });
  }
  setGatewaySigusr1RestartPolicy({ allowExternal: isRestartEnabled(cfgAtStart) });
  setPreRestartDeferralCheck(
    () =>
      getTotalQueueSize() +
      getTotalPendingReplies() +
      getActiveEmbeddedRunCount() +
      getInspectableTaskRegistrySummary().active,
  );
  // Unconditional startup migration: seed gateway.controlUi.allowedOrigins for existing
  // non-loopback installs that upgraded to v2026.2.26+ without required origins.
  const controlUiSeed = minimalTestGateway
    ? { config: cfgAtStart, persistedAllowedOriginsSeed: false }
    : await maybeSeedControlUiAllowedOriginsAtStartup({
        config: cfgAtStart,
        writeConfig: writeConfigFile,
        log,
      });
  cfgAtStart = controlUiSeed.config;

  // KaijiBot default: isolate DM sessions per channel+peer so Feishu users get
  // dedicated session keys (agent:main:feishu:direct:ou_xxx).  This enables
  // per-user persona and cognitive insight delivery.  Explicit config wins.
  // Persist to disk so all config consumers (channel routing, getReply, etc.)
  // see the default — runtime-only mutation would not reach loadConfig() readers.
  if (cfgAtStart.session?.dmScope === undefined) {
    cfgAtStart = {
      ...cfgAtStart,
      session: { ...cfgAtStart.session, dmScope: "per-channel-peer" },
    };
    try {
      await writeConfigFile(cfgAtStart);
      configSnapshot = await readConfigFileSnapshot();
      startupInternalWriteHash = configSnapshot.hash ?? null;
    } catch (err) {
      log.warn(`gateway: failed to persist dmScope default: ${String(err)}`);
    }
  }

  // --- Lark-CLI integration ---
  // When lark-cli binary is available, propagate feishu credentials as env vars
  // and auto-disable native feishu tools/skills in favor of CLI-based operations.
  const feishuChannelCfg = cfgAtStart.channels?.feishu as Record<string, unknown> | undefined;
  if (feishuChannelCfg && isLarkCliAvailable()) {
    const appId = feishuChannelCfg.appId as string | undefined;
    const appSecret = feishuChannelCfg.appSecret as string | undefined;
    const domain = feishuChannelCfg.domain as string | undefined;

    // Do not set LARKSUITE_CLI_APP_ID/SECRET — they override --profile credentials.
    const larkEnv = buildLarkCliEnv({ domain });
    for (const [key, value] of Object.entries(larkEnv)) {
      if (value) {
        process.env[key] = value;
      }
    }

    const larkBinDir = resolveLarkCliBinDir();
    if (larkBinDir) {
      applyPathPrepend(process.env as Record<string, string>, [larkBinDir]);
      log.info(`lark-cli: added ${larkBinDir} to PATH`);
    }

    // Register all feishu accounts as lark-cli profiles (multi-bot support).
    // The default (top-level) bot becomes profile "default", additional accounts
    // become profiles keyed by their accountId.
    const accounts = feishuChannelCfg.accounts as
      | Record<string, { appId?: string; appSecret?: string; domain?: string }>
      | undefined;
    const profileAccounts = buildAccountCredentialsList({
      defaultAppId: appId,
      defaultAppSecret: appSecret,
      defaultDomain: domain,
      accounts,
    });
    if (profileAccounts.length > 0) {
      const regResult = await registerLarkCliProfiles(profileAccounts);
      if (regResult.registered.length > 0) {
        log.info(`lark-cli: registered profiles: ${regResult.registered.join(", ")}`);
      }
      for (const fail of regResult.failed) {
        log.warn(`lark-cli: failed to register profile "${fail.name}": ${fail.error}`);
      }
    }

    // Auto-disable native feishu tools if user hasn't explicitly configured them.
    // Guard: verify the binary actually runs before disabling native tools.
    // Prevents "path resolves but binary crashes" edge case (platform mismatch, corruption).
    const userToolsCfg = feishuChannelCfg.tools as Record<string, unknown> | undefined;
    if (shouldDisableNativeTools(userToolsCfg)) {
      const hc = await healthCheck();
      if (!hc.ok) {
        log.warn(
          `lark-cli: binary found but health check failed (${hc.error}), keeping native feishu tools`,
        );
      } else {
        if (!feishuChannelCfg.tools) {
          feishuChannelCfg.tools = {};
        }
        const disabledTools = buildDisabledToolsConfig();
        const toolsMap = feishuChannelCfg.tools as Record<string, unknown>;
        for (const [key, value] of Object.entries(disabledTools)) {
          toolsMap[key] = value;
        }
        // Also inject disabled tools into each account's config so
        // resolveToolsConfig() doesn't re-enable them via DEFAULT_TOOLS_CONFIG.
        const accountsMap = feishuChannelCfg.accounts as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (accountsMap) {
          for (const [, acctCfg] of Object.entries(accountsMap)) {
            if (!acctCfg.tools) {
              acctCfg.tools = {};
            }
            const acctTools = acctCfg.tools as Record<string, unknown>;
            for (const [key, value] of Object.entries(disabledTools)) {
              acctTools[key] = value;
            }
          }
          log.info(
            `lark-cli: injected disabled tools into ${Object.keys(accountsMap).length} accounts`,
          );
        }
        log.info(`lark-cli: native feishu tools auto-disabled (lark-cli v${hc.version} healthy)`);

        // Auto-disable feishu skills
        const disabledSkills = buildDisabledSkillEntries();
        if (!cfgAtStart.skills) {
          cfgAtStart.skills = {};
        }
        if (!cfgAtStart.skills.entries) {
          cfgAtStart.skills.entries = {};
        }
        for (const [id, cfg] of Object.entries(disabledSkills)) {
          if (!cfgAtStart.skills.entries[id]) {
            cfgAtStart.skills.entries[id] = cfg;
          }
        }
        log.info("lark-cli: feishu skills auto-disabled (lark-cli available)");

        setRuntimeConfigSnapshot(cfgAtStart);
      }
    }
  }

  if (authBootstrap.persistedGeneratedToken || controlUiSeed.persistedAllowedOriginsSeed) {
    const startupSnapshot = await readConfigFileSnapshot();
    startupInternalWriteHash = startupSnapshot.hash ?? null;
  }
  const startupMaintenanceConfig =
    cfgAtStart.channels === undefined && startupRuntimeConfig.channels !== undefined
      ? {
          ...cfgAtStart,
          channels: startupRuntimeConfig.channels,
        }
      : cfgAtStart;
  if (!minimalTestGateway) {
    await runChannelPluginStartupMaintenance({
      cfg: startupMaintenanceConfig,
      env: process.env,
      log,
    });
    await runStartupSessionMigration({
      cfg: cfgAtStart,
      env: process.env,
      log,
    });
  }
  initSubagentRegistry();
  const gatewayPluginConfigAtStart = minimalTestGateway
    ? cfgAtStart
    : applyPluginAutoEnable({
        config: cfgAtStart,
        env: process.env,
      }).config;
  const defaultAgentId = resolveDefaultAgentId(gatewayPluginConfigAtStart);
  const defaultWorkspaceDir = resolveAgentWorkspaceDir(gatewayPluginConfigAtStart, defaultAgentId);
  const deferredConfiguredChannelPluginIds = minimalTestGateway
    ? []
    : resolveConfiguredDeferredChannelPluginIds({
        config: gatewayPluginConfigAtStart,
        workspaceDir: defaultWorkspaceDir,
        env: process.env,
      });
  const startupPluginIds = minimalTestGateway
    ? []
    : resolveGatewayStartupPluginIds({
        config: gatewayPluginConfigAtStart,
        activationSourceConfig: cfgAtStart,
        workspaceDir: defaultWorkspaceDir,
        env: process.env,
      });
  const baseMethods = listGatewayMethods();
  const emptyPluginRegistry = createEmptyPluginRegistry();
  let pluginRegistry = emptyPluginRegistry;
  let baseGatewayMethods = baseMethods;
  if (!minimalTestGateway) {
    ({ pluginRegistry, gatewayMethods: baseGatewayMethods } = loadGatewayStartupPlugins({
      cfg: gatewayPluginConfigAtStart,
      activationSourceConfig: cfgAtStart,
      workspaceDir: defaultWorkspaceDir,
      log,
      coreGatewayHandlers,
      baseMethods,
      pluginIds: startupPluginIds,
      preferSetupRuntimeForChannelPlugins: deferredConfiguredChannelPluginIds.length > 0,
    }));
  } else {
    pluginRegistry = getActivePluginRegistry() ?? emptyPluginRegistry;
    setActivePluginRegistry(pluginRegistry);
  }
  const channelLogs = Object.fromEntries(
    listChannelPlugins().map((plugin) => [plugin.id, logChannels.child(plugin.id)]),
  ) as Record<ChannelId, ReturnType<typeof createSubsystemLogger>>;
  const channelRuntimeEnvs = Object.fromEntries(
    Object.entries(channelLogs).map(([id, logger]) => [id, runtimeForLogger(logger)]),
  ) as unknown as Record<ChannelId, RuntimeEnv>;
  const listActiveGatewayMethods = (nextBaseGatewayMethods: string[]) =>
    Array.from(
      new Set([
        ...nextBaseGatewayMethods,
        ...listChannelPlugins().flatMap((plugin) => plugin.gatewayMethods ?? []),
      ]),
    );
  let gatewayMethods = listActiveGatewayMethods(baseGatewayMethods);
  let pluginServices: PluginServicesHandle | null = null;
  const runtimeConfig = await resolveGatewayRuntimeConfig({
    cfg: cfgAtStart,
    port,
    bind: opts.bind,
    host: opts.host,
    controlUiEnabled: opts.controlUiEnabled,
    openAiChatCompletionsEnabled: opts.openAiChatCompletionsEnabled,
    openResponsesEnabled: opts.openResponsesEnabled,
    auth: opts.auth,
    tailscale: opts.tailscale,
  });
  const {
    bindHost,
    controlUiEnabled,
    openAiChatCompletionsEnabled,
    openAiChatCompletionsConfig,
    openResponsesEnabled,
    openResponsesConfig,
    strictTransportSecurityHeader,
    controlUiBasePath,
    controlUiRoot: controlUiRootOverride,
    resolvedAuth,
    tailscaleConfig,
    tailscaleMode,
  } = runtimeConfig;
  const getResolvedAuth = () =>
    resolveGatewayAuth({
      authConfig:
        getActiveSecretsRuntimeSnapshot()?.config.gateway?.auth ?? getRuntimeConfig().gateway?.auth,
      authOverride: opts.auth,
      env: process.env,
      tailscaleMode,
    });
  const resolveSharedGatewaySessionGenerationForConfig = (config: KaijiBotConfig) =>
    resolveSharedGatewaySessionGeneration(
      resolveGatewayAuth({
        authConfig: config.gateway?.auth,
        authOverride: opts.auth,
        env: process.env,
        tailscaleMode,
      }),
    );
  const resolveCurrentSharedGatewaySessionGeneration = () =>
    resolveSharedGatewaySessionGeneration(getResolvedAuth());
  const resolveSharedGatewaySessionGenerationForRuntimeSnapshot = () =>
    resolveSharedGatewaySessionGeneration(
      resolveGatewayAuth({
        authConfig: getRuntimeConfig().gateway?.auth,
        authOverride: opts.auth,
        env: process.env,
        tailscaleMode,
      }),
    );
  let currentSharedGatewaySessionGeneration = resolveCurrentSharedGatewaySessionGeneration();
  let requiredSharedGatewaySessionGeneration: string | undefined | null = null;
  const getRequiredSharedGatewaySessionGeneration = () =>
    requiredSharedGatewaySessionGeneration === null
      ? currentSharedGatewaySessionGeneration
      : requiredSharedGatewaySessionGeneration;
  let hooksConfig = runtimeConfig.hooksConfig;
  let hookClientIpConfig = resolveHookClientIpConfig(cfgAtStart);
  const canvasHostEnabled = runtimeConfig.canvasHostEnabled;

  // Create auth rate limiters used by connect/auth flows.
  const rateLimitConfig = cfgAtStart.gateway?.auth?.rateLimit;
  const { rateLimiter: authRateLimiter, browserRateLimiter: browserAuthRateLimiter } =
    createGatewayAuthRateLimiters(rateLimitConfig);

  let controlUiRootState: ControlUiRootState | undefined;
  if (controlUiRootOverride) {
    const resolvedOverride = resolveControlUiRootOverrideSync(controlUiRootOverride);
    const resolvedOverridePath = path.resolve(controlUiRootOverride);
    controlUiRootState = resolvedOverride
      ? { kind: "resolved", path: resolvedOverride }
      : { kind: "invalid", path: resolvedOverridePath };
    if (!resolvedOverride) {
      log.warn(`gateway: controlUi.root not found at ${resolvedOverridePath}`);
    }
  } else if (controlUiEnabled) {
    let resolvedRoot = resolveControlUiRootSync({
      moduleUrl: import.meta.url,
      argv1: process.argv[1],
      cwd: process.cwd(),
    });
    if (!resolvedRoot) {
      controlUiRootState = { kind: "missing" };
      void ensureControlUiAssetsBuilt(gatewayRuntime).then((ensureResult) => {
        if (!ensureResult.ok && ensureResult.message) {
          log.warn(`gateway: ${ensureResult.message}`);
        }
      });
    } else {
      controlUiRootState = {
        kind: isPackageProvenControlUiRootSync(resolvedRoot, {
          moduleUrl: import.meta.url,
          argv1: process.argv[1],
          cwd: process.cwd(),
        })
          ? "bundled"
          : "resolved",
        path: resolvedRoot,
      };
    }
  }

  const wizardRunner = opts.wizardRunner ?? runSetupWizard;
  const { wizardSessions, findRunningWizard, purgeWizardSession } = createWizardSessionTracker();

  const deps = createDefaultDeps();
  let canvasHostServer: CanvasHostServer | null = null;
  const gatewayTls = await loadGatewayTlsRuntime(cfgAtStart.gateway?.tls, log.child("tls"));
  if (cfgAtStart.gateway?.tls?.enabled && !gatewayTls.enabled) {
    throw new Error(gatewayTls.error ?? "gateway tls: failed to enable");
  }
  const serverStartedAt = Date.now();
  const channelManager = createChannelManager({
    loadConfig: () =>
      applyPluginAutoEnable({
        config: loadConfig(),
        env: process.env,
      }).config,
    channelLogs,
    channelRuntimeEnvs,
    resolveChannelRuntime: getChannelRuntime,
  });
  const getReadiness = createReadinessChecker({
    channelManager,
    startedAt: serverStartedAt,
  });
  try {
    const { ensureContextWindowCacheLoaded } = await import("../agents/context.js");
    await ensureContextWindowCacheLoaded();
  } catch {
    // Best-effort: session defaults will fall back to DEFAULT_CONTEXT_TOKENS.
  }
  log.info("starting HTTP server...");
  const {
    canvasHost,
    releasePluginRouteRegistry,
    httpServer,
    httpServers,
    httpBindHosts,
    wss,
    preauthConnectionBudget,
    clients,
    broadcast,
    broadcastToConnIds,
    agentRunSeq,
    dedupe,
    chatRunState,
    chatRunBuffers,
    chatDeltaSentAt,
    chatDeltaLastBroadcastLen,
    addChatRun,
    removeChatRun,
    chatAbortControllers,
    toolEventRecipients,
  } = await createGatewayRuntimeState({
    cfg: cfgAtStart,
    bindHost,
    port,
    controlUiEnabled,
    controlUiBasePath,
    controlUiRoot: controlUiRootState,
    openAiChatCompletionsEnabled,
    openAiChatCompletionsConfig,
    openResponsesEnabled,
    openResponsesConfig,
    strictTransportSecurityHeader,
    resolvedAuth,
    rateLimiter: authRateLimiter,
    gatewayTls,
    hooksConfig: () => hooksConfig,
    getHookClientIpConfig: () => hookClientIpConfig,
    pluginRegistry,
    pinChannelRegistry: !minimalTestGateway,
    deps,
    canvasRuntime,
    canvasHostEnabled,
    allowCanvasHostInTests: opts.allowCanvasHostInTests,
    logCanvas,
    log,
    logHooks,
    logPlugins,
    getReadiness,
  });
  const disconnectStaleSharedGatewayAuthClients = (expectedGeneration: string | undefined) => {
    for (const gatewayClient of clients) {
      if (!gatewayClient.usesSharedGatewayAuth) {
        continue;
      }
      if (gatewayClient.sharedGatewaySessionGeneration === expectedGeneration) {
        continue;
      }
      try {
        gatewayClient.socket.close(4001, "gateway auth changed");
      } catch {
        /* ignore */
      }
    }
  };
  const setCurrentSharedGatewaySessionGeneration = (nextGeneration: string | undefined) => {
    const previousGeneration = currentSharedGatewaySessionGeneration;
    currentSharedGatewaySessionGeneration = nextGeneration;
    if (requiredSharedGatewaySessionGeneration === nextGeneration) {
      requiredSharedGatewaySessionGeneration = null;
      return;
    }
    if (requiredSharedGatewaySessionGeneration !== null && previousGeneration !== nextGeneration) {
      requiredSharedGatewaySessionGeneration = null;
    }
  };
  const enforceSharedGatewaySessionGenerationForConfigWrite = (nextConfig: KaijiBotConfig) => {
    const reloadMode = resolveGatewayReloadSettings(nextConfig).mode;
    const nextSharedGatewaySessionGeneration =
      resolveSharedGatewaySessionGenerationForRuntimeSnapshot();
    if (reloadMode === "off") {
      currentSharedGatewaySessionGeneration = nextSharedGatewaySessionGeneration;
      requiredSharedGatewaySessionGeneration = nextSharedGatewaySessionGeneration;
      disconnectStaleSharedGatewayAuthClients(nextSharedGatewaySessionGeneration);
      return;
    }
    requiredSharedGatewaySessionGeneration = null;
    setCurrentSharedGatewaySessionGeneration(nextSharedGatewaySessionGeneration);
    disconnectStaleSharedGatewayAuthClients(nextSharedGatewaySessionGeneration);
  };
  let bonjourStop: (() => Promise<void>) | null = null;
  const noopInterval = () => setInterval(() => {}, 1 << 30);
  let tickInterval = noopInterval();
  let healthInterval = noopInterval();
  let dedupeCleanup = noopInterval();
  let mediaCleanup: ReturnType<typeof setInterval> | null = null;
  let heartbeatRunner: HeartbeatRunner = {
    stop: () => {},
    updateConfig: () => {},
  };
  let stopGatewayUpdateCheck = () => {};
  let tailscaleCleanup: (() => Promise<void>) | null = null;
  let skillsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const skillsRefreshDelayMs = 30_000;
  let skillsChangeUnsub = () => {};
  let channelHealthMonitor: ReturnType<typeof startChannelHealthMonitor> | null = null;
  let infoScanSource:
    | InstanceType<
        typeof import("../cognitive/scheduler/event-sources/info-scan-source.js").InfoScanSource
      >
    | undefined;
  // Outer-scope registry for timers/crons started inside async IIFEs so the
  // close handler can stop them. Without this they keep the Node event loop
  // alive after gateway close (croner defaults to unref=false).
  const backgroundStoppable: Array<{ stop: () => void }> = [];
  let stopModelPricingRefresh = () => {};
  let mcpServer: { port: number; close: () => Promise<void> } | undefined;
  let configReloader: { stop: () => Promise<void> } = { stop: async () => {} };
  const closeOnStartupFailure = async () => {
    if (diagnosticsEnabled) {
      stopDiagnosticHeartbeat();
    }
    if (skillsRefreshTimer) {
      clearTimeout(skillsRefreshTimer);
      skillsRefreshTimer = null;
    }
    skillsChangeUnsub();
    authRateLimiter?.dispose();
    browserAuthRateLimiter.dispose();
    stopModelPricingRefresh();
    channelHealthMonitor?.stop();
    clearSecretsRuntimeSnapshot();
    await mcpServer?.close().catch(() => {});
    await createGatewayCloseHandler({
      bonjourStop,
      tailscaleCleanup,
      canvasHost,
      canvasHostServer,
      releasePluginRouteRegistry,
      stopChannel,
      pluginServices,
      cron,
      heartbeatRunner,
      updateCheckStop: stopGatewayUpdateCheck,
      nodePresenceTimers,
      broadcast,
      tickInterval,
      healthInterval,
      dedupeCleanup,
      mediaCleanup,
      agentUnsub,
      heartbeatUnsub,
      transcriptUnsub,
      lifecycleUnsub,
      chatRunState,
      clients,
      configReloader,
      wss,
      httpServer,
      httpServers,
    })({ reason: "gateway startup failed" });
  };
  const nodeRegistry = new NodeRegistry();
  const nodePresenceTimers = new Map<string, ReturnType<typeof setInterval>>();
  const nodeSubscriptions = createNodeSubscriptionManager();
  const sessionEventSubscribers = createSessionEventSubscriberRegistry();
  const sessionMessageSubscribers = createSessionMessageSubscriberRegistry();
  const nodeSendEvent = (opts: { nodeId: string; event: string; payloadJSON?: string | null }) => {
    const payload = safeParseJson(opts.payloadJSON ?? null);
    nodeRegistry.sendEvent(opts.nodeId, opts.event, payload);
  };
  const nodeSendToSession = (sessionKey: string, event: string, payload: unknown) =>
    nodeSubscriptions.sendToSession(sessionKey, event, payload, nodeSendEvent);
  const nodeSendToAllSubscribed = (event: string, payload: unknown) =>
    nodeSubscriptions.sendToAllSubscribed(event, payload, nodeSendEvent);
  const nodeSubscribe = nodeSubscriptions.subscribe;
  const nodeUnsubscribe = nodeSubscriptions.unsubscribe;
  const nodeUnsubscribeAll = nodeSubscriptions.unsubscribeAll;
  const broadcastVoiceWakeChanged = (triggers: string[]) => {
    broadcast("voicewake.changed", { triggers }, { dropIfSlow: true });
  };
  const hasMobileNodeConnected = () => hasConnectedMobileNode(nodeRegistry);
  applyGatewayLaneConcurrency(cfgAtStart);

  let cronState = buildGatewayCronService({
    cfg: cfgAtStart,
    deps,
    broadcast,
  });
  let { cron, storePath: cronStorePath } = cronState;
  deps.cron = cron;

  const { getRuntimeSnapshot, startChannels, startChannel, stopChannel, markChannelLoggedOut } =
    channelManager;
  let agentUnsub: (() => void) | null = null;
  let heartbeatUnsub: (() => void) | null = null;
  let transcriptUnsub: (() => void) | null = null;
  let lifecycleUnsub: (() => void) | null = null;
  try {
    try {
      mcpServer = await startMcpLoopbackServer(0);
      log.info(`MCP loopback server listening on http://127.0.0.1:${mcpServer.port}/mcp`);
    } catch (error) {
      log.warn(`MCP loopback server failed to start: ${String(error)}`);
    }

    if (!minimalTestGateway) {
      const machineDisplayName = await getMachineDisplayName();
      const discovery = await startGatewayDiscovery({
        machineDisplayName,
        port,
        gatewayTls: gatewayTls.enabled
          ? { enabled: true, fingerprintSha256: gatewayTls.fingerprintSha256 }
          : undefined,
        wideAreaDiscoveryEnabled: cfgAtStart.discovery?.wideArea?.enabled === true,
        wideAreaDiscoveryDomain: cfgAtStart.discovery?.wideArea?.domain,
        tailscaleMode,
        mdnsMode: cfgAtStart.discovery?.mdns?.mode,
        logDiscovery,
      });
      bonjourStop = discovery.bonjourStop;
    }

    if (!minimalTestGateway) {
      setSkillsRemoteRegistry(nodeRegistry);
      void primeRemoteSkillsCache();
    }
    // Debounce skills-triggered node probes to avoid feedback loops and rapid-fire invokes.
    // Skills changes can happen in bursts (e.g., file watcher events), and each probe
    // takes time to complete. A 30-second delay ensures we batch changes together.
    skillsChangeUnsub = minimalTestGateway
      ? () => {}
      : registerSkillsChangeListener((event) => {
          if (event.reason === "remote-node") {
            return;
          }
          if (skillsRefreshTimer) {
            clearTimeout(skillsRefreshTimer);
          }
          skillsRefreshTimer = setTimeout(() => {
            skillsRefreshTimer = null;
            const latest = loadConfig();
            void refreshRemoteBinsForConnectedNodes(latest);
          }, skillsRefreshDelayMs);
        });

    if (!minimalTestGateway) {
      startTaskRegistryMaintenance();
      ({ tickInterval, healthInterval, dedupeCleanup, mediaCleanup } =
        startGatewayMaintenanceTimers({
          broadcast,
          nodeSendToAllSubscribed,
          getPresenceVersion,
          getHealthVersion,
          refreshGatewayHealthSnapshot,
          logHealth,
          dedupe,
          chatAbortControllers,
          chatRunState,
          chatRunBuffers,
          chatDeltaSentAt,
          chatDeltaLastBroadcastLen,
          removeChatRun,
          agentRunSeq,
          nodeSendToSession,
          ...(typeof cfgAtStart.media?.ttlHours === "number"
            ? { mediaCleanupTtlMs: resolveMediaCleanupTtlMs(cfgAtStart.media.ttlHours) }
            : {}),
        }));
    }

    agentUnsub = minimalTestGateway
      ? null
      : onAgentEvent(
          createAgentEventHandler({
            broadcast,
            broadcastToConnIds,
            nodeSendToSession,
            agentRunSeq,
            chatRunState,
            resolveSessionKeyForRun,
            clearAgentRunContext,
            toolEventRecipients,
            sessionEventSubscribers,
            isChatSendRunActive: (runId) => chatAbortControllers.has(runId),
          }),
        );

    heartbeatUnsub = minimalTestGateway
      ? null
      : onHeartbeatEvent((evt) => {
          broadcast("heartbeat", evt, { dropIfSlow: true });
        });

    transcriptUnsub = minimalTestGateway
      ? null
      : onSessionTranscriptUpdate((update) => {
          const sessionKey =
            update.sessionKey ?? resolveSessionKeyForTranscriptFile(update.sessionFile);
          if (!sessionKey || update.message === undefined) {
            return;
          }
          const connIds = new Set<string>();
          for (const connId of sessionEventSubscribers.getAll()) {
            connIds.add(connId);
          }
          for (const connId of sessionMessageSubscribers.get(sessionKey)) {
            connIds.add(connId);
          }
          if (connIds.size === 0) {
            return;
          }
          const { entry, storePath } = loadSessionEntry(sessionKey);
          const messageSeq = entry?.sessionId
            ? readSessionMessages(entry.sessionId, storePath, entry.sessionFile).length
            : undefined;
          const sessionRow = loadGatewaySessionRow(sessionKey);
          const sessionSnapshot = sessionRow
            ? {
                session: sessionRow,
                updatedAt: sessionRow.updatedAt ?? undefined,
                sessionId: sessionRow.sessionId,
                kind: sessionRow.kind,
                channel: sessionRow.channel,
                subject: sessionRow.subject,
                groupChannel: sessionRow.groupChannel,
                space: sessionRow.space,
                chatType: sessionRow.chatType,
                origin: sessionRow.origin,
                spawnedBy: sessionRow.spawnedBy,
                spawnedWorkspaceDir: sessionRow.spawnedWorkspaceDir,
                forkedFromParent: sessionRow.forkedFromParent,
                spawnDepth: sessionRow.spawnDepth,
                subagentRole: sessionRow.subagentRole,
                subagentControlScope: sessionRow.subagentControlScope,
                label: sessionRow.label,
                displayName: sessionRow.displayName,
                deliveryContext: sessionRow.deliveryContext,
                parentSessionKey: sessionRow.parentSessionKey,
                childSessions: sessionRow.childSessions,
                thinkingLevel: sessionRow.thinkingLevel,
                fastMode: sessionRow.fastMode,
                verboseLevel: sessionRow.verboseLevel,
                reasoningLevel: sessionRow.reasoningLevel,
                elevatedLevel: sessionRow.elevatedLevel,
                sendPolicy: sessionRow.sendPolicy,
                systemSent: sessionRow.systemSent,
                abortedLastRun: sessionRow.abortedLastRun,
                inputTokens: sessionRow.inputTokens,
                outputTokens: sessionRow.outputTokens,
                lastChannel: sessionRow.lastChannel,
                lastTo: sessionRow.lastTo,
                lastAccountId: sessionRow.lastAccountId,
                lastThreadId: sessionRow.lastThreadId,
                totalTokens: sessionRow.totalTokens,
                totalTokensFresh: sessionRow.totalTokensFresh,
                contextTokens: sessionRow.contextTokens,
                estimatedCostUsd: sessionRow.estimatedCostUsd,
                responseUsage: sessionRow.responseUsage,
                modelProvider: sessionRow.modelProvider,
                model: sessionRow.model,
                status: sessionRow.status,
                startedAt: sessionRow.startedAt,
                endedAt: sessionRow.endedAt,
                runtimeMs: sessionRow.runtimeMs,
                compactionCheckpointCount: sessionRow.compactionCheckpointCount,
                latestCompactionCheckpoint: sessionRow.latestCompactionCheckpoint,
              }
            : {};
          const message = attachKaijiBotTranscriptMeta(update.message, {
            ...(typeof update.messageId === "string" ? { id: update.messageId } : {}),
            ...(typeof messageSeq === "number" ? { seq: messageSeq } : {}),
          });
          broadcastToConnIds(
            "session.message",
            {
              sessionKey,
              message,
              ...(typeof update.messageId === "string" ? { messageId: update.messageId } : {}),
              ...(typeof messageSeq === "number" ? { messageSeq } : {}),
              ...sessionSnapshot,
            },
            connIds,
            { dropIfSlow: true },
          );

          const sessionEventConnIds = sessionEventSubscribers.getAll();
          if (sessionEventConnIds.size > 0) {
            broadcastToConnIds(
              "sessions.changed",
              {
                sessionKey,
                phase: "message",
                ts: Date.now(),
                ...(typeof update.messageId === "string" ? { messageId: update.messageId } : {}),
                ...(typeof messageSeq === "number" ? { messageSeq } : {}),
                ...sessionSnapshot,
              },
              sessionEventConnIds,
              { dropIfSlow: true },
            );
          }
        });

    lifecycleUnsub = minimalTestGateway
      ? null
      : onSessionLifecycleEvent((event) => {
          const connIds = sessionEventSubscribers.getAll();
          if (connIds.size === 0) {
            return;
          }
          const sessionRow = loadGatewaySessionRow(event.sessionKey);
          broadcastToConnIds(
            "sessions.changed",
            {
              sessionKey: event.sessionKey,
              reason: event.reason,
              parentSessionKey: event.parentSessionKey,
              label: event.label,
              displayName: event.displayName,
              ts: Date.now(),
              ...(sessionRow
                ? {
                    updatedAt: sessionRow.updatedAt ?? undefined,
                    sessionId: sessionRow.sessionId,
                    kind: sessionRow.kind,
                    channel: sessionRow.channel,
                    subject: sessionRow.subject,
                    groupChannel: sessionRow.groupChannel,
                    space: sessionRow.space,
                    chatType: sessionRow.chatType,
                    origin: sessionRow.origin,
                    spawnedBy: sessionRow.spawnedBy,
                    spawnedWorkspaceDir: sessionRow.spawnedWorkspaceDir,
                    forkedFromParent: sessionRow.forkedFromParent,
                    spawnDepth: sessionRow.spawnDepth,
                    subagentRole: sessionRow.subagentRole,
                    subagentControlScope: sessionRow.subagentControlScope,
                    label: event.label ?? sessionRow.label,
                    displayName: event.displayName ?? sessionRow.displayName,
                    deliveryContext: sessionRow.deliveryContext,
                    parentSessionKey: event.parentSessionKey ?? sessionRow.parentSessionKey,
                    childSessions: sessionRow.childSessions,
                    thinkingLevel: sessionRow.thinkingLevel,
                    fastMode: sessionRow.fastMode,
                    verboseLevel: sessionRow.verboseLevel,
                    reasoningLevel: sessionRow.reasoningLevel,
                    elevatedLevel: sessionRow.elevatedLevel,
                    sendPolicy: sessionRow.sendPolicy,
                    systemSent: sessionRow.systemSent,
                    abortedLastRun: sessionRow.abortedLastRun,
                    inputTokens: sessionRow.inputTokens,
                    outputTokens: sessionRow.outputTokens,
                    lastChannel: sessionRow.lastChannel,
                    lastTo: sessionRow.lastTo,
                    lastAccountId: sessionRow.lastAccountId,
                    lastThreadId: sessionRow.lastThreadId,
                    totalTokens: sessionRow.totalTokens,
                    totalTokensFresh: sessionRow.totalTokensFresh,
                    contextTokens: sessionRow.contextTokens,
                    estimatedCostUsd: sessionRow.estimatedCostUsd,
                    responseUsage: sessionRow.responseUsage,
                    modelProvider: sessionRow.modelProvider,
                    model: sessionRow.model,
                    status: sessionRow.status,
                    startedAt: sessionRow.startedAt,
                    endedAt: sessionRow.endedAt,
                    runtimeMs: sessionRow.runtimeMs,
                    compactionCheckpointCount: sessionRow.compactionCheckpointCount,
                    latestCompactionCheckpoint: sessionRow.latestCompactionCheckpoint,
                  }
                : {}),
            },
            connIds,
            { dropIfSlow: true },
          );
        });

    let insightDeliveryOutcomeHandler:
      | ((params: {
          agentId: string;
          sessionKey: string;
          insightId: string;
          delivered: boolean;
        }) => Promise<void>)
      | undefined;

    if (!minimalTestGateway) {
      heartbeatRunner = startHeartbeatRunner({
        cfg: cfgAtStart,
        onInsightDeliveryOutcome: async (params) => {
          if (insightDeliveryOutcomeHandler) {
            await insightDeliveryOutcomeHandler(params);
          }
        },
      });
    }

    // Cognitive layer: deferred to post-ready — the scheduler only fires
    // on timers/events, so nothing depends on it being synchronous here.
    if (
      !minimalTestGateway &&
      cfgAtStart.cognitive?.proactive?.enabled !== false &&
      cfgAtStart.cognitive?.enabled !== false
    ) {
      void (async () => {
        try {
          const { ProactiveScheduler } =
            await import("../cognitive/scheduler/proactive-scheduler.js");
          const { InfoScanSource } =
            await import("../cognitive/scheduler/event-sources/info-scan-source.js");
          const { PersonaChangeSource } =
            await import("../cognitive/scheduler/event-sources/persona-change-source.js");
          const { PersonaStore } = await import("../cognitive/persona/store.js");
          const { resolveConfigDir } = await import("../utils.js");
          const {
            generateInsightCandidatesLLM,
            createDefaultInsightDeps,
            loadIdentityContextForInsight,
          } = await import("../cognitive/insight/llm-engine.js");
          const cognitiveStore = new PersonaStore(resolveConfigDir());
          await cognitiveStore.migrateFromFlatLayout();
          const baseInsightDeps = createDefaultInsightDeps();

          insightDeliveryOutcomeHandler = async ({ agentId, sessionKey, insightId, delivered }) => {
            const { resolveCognitiveUserId } = await import("../cognitive/identity.js");
            const userId = resolveCognitiveUserId(sessionKey);
            if (!userId) {
              return;
            }
            if (delivered) {
              await cognitiveStore.update(agentId, userId, (persona) => {
                const awaiting = persona.feedbackProfile.awaitingDeliveryConfirmation;
                if (awaiting) {
                  persona = ProactiveScheduler.finalizeDelivery(
                    persona,
                    awaiting.eventTimestamp,
                    awaiting.candidate,
                    awaiting.opportunityType,
                  );
                  persona.feedbackProfile.awaitingDeliveryConfirmation = null;
                }
                if (persona.feedbackProfile.pendingInsightDelivery) {
                  persona.feedbackProfile.pendingInsightDelivery = null;
                }
                return persona;
              });
              return;
            }
            const { InsightStore: InsightStoreCls } = await import("../cognitive/insight/store.js");
            const insightStore = new InsightStoreCls(resolveConfigDir());
            const record = await insightStore.load(agentId, userId, insightId);
            if (!record) {
              await cognitiveStore.update(agentId, userId, (persona) => {
                persona.feedbackProfile.awaitingDeliveryConfirmation = null;
                return persona;
              });
              return;
            }
            await cognitiveStore.update(agentId, userId, (persona) => {
              const awaiting = persona.feedbackProfile.awaitingDeliveryConfirmation;
              const existing = persona.feedbackProfile.pendingInsightDelivery;
              if (existing && existing.generatedAt > record.generatedAt) {
                persona.feedbackProfile.awaitingDeliveryConfirmation = null;
                return persona;
              }
              const candidate: import("../cognitive/insight/types.js").InsightCandidate =
                awaiting?.candidate ?? {
                  id: record.id,
                  content: record.content,
                  rationale: record.rationale,
                  targetDomains: record.targetDomains,
                  sourceDomains: record.sourceDomains,
                  relevanceScore: 0,
                  surpriseScore: 0,
                  compositeScore: 0,
                  sources: record.sources,
                  verificationStatus: "verified",
                  ...(record.resolvedMode ? { resolvedMode: record.resolvedMode } : {}),
                  ...(record.promptVariant ? { promptVariant: record.promptVariant } : {}),
                };
              persona.feedbackProfile.pendingInsightDelivery = {
                candidate,
                generatedAt: awaiting?.eventTimestamp ?? record.generatedAt,
                opportunityType: awaiting?.opportunityType ?? "redelivery",
                attemptCount: (existing?.attemptCount ?? 0) + 1,
              };
              persona.feedbackProfile.awaitingDeliveryConfirmation = null;
              const ts = awaiting?.eventTimestamp ?? record.generatedAt;
              if (ts > persona.feedbackProfile.lastProactiveAt) {
                persona.feedbackProfile.lastProactiveAt = ts;
              }
              const contents = [
                ...(persona.feedbackProfile.recentInsightContents ?? []),
                candidate.content,
              ].slice(-5);
              persona.feedbackProfile.recentInsightContents = contents;
              const ids = [...(persona.feedbackProfile.recentInsightIds ?? []), candidate.id].slice(
                -20,
              );
              persona.feedbackProfile.recentInsightIds = ids;
              return persona;
            });
          };

          const insightDeps = {
            ...baseInsightDeps,
            webSearch: async (query: string) => {
              try {
                const { runWebSearch } = await import("../web-search/runtime.js");
                const { result } = await runWebSearch({
                  config: cfgAtStart,
                  args: { query, count: 3 },
                });
                const results = (result as Record<string, unknown>).results as
                  | Array<{ title: string; url: string; snippet?: string; description?: string }>
                  | undefined;
                const SEARCH_PROVIDER_HOSTS = new Set([
                  "exa.ai",
                  "api.exa.ai",
                  "tavily.com",
                  "api.tavily.com",
                  "search.brave.com",
                ]);
                return (results ?? [])
                  .filter((r) => {
                    try {
                      const hostname = new URL(r.url).hostname.toLowerCase();
                      return !SEARCH_PROVIDER_HOSTS.has(hostname);
                    } catch {
                      return true;
                    }
                  })
                  .map((r) => ({
                    title: String(r.title ?? ""),
                    url: String(r.url ?? ""),
                    snippet: String(r.snippet ?? r.description ?? ""),
                  }));
              } catch {
                return [];
              }
            },
          };

          const personaChangeSource = new PersonaChangeSource();
          const scanIntervalMs =
            (cfgAtStart.cognitive?.insight?.sources?.scanIntervalHours ?? 6) * 3600_000;
          infoScanSource = new InfoScanSource(scanIntervalMs);

          // ── Insight engine setup ──
          const { FragmentStore: FragmentStoreCtor } =
            await import("../cognitive/insight/fragment-store.js");
          const sharedFragmentStore = new FragmentStoreCtor(resolveConfigDir());

          const engineMode = cfgAtStart.cognitive?.insight?.engine ?? "dual";
          const normalizedMode =
            engineMode === "v2"
              ? "pattern"
              : engineMode === "v1"
                ? "knowledge"
                : engineMode === "dual"
                  ? "unified"
                  : engineMode;
          log.info(`cognitive insight engine: ${normalizedMode} active (requested: ${engineMode})`);

          const proactiveScheduler = new ProactiveScheduler(
            {
              minIntervalHours: cfgAtStart.cognitive?.proactive?.minIntervalHours ?? 0.5,
              minTrustScore: 0.5,
              activeHoursStart: cfgAtStart.cognitive?.proactive?.activeHours?.start,
              activeHoursEnd: cfgAtStart.cognitive?.proactive?.activeHours?.end,
              timezone: cfgAtStart.cognitive?.proactive?.activeHours?.timezone,
              patternVerification: cfgAtStart.cognitive?.insight?.patternVerification,
              llmFreshnessCheck: cfgAtStart.cognitive?.insight?.llmFreshnessCheck,
              epsilonGreedy: cfgAtStart.cognitive?.proactive?.epsilonGreedy,
              costFalseNegative: cfgAtStart.cognitive?.proactive?.costFalseNegative,
              costFalseAlarm: cfgAtStart.cognitive?.proactive?.costFalseAlarm,
            },
            {
              loadPersona: async (agentId, userId) => cognitiveStore.load(agentId, userId),
              savePersona: async (agentId, userId, persona) => {
                await cognitiveStore.save(agentId, userId, persona);
                const domainKeys = Object.keys(persona.domains);
                personaChangeSource.checkPersonaUpdate(userId, domainKeys);
              },
              async onInsightReady(agentId: string, userId: string, candidate) {
                const record: import("../cognitive/types.js").InsightRecord = {
                  id: candidate.id,
                  generatedAt: Date.now(),
                  triggerSource: "scheduled",
                  targetDomains: candidate.targetDomains,
                  sourceDomains: candidate.sourceDomains,
                  content: candidate.content,
                  rationale: candidate.rationale,
                  sources: candidate.sources,
                  deliveredAt: Date.now(),
                  resolvedMode: candidate.resolvedMode,
                  promptVariant: candidate.promptVariant,
                };

                try {
                  const { resolveConfigDir } = await import("../utils.js");
                  const { InsightStore } = await import("../cognitive/insight/store.js");
                  const insightStore = new InsightStore(resolveConfigDir());
                  await insightStore.save(agentId, userId, record);
                } catch (err) {
                  log.warn(`cognitive insight persistence failed: ${String(err)}`);
                }

                try {
                  const { findSessionKeyForUserId } = await import("./cognitive-delivery.js");
                  const { enqueueSystemEvent } = await import("../infra/system-events.js");
                  const { requestHeartbeatNow } = await import("../infra/heartbeat-wake.js");

                  const insightText = candidate.content;
                  const sessionKey = findSessionKeyForUserId(cfgAtStart, userId, agentId);
                  if (sessionKey) {
                    enqueueSystemEvent(
                      `[Cognitive Insight] ${insightText}\n（这是一条已生成的主动洞察，请用你自己的语言自然地分享给用户。）`,
                      { sessionKey, contextKey: `insight:${record.id}` },
                    );
                    requestHeartbeatNow({ reason: "cognitive-insight", sessionKey });
                    log.info(`cognitive insight enqueued for heartbeat delivery to ${userId}`, {
                      sessionKey,
                    });
                    return true;
                  } else {
                    log.info(
                      `cognitive insight: no routable session for ${userId}, skipping delivery`,
                    );
                    return false;
                  }
                } catch (err) {
                  log.warn(`cognitive insight delivery failed: ${String(err)}`);
                  return false;
                }
              },
            },
            {
              insightGenerator: async (persona, input, options) => {
                const identityContext = await loadIdentityContextForInsight(defaultWorkspaceDir);
                const enrichedInput = {
                  ...input,
                  ...(identityContext ? { identityContext } : {}),
                };
                return generateInsightCandidatesLLM(
                  persona,
                  enrichedInput,
                  cfgAtStart,
                  insightDeps,
                  {
                    maxCandidates: options?.maxCandidates,
                    timeout: 20_000,
                  },
                );
              },
              fragmentStore: sharedFragmentStore,
              llmDeps: insightDeps,
              botConfig: cfgAtStart,
            },
          );

          const handleEventForAllUsers = async (event: SchedulerEvent) => {
            const agentIds = await cognitiveStore.listAgentIds();
            const allEntries: Array<{ agentId: string; userId: string }> = [];
            for (const agentId of agentIds) {
              const userIds = (await cognitiveStore.listUserIds(agentId)).filter(
                (id) => !id.startsWith("kaijibot-"),
              );
              for (const userId of userIds) {
                allEntries.push({ agentId, userId });
              }
            }
            for (const { agentId, userId } of allEntries) {
              try {
                await proactiveScheduler.processEvent(userId, event, agentId);
              } catch (e) {
                log.warn(`cognitive event failed for ${agentId}/${userId}: ${String(e)}`);
              }
            }
          };
          personaChangeSource.onEvent(handleEventForAllUsers);
          infoScanSource.onEvent(handleEventForAllUsers);
          infoScanSource.start();
          const schedulerIntervalMs = process.env.KAIJIBOT_COGNITIVE_TEST_INTERVAL_MS
            ? Number(process.env.KAIJIBOT_COGNITIVE_TEST_INTERVAL_MS)
            : (cfgAtStart.cognitive?.proactive?.minIntervalHours ?? 0.5) * 3600_000;
          proactiveScheduler.start(async () => {
            const agentIds = await cognitiveStore.listAgentIds();
            const entries: Array<{ agentId: string; userId: string }> = [];
            for (const agentId of agentIds) {
              const userIds = (await cognitiveStore.listUserIds(agentId)).filter(
                (id) => !id.startsWith("kaijibot-"),
              );
              for (const userId of userIds) {
                entries.push({ agentId, userId });
              }
            }
            return entries;
          }, schedulerIntervalMs);
          backgroundStoppable.push(proactiveScheduler);

          log.info(
            `cognitive proactive scheduler started (interval=${schedulerIntervalMs}ms, multi-user timer + info-scan + persona-change)`,
          );
        } catch (err) {
          log.warn(`cognitive scheduler skipped: ${String(err)}`);
        }
      })();
    }

    if (!minimalTestGateway && cfgAtStart.cognitive?.enabled !== false) {
      void (async () => {
        try {
          const { resolveConsolidationConfig } =
            await import("../memory-host-sdk/consolidation.js");
          const consolidationConfig = resolveConsolidationConfig({
            pluginConfig: {},
            cfg: cfgAtStart,
          });
          if (!consolidationConfig.enabled) {
            return;
          }

          const { runConsolidationAllAgents } =
            await import("../../extensions/memory-core/index.js");
          type ConsolidationDeps =
            import("../../extensions/memory-core/index.js").ConsolidationDeps;
          const { PersonaStore } = await import("../cognitive/persona/store.js");
          const { FragmentStore } = await import("../cognitive/insight/fragment-store.js");
          const { CorrectionStore } = await import("../cognitive/correction/store.js");
          const { listSessionFilesForAgent } =
            await import("../memory-host-sdk/host/session-files.js");
          const { resolveConfigDir } = await import("../utils.js");
          const { resolveConsolidationWorkspaces } =
            await import("../memory-host-sdk/consolidation.js");
          const { resolveUserIdForSessionFile } =
            await import("../memory-host-sdk/consolidation-userid.js");
          const { createBackgroundGenerateText } =
            await import("../cognitive/evolution/standalone-generate.js");

          type TypedInsight = import("../cognitive/types.js").TypedInsight;
          type InsightCategory = import("../cognitive/types.js").InsightCategory;
          type Fragment = import("../cognitive/insight/fragment-types.js").Fragment;
          type CorrectionRecord = import("../cognitive/correction/types.js").CorrectionRecord;
          type ExtractedItem =
            import("../../extensions/memory-core/src/consolidation-types.js").ExtractedItem;
          const { mergeTypedInsights, HALF_LIFE_BY_CATEGORY } =
            await import("../cognitive/persona/curator.js");

          const configDir = resolveConfigDir();
          const personaStore = new PersonaStore(configDir);
          const correctionStore = new CorrectionStore(configDir);
          const fragmentStore = new FragmentStore(configDir);
          const generateFn = await createBackgroundGenerateText(cfgAtStart);

          const deps: ConsolidationDeps = {
            listSessionFiles: async (_agentId: string, _lookbackDays: number) => {
              return listSessionFilesForAgent(_agentId);
            },
            readSessionFile: async (filePath: string) => {
              const fs = await import("node:fs/promises");
              const { preprocessSessionTranscript } =
                await import("../hooks/bundled/session-memory/transcript.js");
              const raw = await fs.readFile(filePath, "utf-8");
              return preprocessSessionTranscript(raw) ?? "";
            },
            generateText: generateFn,
            resolveWorkspaces: (cfg) => resolveConsolidationWorkspaces(cfg),
            resolveUserIdForFile: (filePath) => resolveUserIdForSessionFile(filePath),
            routeDeps: {
              mergeTypedInsights: async (
                agentId: string,
                userId: string,
                items: ExtractedItem[],
              ): Promise<number> => {
                const now = Date.now();

                const domainGroups = new Map<string, TypedInsight[]>();
                for (const item of items) {
                  const key = item.domains?.[0] || item.category;
                  const group = domainGroups.get(key) ?? [];
                  group.push({
                    text: item.content,
                    category: item.category as InsightCategory,
                    confidence: item.confidence,
                    source: "inferred" as const,
                    firstObserved: now,
                    lastReinforced: now,
                    evidenceCount: 1,
                    halfLifeDays: HALF_LIFE_BY_CATEGORY[item.category as InsightCategory] ?? 30,
                  });
                  domainGroups.set(key, group);
                }

                let merged = 0;
                await personaStore.update(agentId, userId, (persona) => {
                  for (const [domainKey, incoming] of domainGroups) {
                    let domain = persona.domains[domainKey];
                    if (!domain) {
                      domain = {
                        depth: 1,
                        recurrence: 1,
                        lastMentioned: now,
                        keyInsights: [],
                        insights: [],
                        activeQuestions: [],
                        negationSignals: 0,
                      };
                      persona.domains[domainKey] = domain;
                    }
                    const before = (domain.insights ?? []).length;
                    domain.insights = mergeTypedInsights(domain.insights ?? [], incoming);
                    const after = domain.insights.length;
                    merged += Math.max(0, after - before);
                    domain.lastMentioned = now;
                    domain.recurrence += incoming.length;
                  }
                  return persona;
                });
                return merged;
              },
              addOrReinforceCorrection: async (
                agentId: string,
                userId: string,
                record: {
                  domain: string;
                  trigger: string;
                  mistake: string;
                  correction: string;
                  provenance: string;
                },
              ): Promise<string> => {
                const now = Date.now();
                const fullRecord: CorrectionRecord = {
                  id: `consolidation-${now}-${Math.random().toString(36).slice(2, 8)}`,
                  domain: record.domain,
                  trigger: record.trigger,
                  mistake: record.mistake,
                  correction: record.correction,
                  provenance: record.provenance as "self" | "user" | "consolidation",
                  reinforcedCount: 0,
                  createdAt: now,
                  lastReinforced: now,
                };
                const result = await correctionStore.addOrReinforce(agentId, userId, fullRecord);
                return result;
              },
              appendToMemoryFile: async (
                workspaceDir: string,
                content: string,
                localDateStr?: string,
              ) => {
                const fs = await import("node:fs/promises");
                const path = await import("node:path");
                const now = new Date();
                const y = now.getFullYear().toString();
                const m = (now.getMonth() + 1).toString().padStart(2, "0");
                const d = now.getDate().toString().padStart(2, "0");
                const fallback = `${y}-${m}-${d}`;
                const dayStr = localDateStr ?? fallback;
                const dailyFile = path.join(workspaceDir, "memory", `${dayStr}.md`);
                await fs.mkdir(path.dirname(dailyFile), { recursive: true });
                await fs.appendFile(dailyFile, content, "utf-8");
              },
              collectFragment: async (
                agentId: string,
                userId: string,
                fragment: { text: string; strength: number; domains?: string[] },
              ) => {
                const now = Date.now();
                const fullFragment: Fragment = {
                  id: `consolidation-${now}-${Math.random().toString(36).slice(2, 8)}`,
                  userId,
                  createdAt: now,
                  expiresAt: now + 14 * 86_400_000,
                  kind: "methodological_habit",
                  evidence: fragment.text,
                  domains: fragment.domains ?? [],
                  structuralTag: "consolidation:behavioral_pattern",
                  strength: fragment.strength,
                };
                await fragmentStore.addFragment(agentId, userId, fullFragment);
              },
              updateMemoryIndex: async (params: {
                workspaceDir: string;
                items: ExtractedItem[];
                date: string;
              }): Promise<void> => {
                const { MemoryIndexManager } =
                  await import("../../extensions/memory-core/index.js");
                const nodeFs = await import("node:fs/promises");
                const fsAdapter = {
                  readFile: (p: string) => nodeFs.readFile(p, "utf-8"),
                  writeFile: (p: string, data: string) => nodeFs.writeFile(p, data, "utf-8"),
                  mkdir: async (p: string, opts: { recursive: boolean }) => {
                    await nodeFs.mkdir(p, opts);
                  },
                  rename: (oldPath: string, newPath: string) => nodeFs.rename(oldPath, newPath),
                };
                const indexManager = new MemoryIndexManager({
                  workspaceDir: params.workspaceDir,
                  fs: fsAdapter,
                });

                const index = await indexManager.readIndex();
                const inlineSections = index.inlineSections ?? [];

                const CATEGORY_TO_SECTION: Record<string, string> = {
                  durable: "⚡ Core Memory",
                };

                for (const item of params.items) {
                  const section = CATEGORY_TO_SECTION[item.category];
                  if (!section) {
                    continue;
                  }

                  const contentText = item.content.slice(0, 120).replace(/\n/g, " ").trim();
                  const line = `- ${params.date}: ${contentText}`;

                  const existingSection = inlineSections.find((s) => s.section === section);
                  if (existingSection) {
                    const isDup = existingSection.lines.some((l) => {
                      const existing = l.replace(/^- \d{4}-\d{2}-\d{2}: /, "");
                      return existing.slice(0, 60) === contentText.slice(0, 60);
                    });
                    if (!isDup) {
                      existingSection.lines.push(line);
                    }
                  } else {
                    inlineSections.push({ section, lines: [line] });
                  }
                }

                index.inlineSections = inlineSections;
                await indexManager.writeIndex(index);
                await indexManager.rebalanceIndex();
              },
              routeToWiki: undefined,
            },

            // Memory repair — structural repair step after consolidation routing
            repairDeps: {
              repairMemoryStructure: async (workspaceDir: string) => {
                const { repairMemoryStructure } =
                  await import("../../extensions/memory-core/src/memory-repair.js");
                const nodeFs = await import("node:fs/promises");
                const path = await import("node:path");
                const { parseMemoryIndex, serializeIndex } =
                  await import("../../extensions/memory-core/src/memory-index.js");

                return repairMemoryStructure(workspaceDir, {
                  readRawMemoryIndex: async (wsDir: string) => {
                    try {
                      return await nodeFs.readFile(path.join(wsDir, "MEMORY.md"), "utf-8");
                    } catch {
                      return "";
                    }
                  },
                  writeRawMemoryIndex: async (wsDir: string, content: string) => {
                    const tmpName = `MEMORY.md.repair.${process.pid}.${Date.now()}.tmp`;
                    const tmpPath = path.join(wsDir, tmpName);
                    await nodeFs.writeFile(tmpPath, content, "utf-8");
                    await nodeFs.rename(tmpPath, path.join(wsDir, "MEMORY.md"));
                  },
                  parseMemoryIndex,
                  serializeIndex,
                  readTopicFile: async (topicPath: string) => {
                    try {
                      return await nodeFs.readFile(topicPath, "utf-8");
                    } catch {
                      return null;
                    }
                  },
                  appendToTopicFile: async (topicPath: string, content: string) => {
                    const dir = path.dirname(topicPath);
                    await nodeFs.mkdir(dir, { recursive: true });
                    await nodeFs.appendFile(topicPath, content, "utf-8");
                  },
                  topicFileExists: async (wsDir: string, relativePath: string) => {
                    try {
                      await nodeFs.access(path.join(wsDir, relativePath));
                      return true;
                    } catch {
                      return false;
                    }
                  },
                  listTopicFiles: async (wsDir: string) => {
                    try {
                      return await nodeFs.readdir(path.join(wsDir, "memory", "topics"));
                    } catch {
                      return [];
                    }
                  },
                  generateText: generateFn,
                  backupFile: async (filePath: string) => {
                    const ts = new Date().toISOString().replace(/[:.]/g, "-");
                    const backupPath = `${filePath}.bak.${ts}`;
                    await nodeFs.copyFile(filePath, backupPath);
                    // Rotate: keep last 7 backups
                    const dir = path.dirname(filePath);
                    const base = path.basename(filePath);
                    const backups = (await nodeFs.readdir(dir))
                      .filter((f: string) => f.startsWith(base) && f.includes(".bak."))
                      .toSorted();
                    for (let i = 0; i < backups.length - 7; i++) {
                      await nodeFs.unlink(path.join(dir, backups[i]!)).catch(() => {});
                    }
                    return backupPath;
                  },
                  log: (message: string) => {
                    log.info(`memory-repair: ${message}`);
                  },
                });
              },
            },
          };

          const runConsolidation = async () => {
            try {
              const results = await runConsolidationAllAgents({
                config: consolidationConfig,
                cfg: cfgAtStart,
                deps,
              });
              for (const result of results) {
                log.info(
                  `consolidation: agent=${result.agentId} scanned=${result.scannedFiles} extracted=${result.extractedItems} routed=${result.routedItems} errors=${result.errors.length} duration=${result.durationMs}ms`,
                );
              }
            } catch (err) {
              log.warn(`consolidation run failed: ${String(err)}`);
            }
          };

          const { Cron } = await import("croner");
          const timezone =
            consolidationConfig.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
          const cronJob = new Cron(consolidationConfig.cron, { timezone }, () => {
            void runConsolidation();
          });
          backgroundStoppable.push(cronJob);

          log.info(
            `consolidation scheduled (cron=${consolidationConfig.cron}, tz=${timezone}, lookback=${consolidationConfig.lookbackDays}d, next=${cronJob.nextRun()?.toISOString() ?? "unknown"})`,
          );
        } catch (err) {
          log.warn(`consolidation bootstrap skipped: ${String(err)}`);
        }
      })();
    }

    // Evolution skill lifecycle: remove stale skills daily at 4 AM
    if (
      !minimalTestGateway &&
      cfgAtStart.cognitive?.enabled !== false &&
      cfgAtStart.cognitive?.evolution?.enabled !== false
    ) {
      void (async () => {
        try {
          const { resolveConfigDir } = await import("../utils.js");
          const configDir = resolveConfigDir();
          const { SkillPersistenceWriter } = await import("../cognitive/evolution/skill-writer.js");
          const { SkillLifecycleManager } =
            await import("../cognitive/evolution/skill-lifecycle.js");
          const writer = new SkillPersistenceWriter(configDir);
          const lifecycle = new SkillLifecycleManager(writer);
          const { Cron } = await import("croner");
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const job = new Cron("0 4 * * *", { timezone: tz }, async () => {
            try {
              const archived = await lifecycle.removeStale(30);
              if (archived > 0) {
                log.info(`evolution: archived ${archived} stale skills`);
              }
            } catch (err) {
              log.warn(`evolution removeStale failed: ${String(err)}`);
            }
          });
          backgroundStoppable.push(job);
          log.info(
            `evolution removeStale scheduled (cron=0 4 * * *, next=${job.nextRun()?.toISOString() ?? "unknown"})`,
          );
        } catch (err) {
          log.warn(`evolution removeStale bootstrap skipped: ${String(err)}`);
        }
      })();
    }

    if (!minimalTestGateway) {
      void (async () => {
        try {
          const { resolveWikiConfig, resolveEffectiveVaultRoot } =
            await import("../../extensions/knowledge-wiki/src/config.js");
          const { runWikiIngestAllAgents } =
            await import("../../extensions/knowledge-wiki/src/ingest.js");
          const { resolveConsolidationWorkspaces } =
            await import("../memory-host-sdk/consolidation.js");
          const { createStandaloneGenerateText } =
            await import("../cognitive/evolution/standalone-generate.js");
          const { Cron } = await import("croner");

          const wikiConfig = resolveWikiConfig(
            cfgAtStart.plugins?.entries?.["knowledge-wiki"]?.config as
              | Parameters<typeof resolveWikiConfig>[0]
              | undefined,
          );

          if (!wikiConfig.enabled) {
            return;
          }

          const runWikiIngest = async () => {
            try {
              const workspaces = resolveConsolidationWorkspaces(cfgAtStart);
              const generateText = await createStandaloneGenerateText(cfgAtStart);
              const results = await runWikiIngestAllAgents({
                workspaces,
                resolveVaultRoot: (ws) => resolveEffectiveVaultRoot(wikiConfig, ws),
                generateText,
                config: wikiConfig,
                concurrency: 2,
              });
              for (const result of results) {
                log.info(
                  `wiki ingest: agent=${result.agentIds.join(",")} compiled=${result.compiled} skipped=${result.skipped} errors=${result.errors} duration=${result.durationMs}ms`,
                );
              }
            } catch (err) {
              log.warn(`wiki ingest run failed: ${String(err)}`);
            }
          };

          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const cronJob = new Cron(wikiConfig.cron, { timezone }, () => {
            void runWikiIngest();
          });
          backgroundStoppable.push(cronJob);
          log.info(
            `wiki ingest scheduled (cron=${wikiConfig.cron}, tz=${timezone}, next=${cronJob.nextRun()?.toISOString() ?? "unknown"})`,
          );
        } catch (err) {
          log.warn(`wiki ingest bootstrap skipped: ${String(err)}`);
        }
      })();
    }

    const healthCheckMinutes = cfgAtStart.gateway?.channelHealthCheckMinutes;
    const healthCheckDisabled = healthCheckMinutes === 0;
    const staleEventThresholdMinutes = cfgAtStart.gateway?.channelStaleEventThresholdMinutes;
    const maxRestartsPerHour = cfgAtStart.gateway?.channelMaxRestartsPerHour;
    channelHealthMonitor = healthCheckDisabled
      ? null
      : startChannelHealthMonitor({
          channelManager,
          checkIntervalMs: (healthCheckMinutes ?? 5) * 60_000,
          ...(staleEventThresholdMinutes != null && {
            staleEventThresholdMs: staleEventThresholdMinutes * 60_000,
          }),
          ...(maxRestartsPerHour != null && { maxRestartsPerHour }),
        });

    if (!minimalTestGateway) {
      void cron.start().catch((err) => logCron.error(`failed to start: ${String(err)}`));
    }

    stopModelPricingRefresh =
      !minimalTestGateway && process.env.VITEST !== "1"
        ? startGatewayModelPricingRefresh({ config: cfgAtStart })
        : () => {};

    // Recover pending outbound deliveries from previous crash/restart.
    if (!minimalTestGateway) {
      void (async () => {
        const { recoverPendingDeliveries } = await import("../infra/outbound/delivery-queue.js");
        const { deliverOutboundPayloads } = await import("../infra/outbound/deliver.js");
        const logRecovery = log.child("delivery-recovery");
        await recoverPendingDeliveries({
          deliver: deliverOutboundPayloads,
          log: logRecovery,
          cfg: cfgAtStart,
        });
      })().catch((err) => log.error(`Delivery recovery failed: ${String(err)}`));
    }

    const execApprovalManager = new ExecApprovalManager();
    const execApprovalForwarder = createExecApprovalForwarder();
    const execApprovalIosPushDelivery = createExecApprovalIosPushDelivery({ log });
    const execApprovalHandlers = createExecApprovalHandlers(execApprovalManager, {
      forwarder: execApprovalForwarder,
      iosPushDelivery: execApprovalIosPushDelivery,
    });
    const pluginApprovalManager = new ExecApprovalManager<
      import("../infra/plugin-approvals.js").PluginApprovalRequestPayload
    >();
    const pluginApprovalHandlers = createPluginApprovalHandlers(pluginApprovalManager, {
      forwarder: execApprovalForwarder,
    });
    const secretsHandlers = createSecretsHandlers({
      reloadSecrets: async () => {
        const active = getActiveSecretsRuntimeSnapshot();
        if (!active) {
          throw new Error("Secrets runtime snapshot is not active.");
        }
        const previousSharedGatewaySessionGeneration = currentSharedGatewaySessionGeneration;
        const prepared = await activateRuntimeSecrets(active.sourceConfig, {
          reason: "reload",
          activate: true,
        });
        const nextSharedGatewaySessionGeneration = resolveSharedGatewaySessionGenerationForConfig(
          prepared.config,
        );
        setCurrentSharedGatewaySessionGeneration(nextSharedGatewaySessionGeneration);
        if (previousSharedGatewaySessionGeneration !== nextSharedGatewaySessionGeneration) {
          disconnectStaleSharedGatewayAuthClients(nextSharedGatewaySessionGeneration);
        }
        return { warningCount: prepared.warnings.length };
      },
      resolveSecrets: async ({ commandName, targetIds }) => {
        const { assignments, diagnostics, inactiveRefPaths } =
          resolveCommandSecretsFromActiveRuntimeSnapshot({
            commandName,
            targetIds: new Set(targetIds),
          });
        if (assignments.length === 0) {
          return { assignments: [] as CommandSecretAssignment[], diagnostics, inactiveRefPaths };
        }
        return { assignments, diagnostics, inactiveRefPaths };
      },
    });
    const authHandlers = createAuthHandlers({
      getConfig: () => gatewayPluginConfigAtStart,
      getProviderRegistrations: () => pluginRegistry.providers,
      getManifestRegistry: () =>
        loadPluginManifestRegistry({
          config: gatewayPluginConfigAtStart,
          workspaceDir: defaultWorkspaceDir,
        }),
    });

    const canvasHostServerPort = (canvasHostServer as CanvasHostServer | null)?.port;

    const unavailableGatewayMethods = new Set<string>(minimalTestGateway ? [] : ["chat.history"]);
    const gatewayRequestContext: import("./server-methods/types.js").GatewayRequestContext = {
      deps,
      cron,
      cronStorePath,
      execApprovalManager,
      pluginApprovalManager,
      loadGatewayModelCatalog,
      getHealthCache,
      refreshHealthSnapshot: refreshGatewayHealthSnapshot,
      logHealth,
      logGateway: log,
      incrementPresenceVersion,
      getHealthVersion,
      broadcast,
      broadcastToConnIds,
      nodeSendToSession,
      nodeSendToAllSubscribed,
      nodeSubscribe,
      nodeUnsubscribe,
      nodeUnsubscribeAll,
      hasConnectedMobileNode: hasMobileNodeConnected,
      hasExecApprovalClients: (excludeConnId?: string) => {
        for (const gatewayClient of clients) {
          if (excludeConnId && gatewayClient.connId === excludeConnId) {
            continue;
          }
          const scopes = Array.isArray(gatewayClient.connect.scopes)
            ? gatewayClient.connect.scopes
            : [];
          if (scopes.includes("operator.admin") || scopes.includes("operator.approvals")) {
            return true;
          }
        }
        return false;
      },
      disconnectClientsForDevice: (deviceId: string, opts?: { role?: string }) => {
        for (const gatewayClient of clients) {
          if (gatewayClient.connect.device?.id !== deviceId) {
            continue;
          }
          if (opts?.role && gatewayClient.connect.role !== opts.role) {
            continue;
          }
          try {
            gatewayClient.socket.close(4001, "device removed");
          } catch {
            /* ignore */
          }
        }
      },
      disconnectClientsUsingSharedGatewayAuth: () => {
        for (const gatewayClient of clients) {
          // Trusted-proxy sessions stay up here; only token/password-authenticated
          // clients should be invalidated when the shared gateway secret changes.
          if (!gatewayClient.usesSharedGatewayAuth) {
            continue;
          }
          try {
            gatewayClient.socket.close(4001, "gateway auth changed");
          } catch {
            /* ignore */
          }
        }
      },
      enforceSharedGatewayAuthGenerationForConfigWrite: (nextConfig: KaijiBotConfig) => {
        enforceSharedGatewaySessionGenerationForConfigWrite(nextConfig);
      },
      nodeRegistry,
      agentRunSeq,
      chatAbortControllers,
      chatAbortedRuns: chatRunState.abortedRuns,
      chatRunBuffers: chatRunState.buffers,
      chatDeltaSentAt: chatRunState.deltaSentAt,
      chatDeltaLastBroadcastLen: chatRunState.deltaLastBroadcastLen,
      addChatRun,
      removeChatRun,
      subscribeSessionEvents: sessionEventSubscribers.subscribe,
      unsubscribeSessionEvents: sessionEventSubscribers.unsubscribe,
      subscribeSessionMessageEvents: sessionMessageSubscribers.subscribe,
      unsubscribeSessionMessageEvents: sessionMessageSubscribers.unsubscribe,
      unsubscribeAllSessionEvents: (connId: string) => {
        sessionEventSubscribers.unsubscribe(connId);
        sessionMessageSubscribers.unsubscribeAll(connId);
      },
      getSessionEventSubscriberConnIds: sessionEventSubscribers.getAll,
      registerToolEventRecipient: toolEventRecipients.add,
      dedupe,
      wizardSessions,
      findRunningWizard,
      purgeWizardSession,
      getRuntimeSnapshot,
      startChannel,
      stopChannel,
      markChannelLoggedOut,
      wizardRunner,
      broadcastVoiceWakeChanged,
      unavailableGatewayMethods,
    };

    setFallbackGatewayContextResolver(() => gatewayRequestContext);

    if (!minimalTestGateway) {
      if (deferredConfiguredChannelPluginIds.length > 0) {
        ({ pluginRegistry, gatewayMethods: baseGatewayMethods } = reloadDeferredGatewayPlugins({
          cfg: gatewayPluginConfigAtStart,
          workspaceDir: defaultWorkspaceDir,
          log,
          coreGatewayHandlers,
          baseMethods,
          pluginIds: startupPluginIds,
          logDiagnostics: false,
        }));
        gatewayMethods = listActiveGatewayMethods(baseGatewayMethods);
      }
    }

    attachGatewayWsHandlers({
      wss,
      clients,
      preauthConnectionBudget,
      port,
      gatewayHost: bindHost ?? undefined,
      canvasHostEnabled: Boolean(canvasHost),
      canvasHostServerPort,
      resolvedAuth,
      getResolvedAuth,
      getRequiredSharedGatewaySessionGeneration,
      rateLimiter: authRateLimiter,
      browserRateLimiter: browserAuthRateLimiter,
      gatewayMethods,
      events: GATEWAY_EVENTS,
      logGateway: log,
      logHealth,
      logWsControl,
      extraHandlers: {
        ...pluginRegistry.gatewayHandlers,
        ...execApprovalHandlers,
        ...pluginApprovalHandlers,
        ...secretsHandlers,
        ...authHandlers,
      },
      broadcast,
      context: gatewayRequestContext,
    });
    logGatewayStartup({
      cfg: cfgAtStart,
      bindHost,
      bindHosts: httpBindHosts,
      port,
      tlsEnabled: gatewayTls.enabled,
      pluginCount: pluginRegistry.plugins.length,
      log,
      isNixMode,
      startupStartedAt: opts.startupStartedAt,
    });
    stopGatewayUpdateCheck = minimalTestGateway
      ? () => {}
      : scheduleGatewayUpdateCheck({
          cfg: cfgAtStart,
          log,
          isNixMode,
          onUpdateAvailableChange: (updateAvailable) => {
            const payload: GatewayUpdateAvailableEventPayload = { updateAvailable };
            broadcast(GATEWAY_EVENT_UPDATE_AVAILABLE, payload, { dropIfSlow: true });
          },
        });
    tailscaleCleanup = minimalTestGateway
      ? null
      : await startGatewayTailscaleExposure({
          tailscaleMode,
          resetOnExit: tailscaleConfig.resetOnExit,
          port,
          controlUiBasePath,
          logTailscale,
        });

    if (!minimalTestGateway) {
      log.info("starting channels and sidecars...");
      ({ pluginServices } = await startGatewaySidecars({
        cfg: gatewayPluginConfigAtStart,
        pluginRegistry,
        defaultWorkspaceDir,
        deps,
        startChannels,
        log,
        logHooks,
        logChannels,
      }));
      unavailableGatewayMethods.delete("chat.history");
    }

    // Run gateway_start plugin hook (fire-and-forget)
    if (!minimalTestGateway) {
      const hookRunner = getGlobalHookRunner();
      if (hookRunner?.hasHooks("gateway_start")) {
        void hookRunner.runGatewayStart({ port }, { port }).catch((err) => {
          log.warn(`gateway_start hook failed: ${String(err)}`);
        });
      }
    }

    configReloader = minimalTestGateway
      ? { stop: async () => {} }
      : (() => {
          const { applyHotReload, requestGatewayRestart } = createGatewayReloadHandlers({
            deps,
            broadcast,
            getState: () => ({
              hooksConfig,
              hookClientIpConfig,
              heartbeatRunner,
              cronState,
              channelHealthMonitor,
            }),
            setState: (nextState) => {
              hooksConfig = nextState.hooksConfig;
              hookClientIpConfig = nextState.hookClientIpConfig;
              heartbeatRunner = nextState.heartbeatRunner;
              cronState = nextState.cronState;
              cron = cronState.cron;
              cronStorePath = cronState.storePath;
              deps.cron = cron;
              channelHealthMonitor = nextState.channelHealthMonitor;
            },
            startChannel,
            stopChannel,
            logHooks,
            logChannels,
            logCron,
            logReload,
            createHealthMonitor: (opts: {
              checkIntervalMs: number;
              staleEventThresholdMs?: number;
              maxRestartsPerHour?: number;
            }) =>
              startChannelHealthMonitor({
                channelManager,
                checkIntervalMs: opts.checkIntervalMs,
                ...(opts.staleEventThresholdMs != null && {
                  staleEventThresholdMs: opts.staleEventThresholdMs,
                }),
                ...(opts.maxRestartsPerHour != null && {
                  maxRestartsPerHour: opts.maxRestartsPerHour,
                }),
              }),
          });

          return startGatewayConfigReloader({
            initialConfig: cfgAtStart,
            initialInternalWriteHash: startupInternalWriteHash,
            readSnapshot: readConfigFileSnapshot,
            subscribeToWrites: registerConfigWriteListener,
            onHotReload: async (plan, nextConfig) => {
              const previousSharedGatewaySessionGeneration = currentSharedGatewaySessionGeneration;
              const previousSnapshot = getActiveSecretsRuntimeSnapshot();
              const prepared = await activateRuntimeSecrets(nextConfig, {
                reason: "reload",
                activate: true,
              });
              const nextSharedGatewaySessionGeneration =
                resolveSharedGatewaySessionGenerationForConfig(prepared.config);
              // activateRuntimeSecrets(..., { activate: true }) can make getResolvedAuth()
              // observe the rotated secret before applyHotReload settles; advance current
              // generation now so fresh reconnects are not rejected during that window.
              currentSharedGatewaySessionGeneration = nextSharedGatewaySessionGeneration;
              const sharedGatewaySessionGenerationChanged =
                previousSharedGatewaySessionGeneration !== nextSharedGatewaySessionGeneration;
              if (sharedGatewaySessionGenerationChanged) {
                // Close stale shared-auth sockets before potentially long reload work so old
                // sessions cannot continue receiving broadcasts while auth has rotated.
                disconnectStaleSharedGatewayAuthClients(nextSharedGatewaySessionGeneration);
              }
              try {
                await applyHotReload(plan, prepared.config);
              } catch (err) {
                if (previousSnapshot) {
                  activateSecretsRuntimeSnapshot(previousSnapshot);
                } else {
                  clearSecretsRuntimeSnapshot();
                }
                currentSharedGatewaySessionGeneration = previousSharedGatewaySessionGeneration;
                if (sharedGatewaySessionGenerationChanged) {
                  // Rollback may have allowed reconnects on the transient new generation;
                  // close them immediately so passive sockets cannot linger after revert.
                  disconnectStaleSharedGatewayAuthClients(previousSharedGatewaySessionGeneration);
                }
                throw err;
              }
              setCurrentSharedGatewaySessionGeneration(nextSharedGatewaySessionGeneration);
            },
            onRestart: async (plan, nextConfig) => {
              const previousRequiredSharedGatewaySessionGeneration =
                requiredSharedGatewaySessionGeneration;
              const previousSharedGatewaySessionGeneration = currentSharedGatewaySessionGeneration;
              // Restart checks run with activate:false, so enforce invalidation
              // only after SecretRefs are resolved from prepared.config.
              try {
                const prepared = await activateRuntimeSecrets(nextConfig, {
                  reason: "restart-check",
                  activate: false,
                });
                const nextSharedGatewaySessionGeneration =
                  resolveSharedGatewaySessionGenerationForConfig(prepared.config);
                const restartQueued = requestGatewayRestart(plan, nextConfig);
                if (!restartQueued) {
                  if (
                    previousSharedGatewaySessionGeneration !== nextSharedGatewaySessionGeneration
                  ) {
                    // If restart is unavailable, activate the resolved secrets snapshot so
                    // token/password auth accepts the rotated secret instead of lockout.
                    activateSecretsRuntimeSnapshot(prepared);
                    setCurrentSharedGatewaySessionGeneration(nextSharedGatewaySessionGeneration);
                    requiredSharedGatewaySessionGeneration = null;
                    disconnectStaleSharedGatewayAuthClients(nextSharedGatewaySessionGeneration);
                  } else {
                    requiredSharedGatewaySessionGeneration = null;
                  }
                  return;
                }
                if (previousSharedGatewaySessionGeneration !== nextSharedGatewaySessionGeneration) {
                  requiredSharedGatewaySessionGeneration = nextSharedGatewaySessionGeneration;
                  disconnectStaleSharedGatewayAuthClients(nextSharedGatewaySessionGeneration);
                } else {
                  requiredSharedGatewaySessionGeneration = null;
                }
              } catch (error) {
                requiredSharedGatewaySessionGeneration =
                  previousRequiredSharedGatewaySessionGeneration;
                throw error;
              }
            },
            log: {
              info: (msg) => logReload.info(msg),
              warn: (msg) => logReload.warn(msg),
              error: (msg) => logReload.error(msg),
            },
            watchPath: configSnapshot.path,
          });
        })();
  } catch (err) {
    await closeOnStartupFailure();
    throw err;
  }

  const close = createGatewayCloseHandler({
    bonjourStop,
    tailscaleCleanup,
    canvasHost,
    canvasHostServer,
    releasePluginRouteRegistry,
    stopChannel,
    pluginServices,
    cron,
    heartbeatRunner,
    updateCheckStop: stopGatewayUpdateCheck,
    stopTaskRegistryMaintenance,
    nodePresenceTimers,
    broadcast,
    tickInterval,
    healthInterval,
    dedupeCleanup,
    mediaCleanup,
    agentUnsub,
    heartbeatUnsub,
    transcriptUnsub,
    lifecycleUnsub,
    chatRunState,
    clients,
    configReloader,
    wss,
    httpServer,
    httpServers,
  });

  return {
    close: async (opts) => {
      // Run gateway_stop plugin hook before shutdown
      await runGlobalGatewayStopSafely({
        event: { reason: opts?.reason ?? "gateway stopping" },
        ctx: { port },
        onError: (err) => log.warn(`gateway_stop hook failed: ${String(err)}`),
      });
      if (diagnosticsEnabled) {
        stopDiagnosticHeartbeat();
      }
      if (skillsRefreshTimer) {
        clearTimeout(skillsRefreshTimer);
        skillsRefreshTimer = null;
      }
      skillsChangeUnsub();
      authRateLimiter?.dispose();
      browserAuthRateLimiter.dispose();
      stopModelPricingRefresh();
      channelHealthMonitor?.stop();
      infoScanSource?.stop();
      for (const handle of backgroundStoppable) {
        try {
          handle.stop();
        } catch {}
      }
      clearSecretsRuntimeSnapshot();
      await mcpServer?.close().catch(() => {});
      await close(opts);
    },
  };
}
