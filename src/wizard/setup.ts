import os from "node:os";
import path from "node:path";
import { formatCliCommand } from "../cli/command-format.js";
import { t } from "../cli/i18n/translate.js";
import type {
  GatewayAuthChoice,
  OnboardMode,
  OnboardOptions,
  ResetScope,
} from "../commands/onboard-types.js";
import type { KaijiBotConfig } from "../config/config.js";
import { readConfigFileSnapshot, resolveGatewayPort, writeConfigFile } from "../config/config.js";
import { normalizeSecretInputString } from "../config/types.secrets.js";
import { formatErrorMessage } from "../infra/errors.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";
import { resolveUserPath } from "../utils.js";
import { WizardCancelledError, type WizardPrompter } from "./prompts.js";
import { resolveSetupSecretInputString } from "./setup.secret-input.js";
import type { QuickstartGatewayDefaults, WizardFlow } from "./setup.types.js";

async function resolveAuthChoiceModelSelectionPolicy(params: {
  authChoice: string;
  config: KaijiBotConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  resolvePreferredProviderForAuthChoice: (params: {
    choice: string;
    config?: KaijiBotConfig;
    workspaceDir?: string;
    env?: NodeJS.ProcessEnv;
  }) => Promise<string | undefined>;
}): Promise<{
  preferredProvider?: string;
  promptWhenAuthChoiceProvided: boolean;
  allowKeepCurrent: boolean;
}> {
  const preferredProvider = await params.resolvePreferredProviderForAuthChoice({
    choice: params.authChoice,
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  });

  const { resolvePluginProviders, resolveProviderPluginChoice } =
    await import("../plugins/provider-auth-choice.runtime.js");
  const providers = resolvePluginProviders({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
    mode: "setup",
  });
  const resolvedChoice = resolveProviderPluginChoice({
    providers,
    choice: params.authChoice,
  });
  const matchedProvider =
    resolvedChoice?.provider ??
    (preferredProvider
      ? providers.find((provider) => provider.id.trim() === preferredProvider.trim())
      : undefined);
  const setupPolicy =
    resolvedChoice?.wizard?.modelSelection ?? matchedProvider?.wizard?.setup?.modelSelection;

  return {
    preferredProvider,
    promptWhenAuthChoiceProvided: setupPolicy?.promptWhenAuthChoiceProvided === true,
    allowKeepCurrent: setupPolicy?.allowKeepCurrent ?? true,
  };
}
async function requireRiskAcknowledgement(params: {
  opts: OnboardOptions;
  prompter: WizardPrompter;
}) {
  if (params.opts.acceptRisk === true) {
    return;
  }

  await params.prompter.note(t("cli.wizard.welcome.body"), t("cli.wizard.welcome.title"));

  const ok = await params.prompter.confirm({
    message: t("cli.wizard.welcome.confirmPrompt"),
    initialValue: true,
  });
  if (!ok) {
    throw new WizardCancelledError("risk not accepted");
  }
}

export async function showPrerequisiteChecklist(prompter: WizardPrompter): Promise<boolean> {
  await prompter.note(t("cli.wizard.prereq.body"), t("cli.wizard.prereq.title"));
  return prompter.confirm({
    message: t("cli.wizard.prereq.confirmPrompt"),
    initialValue: true,
  });
}

async function probePrimaryProviderKey(
  config: KaijiBotConfig,
  prompter: WizardPrompter,
): Promise<void> {
  const { resolvePrimaryModel } = await import("../plugins/provider-model-primary.js");
  const primaryModel = resolvePrimaryModel(config.agents?.defaults?.model);
  if (!primaryModel) {
    return;
  }
  const slashIndex = primaryModel.indexOf("/");
  if (slashIndex <= 0) {
    return;
  }
  const provider = primaryModel.slice(0, slashIndex);
  const { probeLlmKeyAndWarn } = await import("./llm-key-probe.js");
  const { resolveEnvApiKey } = await import("../agents/model-auth-env.js");
  const resolved = resolveEnvApiKey(provider);
  if (!resolved?.apiKey) {
    return;
  }
  await probeLlmKeyAndWarn(provider, resolved.apiKey, prompter);
}

