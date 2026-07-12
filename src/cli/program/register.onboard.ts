import type { Command } from "commander";
import { formatAuthChoiceChoicesForCli } from "../../commands/auth-choice-options.js";
import type { GatewayDaemonRuntime } from "../../commands/daemon-runtime.js";
import { CORE_ONBOARD_AUTH_FLAGS } from "../../commands/onboard-core-auth-flags.js";
import type {
  AuthChoice,
  GatewayAuthChoice,
  GatewayBind,
  NodeManagerChoice,
  ResetScope,
  SecretInputMode,
  TailscaleMode,
} from "../../commands/onboard-types.js";
import { setupWizardCommand } from "../../commands/onboard.js";
import { resolveManifestProviderOnboardAuthFlags } from "../../plugins/provider-auth-choices.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { resolveCliLocale } from "../i18n/registry.js";
import { initCliI18n, t } from "../i18n/translate.js";

function resolveInstallDaemonFlag(
  command: unknown,
  opts: { installDaemon?: boolean },
): boolean | undefined {
  if (!command || typeof command !== "object") {
    return undefined;
  }
  const getOptionValueSource =
    "getOptionValueSource" in command ? command.getOptionValueSource : undefined;
  if (typeof getOptionValueSource !== "function") {
    return undefined;
  }

  // Commander doesn't support option conflicts natively; keep original behavior.
  // If --skip-daemon is explicitly passed, it wins.
  if (getOptionValueSource.call(command, "skipDaemon") === "cli") {
    return false;
  }
  if (getOptionValueSource.call(command, "installDaemon") === "cli") {
    return Boolean(opts.installDaemon);
  }
  return undefined;
}

const AUTH_CHOICE_HELP = formatAuthChoiceChoicesForCli({
  includeLegacyAliases: true,
  includeSkip: true,
});

const ONBOARD_AUTH_FLAGS = [
  ...CORE_ONBOARD_AUTH_FLAGS,
  ...resolveManifestProviderOnboardAuthFlags(),
] as const;

function pickOnboardProviderAuthOptionValues(
  opts: Record<string, unknown>,
): Partial<Record<string, string | undefined>> {
  return Object.fromEntries(
    ONBOARD_AUTH_FLAGS.map((flag) => [flag.optionKey, opts[flag.optionKey] as string | undefined]),
  );
}

