import type { Command } from "commander";
import {
  modelsAliasesAddCommand,
  modelsAliasesListCommand,
  modelsAliasesRemoveCommand,
  modelsAuthAddCommand,
  modelsAuthLoginCommand,
  modelsAuthOrderClearCommand,
  modelsAuthOrderGetCommand,
  modelsAuthOrderSetCommand,
  modelsAuthPasteTokenCommand,
  modelsAuthSetupTokenCommand,
  modelsFallbacksAddCommand,
  modelsFallbacksClearCommand,
  modelsFallbacksListCommand,
  modelsFallbacksRemoveCommand,
  modelsImageFallbacksAddCommand,
  modelsImageFallbacksClearCommand,
  modelsImageFallbacksListCommand,
  modelsImageFallbacksRemoveCommand,
  modelsListCommand,
  modelsScanCommand,
  modelsSetCommand,
  modelsSetImageCommand,
  modelsStatusCommand,
} from "../commands/models.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { resolveOptionFromCommand, runCommandWithRuntime } from "./cli-utils.js";
import { t } from "./i18n/translate.js";

function runModelsCommand(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action);
}

export function registerModelsCli(program: Command) {
  const models = program
    .command("models")
    .description(t("cli.models.desc.models"))
    .option("--status-json", t("cli.models.opt.statusJson"), false)
    .option("--status-plain", t("cli.models.opt.statusPlain"), false)
    .option("--agent <id>", t("cli.models.opt.agent"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.models.docs"))} ${formatDocsLink("/cli/models", "gitee.com/kaiji1126/kaijibot/blob/main/docs/cli/models.md")}\n`,
    );

  models
    .command("list")
    .description(t("cli.models.desc.list"))
    .option("--all", t("cli.models.opt.all"), false)
    .option("--local", t("cli.models.opt.local"), false)
    .option("--provider <name>", t("cli.models.opt.provider"))
    .option("--json", t("cli.models.opt.json"), false)
    .option("--plain", t("cli.models.opt.plainLine"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsListCommand(opts, defaultRuntime);
      });
    });

  models
    .command("status")
    .description(t("cli.models.desc.status"))
    .option("--json", t("cli.models.opt.json"), false)
    .option("--plain", t("cli.models.opt.plain"), false)
    .option("--check", t("cli.models.opt.check"), false)
    .option("--probe", t("cli.models.opt.probe"), false)
    .option("--probe-provider <name>", t("cli.models.opt.probeProvider"))
    .option("--probe-profile <id>", t("cli.models.opt.probeProfile"), (value, previous) => {
      const next = Array.isArray(previous) ? previous : previous ? [previous] : [];
      next.push(value);
      return next;
    })
    .option("--probe-timeout <ms>", t("cli.models.opt.probeTimeout"))
    .option("--probe-concurrency <n>", t("cli.models.opt.probeConcurrency"))
    .option("--probe-max-tokens <n>", t("cli.models.opt.probeMaxTokens"))
    .option("--agent <id>", t("cli.models.opt.agent"))
    .action(async (opts, command) => {
      const agent =
        resolveOptionFromCommand<string>(command, "agent") ?? (opts.agent as string | undefined);
      await runModelsCommand(async () => {
        await modelsStatusCommand(
          {
            json: Boolean(opts.json),
            plain: Boolean(opts.plain),
            check: Boolean(opts.check),
            probe: Boolean(opts.probe),
            probeProvider: opts.probeProvider as string | undefined,
            probeProfile: opts.probeProfile as string | string[] | undefined,
            probeTimeout: opts.probeTimeout as string | undefined,
            probeConcurrency: opts.probeConcurrency as string | undefined,
            probeMaxTokens: opts.probeMaxTokens as string | undefined,
            agent,
          },
          defaultRuntime,
        );
      });
    });

  models
    .command("set")
    .description(t("cli.models.desc.set"))
    .argument("<model>", t("cli.models.opt.model"))
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsSetCommand(model, defaultRuntime);
      });
    });

  models
    .command("set-image")
    .description(t("cli.models.desc.setImage"))
    .argument("<model>", t("cli.models.opt.model"))
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsSetImageCommand(model, defaultRuntime);
      });
    });

  const aliases = models.command("aliases").description(t("cli.models.desc.aliases"));

  aliases
    .command("list")
    .description(t("cli.models.desc.aliasesList"))
    .option("--json", t("cli.models.opt.json"), false)
    .option("--plain", t("cli.models.opt.plain"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAliasesListCommand(opts, defaultRuntime);
      });
    });

  aliases
    .command("add")
    .description(t("cli.models.desc.aliasesAdd"))
    .argument("<alias>", t("cli.models.opt.aliasName"))
    .argument("<model>", t("cli.models.opt.model"))
    .action(async (alias: string, model: string) => {
      await runModelsCommand(async () => {
        await modelsAliasesAddCommand(alias, model, defaultRuntime);
      });
    });

  aliases
    .command("remove")
    .description(t("cli.models.desc.aliasesRemove"))
    .argument("<alias>", t("cli.models.opt.aliasName"))
    .action(async (alias: string) => {
      await runModelsCommand(async () => {
        await modelsAliasesRemoveCommand(alias, defaultRuntime);
      });
    });

  const fallbacks = models.command("fallbacks").description(t("cli.models.desc.fallbacks"));

  fallbacks
    .command("list")
    .description(t("cli.models.desc.fallbacksList"))
    .option("--json", t("cli.models.opt.json"), false)
    .option("--plain", t("cli.models.opt.plain"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsFallbacksListCommand(opts, defaultRuntime);
      });
    });

  fallbacks
    .command("add")
    .description(t("cli.models.desc.fallbacksAdd"))
    .argument("<model>", t("cli.models.opt.model"))
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsFallbacksAddCommand(model, defaultRuntime);
      });
    });

  fallbacks
    .command("remove")
    .description(t("cli.models.desc.fallbacksRemove"))
    .argument("<model>", t("cli.models.opt.model"))
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsFallbacksRemoveCommand(model, defaultRuntime);
      });
    });

  fallbacks
    .command("clear")
    .description(t("cli.models.desc.fallbacksClear"))
    .action(async () => {
      await runModelsCommand(async () => {
        await modelsFallbacksClearCommand(defaultRuntime);
      });
    });

  const imageFallbacks = models
    .command("image-fallbacks")
    .description(t("cli.models.desc.imageFallbacks"));

  imageFallbacks
    .command("list")
    .description(t("cli.models.desc.imageFallbacksList"))
    .option("--json", t("cli.models.opt.json"), false)
    .option("--plain", t("cli.models.opt.plain"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsImageFallbacksListCommand(opts, defaultRuntime);
      });
    });

  imageFallbacks
    .command("add")
    .description(t("cli.models.desc.imageFallbacksAdd"))
    .argument("<model>", t("cli.models.opt.model"))
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsImageFallbacksAddCommand(model, defaultRuntime);
      });
    });

  imageFallbacks
    .command("remove")
    .description(t("cli.models.desc.imageFallbacksRemove"))
    .argument("<model>", t("cli.models.opt.model"))
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsImageFallbacksRemoveCommand(model, defaultRuntime);
      });
    });

  imageFallbacks
    .command("clear")
    .description(t("cli.models.desc.imageFallbacksClear"))
    .action(async () => {
      await runModelsCommand(async () => {
        await modelsImageFallbacksClearCommand(defaultRuntime);
      });
    });

  models
    .command("scan")
    .description(t("cli.models.desc.scan"))
    .option("--min-params <b>", t("cli.models.opt.minParams"))
    .option("--max-age-days <days>", t("cli.models.opt.maxAgeDays"))
    .option("--provider <name>", t("cli.models.opt.provider"))
    .option("--max-candidates <n>", t("cli.models.opt.maxCandidates"), "6")
    .option("--timeout <ms>", t("cli.models.opt.timeout"))
    .option("--concurrency <n>", t("cli.models.opt.concurrency"))
    .option("--no-probe", t("cli.models.opt.noProbe"))
    .option("--yes", t("cli.models.opt.yes"), false)
    .option("--no-input", t("cli.models.opt.noInput"))
    .option("--set-default", t("cli.models.opt.setDefault"), false)
    .option("--set-image", t("cli.models.opt.setImage"), false)
    .option("--json", t("cli.models.opt.json"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsScanCommand(opts, defaultRuntime);
      });
    });

  models.action(async (opts) => {
    await runModelsCommand(async () => {
      await modelsStatusCommand(
        {
          json: Boolean(opts?.statusJson),
          plain: Boolean(opts?.statusPlain),
          agent: opts?.agent as string | undefined,
        },
        defaultRuntime,
      );
    });
  });

  const auth = models.command("auth").description(t("cli.models.desc.auth"));
  auth.option("--agent <id>", t("cli.models.opt.agent"));
  auth.action(() => {
    auth.help();
  });

  auth
    .command("add")
    .description(t("cli.models.desc.authAdd"))
    .action(async () => {
      await runModelsCommand(async () => {
        await modelsAuthAddCommand({}, defaultRuntime);
      });
    });

  auth
    .command("login")
    .description(t("cli.models.desc.authLogin"))
    .option("--provider <id>", t("cli.models.opt.providerId"))
    .option("--method <id>", t("cli.models.opt.method"))
    .option("--set-default", t("cli.models.opt.applyDefault"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAuthLoginCommand(
          {
            provider: opts.provider as string | undefined,
            method: opts.method as string | undefined,
            setDefault: Boolean(opts.setDefault),
          },
          defaultRuntime,
        );
      });
    });

  auth
    .command("setup-token")
    .description(t("cli.models.desc.authSetupToken"))
    .option("--provider <name>", t("cli.models.opt.providerName"))
    .option("--yes", t("cli.models.opt.skipConfirm"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAuthSetupTokenCommand(
          {
            provider: opts.provider as string | undefined,
            yes: Boolean(opts.yes),
          },
          defaultRuntime,
        );
      });
    });

  auth
    .command("paste-token")
    .description(t("cli.models.desc.authPasteToken"))
    .requiredOption("--provider <name>", t("cli.models.opt.providerName"))
    .option("--profile-id <id>", t("cli.models.opt.profileId"))
    .option("--expires-in <duration>", t("cli.models.opt.expiresIn"))
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAuthPasteTokenCommand(
          {
            provider: opts.provider as string | undefined,
            profileId: opts.profileId as string | undefined,
            expiresIn: opts.expiresIn as string | undefined,
          },
          defaultRuntime,
        );
      });
    });

  auth
    .command("login-github-copilot")
    .description(t("cli.models.desc.authLoginGithubCopilot"))
    .option("--yes", t("cli.models.opt.overwrite"), false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAuthLoginCommand(
          {
            provider: "github-copilot",
            method: "device",
            yes: Boolean(opts.yes),
          },
          defaultRuntime,
        );
      });
    });

  const order = auth.command("order").description(t("cli.models.desc.order"));

  order
    .command("get")
    .description(t("cli.models.desc.orderGet"))
    .requiredOption("--provider <name>", t("cli.models.opt.providerName"))
    .option("--agent <id>", t("cli.models.opt.agent"))
    .option("--json", t("cli.models.opt.json"), false)
    .action(async (opts, command) => {
      const agent =
        resolveOptionFromCommand<string>(command, "agent") ?? (opts.agent as string | undefined);
      await runModelsCommand(async () => {
        await modelsAuthOrderGetCommand(
          {
            provider: opts.provider as string,
            agent,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  order
    .command("set")
    .description(t("cli.models.desc.orderSet"))
    .requiredOption("--provider <name>", t("cli.models.opt.providerName"))
    .option("--agent <id>", t("cli.models.opt.agent"))
    .argument("<profileIds...>", "Auth profile ids (e.g. anthropic:default)")
    .action(async (profileIds: string[], opts, command) => {
      const agent =
        resolveOptionFromCommand<string>(command, "agent") ?? (opts.agent as string | undefined);
      await runModelsCommand(async () => {
        await modelsAuthOrderSetCommand(
          {
            provider: opts.provider as string,
            agent,
            order: profileIds,
          },
          defaultRuntime,
        );
      });
    });

  order
    .command("clear")
    .description(t("cli.models.desc.orderClear"))
    .requiredOption("--provider <name>", t("cli.models.opt.providerName"))
    .option("--agent <id>", t("cli.models.opt.agent"))
    .action(async (opts, command) => {
      const agent =
        resolveOptionFromCommand<string>(command, "agent") ?? (opts.agent as string | undefined);
      await runModelsCommand(async () => {
        await modelsAuthOrderClearCommand(
          {
            provider: opts.provider as string,
            agent,
          },
          defaultRuntime,
        );
      });
    });
}