export async function runSetupWizard(
  opts: OnboardOptions,
  runtime: RuntimeEnv = defaultRuntime,
  prompter: WizardPrompter,
) {
  const onboardHelpers = await import("../commands/onboard-helpers.js");
  onboardHelpers.printWizardHeader(runtime);
  await prompter.intro(t("cli.wizard.intro"));

  if (opts.acceptRisk !== true) {
    const prereqOk = await showPrerequisiteChecklist(prompter);
    if (!prereqOk) {
      await prompter.outro(t("cli.wizard.cancelledOutro"));
      return;
    }
  }

  await requireRiskAcknowledgement({ opts, prompter });

  const snapshot = await readConfigFileSnapshot();
  let baseConfig: KaijiBotConfig = snapshot.valid
    ? snapshot.exists
      ? (snapshot.sourceConfig ?? snapshot.config)
      : {}
    : {};

  if (snapshot.exists && !snapshot.valid) {
    await prompter.note(onboardHelpers.summarizeExistingConfig(baseConfig), "Invalid config");
    if (snapshot.issues.length > 0) {
      await prompter.note(
        [
          ...snapshot.issues.map((iss) => `- ${iss.path}: ${iss.message}`),
          "",
          "Docs: https://github.com/Kaiji-Z/kaijibot",
        ].join("\n"),
        "Config issues",
      );
    }
    await prompter.outro(
      t("cli.wizard.invalidConfigOutro", { doctorCmd: formatCliCommand("kaijibot doctor") }),
    );
    runtime.exit(1);
    return;
  }

  const compatibilityNotices = snapshot.valid
    ? (await import("../plugins/status.js")).buildPluginCompatibilityNotices({ config: baseConfig })
    : [];
  if (compatibilityNotices.length > 0) {
    const { formatPluginCompatibilityNotice: fmtNotice } = await import("../plugins/status.js");
    await prompter.note(
      [
        `Detected ${compatibilityNotices.length} plugin compatibility notice${compatibilityNotices.length === 1 ? "" : "s"} in the current config.`,
        ...compatibilityNotices.slice(0, 4).map((notice) => `- ${fmtNotice(notice)}`),
        ...(compatibilityNotices.length > 4
          ? [`- ... +${compatibilityNotices.length - 4} more`]
          : []),
        "",
        `Review: ${formatCliCommand("kaijibot doctor")}`,
        `Inspect: ${formatCliCommand("kaijibot plugins inspect --all")}`,
      ].join("\n"),
      "Plugin compatibility",
    );
  }

  if (!snapshot.exists) {
    const {
      detectMigrationSource,
      enumerateSourceAgents,
      enumerateSourceSkills,
      runFreshMigration,
    } = await import("../infra/openclaw-migrator/index.js");
    const migrationSource = detectMigrationSource();
    if (migrationSource) {
      const agentList = await enumerateSourceAgents(migrationSource);
      const skillsList = await enumerateSourceSkills(migrationSource);

      runtime.log(
        `  ${theme.info("→")} Found ${migrationSource.brand} installation at: ${migrationSource.dir}`,
      );
      runtime.log(
        `    Agents: ${agentList.length > 0 ? agentList.map((a) => a.id).join(", ") : "main"}`,
      );
      runtime.log(`    Skills: ${skillsList.length}`);
      runtime.log("");

      const shouldMigrate = await prompter.confirm({
        message: `Import data from ${migrationSource.brand}?`,
        initialValue: true,
      });

      if (shouldMigrate) {
        runtime.log("Running migration...");
        const migrationLog = (msg: string) => runtime.log(`  ${theme.muted(msg)}`);
        const report = await runFreshMigration(
          migrationSource,
          path.resolve(os.homedir(), ".kaijibot"),
          {
            dryRun: false,
            overwrite: false,
            migrateSecrets: false,
            log: migrationLog,
          },
        );

        runtime.log("");
        runtime.log(
          theme.success(
            `Migration complete: ${report.totalChanges} change(s), ${report.totalSkipped} skipped.`,
          ),
        );
        if (report.totalWarnings > 0) {
          runtime.log(theme.warn(`  ${report.totalWarnings} warning(s).`));
        }
        runtime.log("");
      }
    }
  }

  const quickstartHint = `Configure details later via ${formatCliCommand("kaijibot configure")}.`;
  const manualHint = "Configure port, network, Tailscale, and auth options.";
  const explicitFlowRaw = opts.flow?.trim();
  const normalizedExplicitFlow = explicitFlowRaw === "manual" ? "advanced" : explicitFlowRaw;
  if (
    normalizedExplicitFlow &&
    normalizedExplicitFlow !== "quickstart" &&
    normalizedExplicitFlow !== "advanced"
  ) {
    runtime.error(t("cli.wizard.flow.invalidError"));
    runtime.exit(1);
    return;
  }
  const explicitFlow: WizardFlow | undefined =
    normalizedExplicitFlow === "quickstart" || normalizedExplicitFlow === "advanced"
      ? normalizedExplicitFlow
      : undefined;
  let flow: WizardFlow =
    explicitFlow ??
    (await prompter.select({
      message: t("cli.wizard.flowSelect.message"),
      options: [
        {
          value: "quickstart",
          label: t("cli.wizard.flowSelect.quickstartLabel"),
          hint: quickstartHint,
        },
        { value: "advanced", label: t("cli.wizard.flowSelect.advancedLabel"), hint: manualHint },
      ],
      initialValue: "quickstart",
    }));

  if (opts.mode === "remote" && flow === "quickstart") {
    await prompter.note(
      "QuickStart only supports local gateways. Switching to Manual mode.",
      "QuickStart",
    );
    flow = "advanced";
  }

  if (snapshot.exists) {
    await prompter.note(
      onboardHelpers.summarizeExistingConfig(baseConfig),
      "Existing config detected",
    );

    const action = await prompter.select({
      message: t("cli.wizard.existingConfig.message"),
      options: [
        { value: "keep", label: t("cli.wizard.existingConfig.keepLabel") },
        { value: "modify", label: t("cli.wizard.existingConfig.modifyLabel") },
        { value: "reset", label: t("cli.wizard.existingConfig.resetLabel") },
      ],
    });

    if (action === "reset") {
      const workspaceDefault =
        baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE;
      const resetScope = (await prompter.select({
        message: t("cli.wizard.resetScope.message"),
        options: [
          { value: "config", label: t("cli.wizard.resetScope.configOnlyLabel") },
          {
            value: "config+creds+sessions",
            label: t("cli.wizard.resetScope.configCredsSessionsLabel"),
          },
          {
            value: "full",
            label: t("cli.wizard.resetScope.fullLabel"),
          },
        ],
      })) as ResetScope;
      await onboardHelpers.handleReset(resetScope, resolveUserPath(workspaceDefault), runtime);
      baseConfig = {};
    }
  }

  const quickstartGateway: QuickstartGatewayDefaults = (() => {
    const hasExisting =
      typeof baseConfig.gateway?.port === "number" ||
      baseConfig.gateway?.bind !== undefined ||
      baseConfig.gateway?.auth?.mode !== undefined ||
      baseConfig.gateway?.auth?.token !== undefined ||
      baseConfig.gateway?.auth?.password !== undefined ||
      baseConfig.gateway?.customBindHost !== undefined ||
      baseConfig.gateway?.tailscale?.mode !== undefined;

    const bindRaw = baseConfig.gateway?.bind;
    const bind =
      bindRaw === "loopback" ||
      bindRaw === "lan" ||
      bindRaw === "auto" ||
      bindRaw === "custom" ||
      bindRaw === "tailnet"
        ? bindRaw
        : "loopback";

    let authMode: GatewayAuthChoice = "token";
    if (
      baseConfig.gateway?.auth?.mode === "token" ||
      baseConfig.gateway?.auth?.mode === "password"
    ) {
      authMode = baseConfig.gateway.auth.mode;
    } else if (baseConfig.gateway?.auth?.token) {
      authMode = "token";
    } else if (baseConfig.gateway?.auth?.password) {
      authMode = "password";
    }

    const tailscaleRaw = baseConfig.gateway?.tailscale?.mode;
    const tailscaleMode =
      tailscaleRaw === "off" || tailscaleRaw === "serve" || tailscaleRaw === "funnel"
        ? tailscaleRaw
        : "off";

    return {
      hasExisting,
      port: resolveGatewayPort(baseConfig),
      bind,
      authMode,
      tailscaleMode,
      token: baseConfig.gateway?.auth?.token,
      password: baseConfig.gateway?.auth?.password,
      customBindHost: baseConfig.gateway?.customBindHost,
      tailscaleResetOnExit: baseConfig.gateway?.tailscale?.resetOnExit ?? false,
    };
  })();

  if (flow === "quickstart") {
    const formatBind = (value: "loopback" | "lan" | "auto" | "custom" | "tailnet") => {
      if (value === "loopback") {
        return "Loopback (127.0.0.1)";
      }
      if (value === "lan") {
        return "LAN";
      }
      if (value === "custom") {
        return "Custom IP";
      }
      if (value === "tailnet") {
        return "Tailnet (Tailscale IP)";
      }
      return "Auto";
    };
    const formatAuth = (value: GatewayAuthChoice) => {
      if (value === "token") {
        return "Token (default)";
      }
      return "Password";
    };
    const formatTailscale = (value: "off" | "serve" | "funnel") => {
      if (value === "off") {
        return "Off";
      }
      if (value === "serve") {
        return "Serve";
      }
      return "Funnel";
    };
    const quickstartLines = quickstartGateway.hasExisting
      ? [
          "Keeping your current gateway settings:",
          `Gateway port: ${quickstartGateway.port}`,
          `Gateway bind: ${formatBind(quickstartGateway.bind)}`,
          ...(quickstartGateway.bind === "custom" && quickstartGateway.customBindHost
            ? [`Gateway custom IP: ${quickstartGateway.customBindHost}`]
            : []),
          `Gateway auth: ${formatAuth(quickstartGateway.authMode)}`,
          `Tailscale exposure: ${formatTailscale(quickstartGateway.tailscaleMode)}`,
          "Direct to chat channels.",
        ]
      : [
          `Gateway port: ${quickstartGateway.port}`,
          "Gateway bind: Loopback (127.0.0.1)",
          "Gateway auth: Token (default)",
          "Tailscale exposure: Off",
          "Direct to chat channels.",
        ];
    await prompter.note(quickstartLines.join("\n"), "QuickStart");
  }

  const localPort = resolveGatewayPort(baseConfig);
  const localUrl = `ws://127.0.0.1:${localPort}`;
  let localGatewayToken = process.env.KAIJIBOT_GATEWAY_TOKEN;
  try {
    const resolvedGatewayToken = await resolveSetupSecretInputString({
      config: baseConfig,
      value: baseConfig.gateway?.auth?.token,
      path: "gateway.auth.token",
      env: process.env,
    });
    if (resolvedGatewayToken) {
      localGatewayToken = resolvedGatewayToken;
    }
  } catch (error) {
    await prompter.note(
      [
        "Could not resolve gateway.auth.token SecretRef for setup probe.",
        formatErrorMessage(error),
      ].join("\n"),
      "Gateway auth",
    );
  }
  let localGatewayPassword = process.env.KAIJIBOT_GATEWAY_PASSWORD;
  try {
    const resolvedGatewayPassword = await resolveSetupSecretInputString({
      config: baseConfig,
      value: baseConfig.gateway?.auth?.password,
      path: "gateway.auth.password",
      env: process.env,
    });
    if (resolvedGatewayPassword) {
      localGatewayPassword = resolvedGatewayPassword;
    }
  } catch (error) {
    await prompter.note(
      [
        "Could not resolve gateway.auth.password SecretRef for setup probe.",
        formatErrorMessage(error),
      ].join("\n"),
      "Gateway auth",
    );
  }

  const localProbe = await onboardHelpers.probeGatewayReachable({
    url: localUrl,
    token: localGatewayToken,
    password: localGatewayPassword,
  });
  const remoteUrl = baseConfig.gateway?.remote?.url?.trim() ?? "";
  let remoteGatewayToken = normalizeSecretInputString(baseConfig.gateway?.remote?.token);
  try {
    const resolvedRemoteGatewayToken = await resolveSetupSecretInputString({
      config: baseConfig,
      value: baseConfig.gateway?.remote?.token,
      path: "gateway.remote.token",
      env: process.env,
    });
    if (resolvedRemoteGatewayToken) {
      remoteGatewayToken = resolvedRemoteGatewayToken;
    }
  } catch (error) {
    await prompter.note(
      [
        "Could not resolve gateway.remote.token SecretRef for setup probe.",
        formatErrorMessage(error),
      ].join("\n"),
      "Gateway auth",
    );
  }
  const remoteProbe = remoteUrl
    ? await onboardHelpers.probeGatewayReachable({
        url: remoteUrl,
        token: remoteGatewayToken,
      })
    : null;

  const mode =
    opts.mode ??
    (flow === "quickstart"
      ? "local"
      : ((await prompter.select({
          message: t("cli.wizard.modeSelect.message"),
          options: [
            {
              value: "local",
              label: t("cli.wizard.modeSelect.localLabel"),
              hint: localProbe.ok
                ? `Gateway reachable (${localUrl})`
                : `No gateway detected (${localUrl})`,
            },
            {
              value: "remote",
              label: t("cli.wizard.modeSelect.remoteLabel"),
              hint: !remoteUrl
                ? "No remote URL configured yet"
                : remoteProbe?.ok
                  ? `Gateway reachable (${remoteUrl})`
                  : `Configured but unreachable (${remoteUrl})`,
            },
          ],
        })) as OnboardMode));

  if (mode === "remote") {
    const { promptRemoteGatewayConfig } = await import("../commands/onboard-remote.js");
    const { logConfigUpdated } = await import("../config/logging.js");
    let nextConfig = await promptRemoteGatewayConfig(baseConfig, prompter, {
      secretInputMode: opts.secretInputMode,
    });
    nextConfig = onboardHelpers.applyWizardMetadata(nextConfig, { command: "onboard", mode });
    await writeConfigFile(nextConfig);
    logConfigUpdated(runtime);
    await prompter.outro(t("cli.wizard.remoteConfig.outro"));
    return;
  }

  const workspaceInput =
    opts.workspace ??
    (flow === "quickstart"
      ? (baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE)
      : await prompter.text({
          message: t("cli.wizard.workspace.message"),
          initialValue: baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE,
        }));

  const workspaceDir = resolveUserPath(workspaceInput.trim() || onboardHelpers.DEFAULT_WORKSPACE);

  const { applyLocalSetupWorkspaceConfig } = await import("../commands/onboard-config.js");
  let nextConfig: KaijiBotConfig = applyLocalSetupWorkspaceConfig(baseConfig, workspaceDir);

  const { ensureAuthProfileStore } = await import("../agents/auth-profiles.runtime.js");
  const { promptAuthChoiceGrouped } = await import("../commands/auth-choice-prompt.js");
  const { promptCustomApiConfig } = await import("../commands/onboard-custom.js");
  const { applyAuthChoice, resolvePreferredProviderForAuthChoice, warnIfModelConfigLooksOff } =
    await import("../commands/auth-choice.js");
  const { applyPrimaryModel, promptDefaultModel } = await import("../commands/model-picker.js");

  await prompter.note(t("cli.wizard.providerSelect.body"), t("cli.wizard.providerSelect.title"));

  const authStore = ensureAuthProfileStore(undefined, {
    allowKeychainPrompt: false,
  });
  const authChoiceFromPrompt = opts.authChoice === undefined;
  const authChoice =
    opts.authChoice ??
    (await promptAuthChoiceGrouped({
      prompter,
      store: authStore,
      includeSkip: true,
      config: nextConfig,
      workspaceDir,
    }));

  if (authChoice === "custom-api-key") {
    const customResult = await promptCustomApiConfig({
      prompter,
      runtime,
      config: nextConfig,
      secretInputMode: opts.secretInputMode,
    });
    nextConfig = customResult.config;
  } else {
    const authResult = await applyAuthChoice({
      authChoice,
      config: nextConfig,
      prompter,
      runtime,
      setDefaultModel: true,
      opts: {
        tokenProvider: opts.tokenProvider,
        token: opts.authChoice === "apiKey" && opts.token ? opts.token : undefined,
      },
    });
    nextConfig = authResult.config;

    if (authResult.agentModelOverride) {
      nextConfig = applyPrimaryModel(nextConfig, authResult.agentModelOverride);
    }
  }

  const authChoiceModelSelectionPolicy =
    authChoice === "custom-api-key"
      ? undefined
      : await resolveAuthChoiceModelSelectionPolicy({
          authChoice,
          config: nextConfig,
          workspaceDir,
          resolvePreferredProviderForAuthChoice,
        });
  const shouldPromptModelSelection =
    authChoice !== "custom-api-key" &&
    (authChoiceFromPrompt || authChoiceModelSelectionPolicy?.promptWhenAuthChoiceProvided === true);
  if (shouldPromptModelSelection) {
    const modelSelection = await promptDefaultModel({
      config: nextConfig,
      prompter,
      allowKeep: authChoiceModelSelectionPolicy?.allowKeepCurrent ?? true,
      ignoreAllowlist: true,
      includeProviderPluginSetups: true,
      preferredProvider: authChoiceModelSelectionPolicy?.preferredProvider,
      workspaceDir,
      runtime,
    });
    if (modelSelection.config) {
      nextConfig = modelSelection.config;
    }
    if (modelSelection.model) {
      nextConfig = applyPrimaryModel(nextConfig, modelSelection.model);
    }
  }

  await warnIfModelConfigLooksOff(nextConfig, prompter);
  await probePrimaryProviderKey(nextConfig, prompter);

  const { configureGatewayForSetup } = await import("./setup.gateway-config.js");
  const gateway = await configureGatewayForSetup({
    flow,
    baseConfig,
    nextConfig,
    localPort,
    quickstartGateway,
    secretInputMode: opts.secretInputMode,
    prompter,
    runtime,
  });
  nextConfig = gateway.nextConfig;
  const settings = gateway.settings;

  if (opts.skipChannels ?? opts.skipProviders) {
    await prompter.note("Skipping channel setup.", "Channels");
  } else {
    const { listChannelPlugins } = await import("../channels/plugins/index.js");
    const { setupChannels } = await import("../commands/onboard-channels.js");
    const quickstartAllowFromChannels =
      flow === "quickstart"
        ? listChannelPlugins()
            .filter((plugin) => plugin.meta.quickstartAllowFrom)
            .map((plugin) => plugin.id)
        : [];
    nextConfig = await setupChannels(nextConfig, runtime, prompter, {
      allowSignalInstall: true,
      forceAllowFromChannels: quickstartAllowFromChannels,
      skipDmPolicyPrompt: flow === "quickstart",
      skipConfirm: flow === "quickstart",
      quickstartDefaults: flow === "quickstart",
      secretInputMode: opts.secretInputMode,
    });
  }

  await writeConfigFile(nextConfig);
  const { logConfigUpdated } = await import("../config/logging.js");
  logConfigUpdated(runtime);
  await onboardHelpers.ensureWorkspaceAndSessions(workspaceDir, runtime, {
    skipBootstrap: Boolean(nextConfig.agents?.defaults?.skipBootstrap),
  });

  if (opts.skipSearch) {
    await prompter.note("Skipping search setup.", "Search");
  } else {
    const { setupSearch } = await import("../commands/onboard-search.js");
    nextConfig = await setupSearch(nextConfig, runtime, prompter, {
      quickstartDefaults: flow === "quickstart",
      secretInputMode: opts.secretInputMode,
    });
  }

  if (opts.skipSkills) {
    await prompter.note("Skipping skills setup.", "Skills");
  } else {
    const { setupSkills } = await import("../commands/onboard-skills.js");
    nextConfig = await setupSkills(nextConfig, workspaceDir, runtime, prompter);
  }

  // Auto-install lark-cli skills when feishu channel is configured and lark-cli is available
  {
    const { isChannelConfigured } = await import("../config/channel-configured.js");
    if (isChannelConfigured(nextConfig, "feishu")) {
      const { areLarkSkillsInstalled } = await import("../infra/lark-cli/auto-disable.js");
      if (areLarkSkillsInstalled()) {
        await prompter.note("lark-cli skills already installed.", "Lark CLI Skills");
      } else {
        const { installLarkCliSkills } = await import("../infra/lark-cli/install-skills.js");
        try {
          const result = await installLarkCliSkills();
          if (result.ok) {
            const count = result.installed ?? "";
            await prompter.note(
              `Installed ${count} lark-cli skills to ~/.agents/skills/`,
              "Lark CLI Skills",
            );
          } else if (result.error === "lark-cli not available") {
            await prompter.note(
              [
                "lark-cli is not installed — Feishu skills (lark-*) were not set up.",
                "",
                "To install later:",
                "  npm install -g @larksuite/cli",
                "  npx skills add larksuite/cli -g --all",
                "",
                "Then restart the gateway.",
              ].join("\n"),
              "Lark CLI Skills",
            );
          } else {
            runtime.log(`  ⚠ lark-cli skills install failed: ${result.error}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          runtime.log(`  ⚠ lark-cli skills install failed: ${message}`);
        }
      }
    }
  }

  // Plugin configuration (sandbox backends, tool plugins, etc.)
  if (flow !== "quickstart") {
    const { setupPluginConfig } = await import("./setup.plugin-config.js");
    nextConfig = await setupPluginConfig({
      config: nextConfig,
      prompter,
      workspaceDir,
    });
  }

  // Setup hooks (session memory on /new)
  const { setupInternalHooks } = await import("../commands/onboard-hooks.js");
  nextConfig = await setupInternalHooks(nextConfig, runtime, prompter);

  nextConfig = onboardHelpers.applyWizardMetadata(nextConfig, { command: "onboard", mode });
  await writeConfigFile(nextConfig);

  const { finalizeSetupWizard } = await import("./setup.finalize.js");
  const { launchedTui } = await finalizeSetupWizard({
    flow,
    opts,
    baseConfig,
    nextConfig,
    workspaceDir,
    settings,
    prompter,
    runtime,
  });
  if (launchedTui) {
    return;
  }
}