export function registerOnboardCommand(program: Command) {
  const command = program
    .command("onboard")
    .description(t("cli.commands.onboard.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/onboard", "gitee.com/kaiji1126/kaijibot/blob/main/docs/cli/onboard.md")}\n`,
    )
    .option("--workspace <dir>", t("cli.commands.onboard.options.workspace"))
    .option("--reset", t("cli.commands.onboard.options.reset"))
    .option("--reset-scope <scope>", t("cli.commands.onboard.options.resetScope"))
    .option("--non-interactive", t("cli.commands.onboard.options.nonInteractive"), false)
    .option("--accept-risk", t("cli.commands.onboard.options.acceptRisk"), false)
    .option("--flow <flow>", t("cli.commands.onboard.options.flow"))
    .option("--mode <mode>", t("cli.commands.onboard.options.mode"))
    .option(
      "--auth-choice <choice>",
      t("cli.commands.onboard.options.authChoice", { choices: AUTH_CHOICE_HELP }),
    )
    .option("--token-provider <id>", t("cli.commands.onboard.options.tokenProvider"))
    .option("--token <token>", t("cli.commands.onboard.options.token"))
    .option("--token-profile-id <id>", t("cli.commands.onboard.options.tokenProfileId"))
    .option("--token-expires-in <duration>", t("cli.commands.onboard.options.tokenExpiresIn"))
    .option("--secret-input-mode <mode>", t("cli.commands.onboard.options.secretInputMode"))
    .option(
      "--cloudflare-ai-gateway-account-id <id>",
      t("cli.commands.onboard.options.cloudflareAiGatewayAccountId"),
    )
    .option(
      "--cloudflare-ai-gateway-gateway-id <id>",
      t("cli.commands.onboard.options.cloudflareAiGatewayGatewayId"),
    );

  for (const providerFlag of ONBOARD_AUTH_FLAGS) {
    command.option(providerFlag.cliOption, providerFlag.description);
  }

  command
    .option("--custom-base-url <url>", t("cli.commands.onboard.options.customBaseUrl"))
    .option("--custom-api-key <key>", t("cli.commands.onboard.options.customApiKey"))
    .option("--custom-model-id <id>", t("cli.commands.onboard.options.customModelId"))
    .option("--custom-provider-id <id>", t("cli.commands.onboard.options.customProviderId"))
    .option("--custom-compatibility <mode>", t("cli.commands.onboard.options.customCompatibility"))
    .option("--gateway-port <port>", t("cli.commands.onboard.options.gatewayPort"))
    .option("--gateway-bind <mode>", t("cli.commands.onboard.options.gatewayBind"))
    .option("--gateway-auth <mode>", t("cli.commands.onboard.options.gatewayAuth"))
    .option("--gateway-token <token>", t("cli.commands.onboard.options.gatewayToken"))
    .option("--gateway-token-ref-env <name>", t("cli.commands.onboard.options.gatewayTokenRefEnv"))
    .option("--gateway-password <password>", t("cli.commands.onboard.options.gatewayPassword"))
    .option("--remote-url <url>", t("cli.commands.onboard.options.remoteUrl"))
    .option("--remote-token <token>", t("cli.commands.onboard.options.remoteToken"))
    .option("--tailscale <mode>", t("cli.commands.onboard.options.tailscale"))
    .option("--tailscale-reset-on-exit", t("cli.commands.onboard.options.tailscaleResetOnExit"))
    .option("--install-daemon", t("cli.commands.onboard.options.installDaemon"))
    .option("--no-install-daemon", t("cli.commands.onboard.options.noInstallDaemon"))
    .option("--skip-daemon", t("cli.commands.onboard.options.skipDaemon"))
    .option("--daemon-runtime <runtime>", t("cli.commands.onboard.options.daemonRuntime"))
    .option("--skip-channels", t("cli.commands.onboard.options.skipChannels"))
    .option("--skip-skills", t("cli.commands.onboard.options.skipSkills"))
    .option("--skip-search", t("cli.commands.onboard.options.skipSearch"))
    .option("--skip-health", t("cli.commands.onboard.options.skipHealth"))
    .option("--skip-ui", t("cli.commands.onboard.options.skipUi"))
    .option("--node-manager <name>", t("cli.commands.onboard.options.nodeManager"))
    .option("--json", t("cli.commands.onboard.options.json"), false);

  command.action(async (opts, commandRuntime) => {
    await runCommandWithRuntime(defaultRuntime, async () => {
      const locale = resolveCliLocale(process.env);
      initCliI18n({ locale });
      const installDaemon = resolveInstallDaemonFlag(commandRuntime, {
        installDaemon: Boolean(opts.installDaemon),
      });
      const gatewayPort =
        typeof opts.gatewayPort === "string" ? Number.parseInt(opts.gatewayPort, 10) : undefined;
      const providerAuthOptionValues = pickOnboardProviderAuthOptionValues(
        opts as Record<string, unknown>,
      );
      await setupWizardCommand(
        {
          locale,
          workspace: opts.workspace as string | undefined,
          nonInteractive: Boolean(opts.nonInteractive),
          acceptRisk: Boolean(opts.acceptRisk),
          flow: opts.flow as "quickstart" | "advanced" | "manual" | undefined,
          mode: opts.mode as "local" | "remote" | undefined,
          authChoice: opts.authChoice as AuthChoice | undefined,
          tokenProvider: opts.tokenProvider as string | undefined,
          token: opts.token as string | undefined,
          tokenProfileId: opts.tokenProfileId as string | undefined,
          tokenExpiresIn: opts.tokenExpiresIn as string | undefined,
          secretInputMode: opts.secretInputMode as SecretInputMode | undefined,
          ...providerAuthOptionValues,
          cloudflareAiGatewayAccountId: opts.cloudflareAiGatewayAccountId as string | undefined,
          cloudflareAiGatewayGatewayId: opts.cloudflareAiGatewayGatewayId as string | undefined,
          customBaseUrl: opts.customBaseUrl as string | undefined,
          customApiKey: opts.customApiKey as string | undefined,
          customModelId: opts.customModelId as string | undefined,
          customProviderId: opts.customProviderId as string | undefined,
          customCompatibility: opts.customCompatibility as "openai" | "anthropic" | undefined,
          gatewayPort:
            typeof gatewayPort === "number" && Number.isFinite(gatewayPort)
              ? gatewayPort
              : undefined,
          gatewayBind: opts.gatewayBind as GatewayBind | undefined,
          gatewayAuth: opts.gatewayAuth as GatewayAuthChoice | undefined,
          gatewayToken: opts.gatewayToken as string | undefined,
          gatewayTokenRefEnv: opts.gatewayTokenRefEnv as string | undefined,
          gatewayPassword: opts.gatewayPassword as string | undefined,
          remoteUrl: opts.remoteUrl as string | undefined,
          remoteToken: opts.remoteToken as string | undefined,
          tailscale: opts.tailscale as TailscaleMode | undefined,
          tailscaleResetOnExit: Boolean(opts.tailscaleResetOnExit),
          reset: Boolean(opts.reset),
          resetScope: opts.resetScope as ResetScope | undefined,
          installDaemon,
          daemonRuntime: opts.daemonRuntime as GatewayDaemonRuntime | undefined,
          skipChannels: Boolean(opts.skipChannels),
          skipSkills: Boolean(opts.skipSkills),
          skipSearch: Boolean(opts.skipSearch),
          skipHealth: Boolean(opts.skipHealth),
          skipUi: Boolean(opts.skipUi),
          nodeManager: opts.nodeManager as NodeManagerChoice | undefined,
          json: Boolean(opts.json),
        },
        defaultRuntime,
      );
    });
  });
}
