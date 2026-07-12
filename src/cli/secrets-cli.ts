import fs from "node:fs";
import { confirm } from "@clack/prompts";
import type { Command } from "commander";
import { danger } from "../globals.js";
import { defaultRuntime } from "../runtime.js";
import { runSecretsApply } from "../secrets/apply.js";
import { resolveSecretsAuditExitCode, runSecretsAudit } from "../secrets/audit.js";
import { runSecretsConfigureInteractive } from "../secrets/configure.js";
import { isSecretsApplyPlan, type SecretsApplyPlan } from "../secrets/plan.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { addGatewayClientOptions, callGatewayFromCli, type GatewayRpcOpts } from "./gateway-rpc.js";
import { t } from "./i18n/translate.js";

type SecretsReloadOptions = GatewayRpcOpts & { json?: boolean };
type SecretsAuditOptions = {
  check?: boolean;
  json?: boolean;
  allowExec?: boolean;
};
type SecretsConfigureOptions = {
  apply?: boolean;
  yes?: boolean;
  planOut?: string;
  providersOnly?: boolean;
  skipProviderSetup?: boolean;
  agent?: string;
  allowExec?: boolean;
  json?: boolean;
};
type SecretsApplyOptions = {
  from: string;
  dryRun?: boolean;
  allowExec?: boolean;
  json?: boolean;
};

function readPlanFile(pathname: string): SecretsApplyPlan {
  const raw = fs.readFileSync(pathname, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isSecretsApplyPlan(parsed)) {
    throw new Error(`Invalid secrets plan file: ${pathname}`);
  }
  return parsed;
}

export function registerSecretsCli(program: Command) {
  const secrets = program
    .command("secrets")
    .description("Secrets runtime controls")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/gateway/security", "gitee.com/kaiji1126/kaijibot/blob/main/docs/gateway/security.md")}\n`,
    );

  addGatewayClientOptions(
    secrets
      .command("reload")
      .description("Re-resolve secret references and atomically swap runtime snapshot")
      .option("--json", "Output JSON", false),
  ).action(async (opts: SecretsReloadOptions) => {
    try {
      const result = await callGatewayFromCli("secrets.reload", opts, undefined, {
        expectFinal: false,
      });
      if (opts.json) {
        defaultRuntime.writeJson(result);
        return;
      }
      const warningCount = Number(
        (result as { warningCount?: unknown } | undefined)?.warningCount ?? 0,
      );
      if (Number.isFinite(warningCount) && warningCount > 0) {
        defaultRuntime.log(t("cli.secrets.reload.warning", { count: warningCount }));
        return;
      }
      defaultRuntime.log(t("cli.secrets.reload.success"));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  secrets
    .command("audit")
    .description("Audit plaintext secrets, unresolved refs, and precedence drift")
    .option("--check", "Exit non-zero when findings are present", false)
    .option(
      "--allow-exec",
      "Allow exec SecretRef resolution during audit (may execute provider commands)",
      false,
    )
    .option("--json", "Output JSON", false)
    .action(async (opts: SecretsAuditOptions) => {
      try {
        const report = await runSecretsAudit({
          allowExec: Boolean(opts.allowExec),
        });
        if (opts.json) {
          defaultRuntime.writeJson(report);
        } else {
          defaultRuntime.log(
            t("cli.secrets.audit.summary", {
              status: report.status,
              plaintext: report.summary.plaintextCount,
              unresolved: report.summary.unresolvedRefCount,
              shadowed: report.summary.shadowedRefCount,
              legacy: report.summary.legacyResidueCount,
            }),
          );
          if (report.findings.length > 0) {
            for (const finding of report.findings.slice(0, 20)) {
              defaultRuntime.log(
                `- [${finding.code}] ${finding.file}:${finding.jsonPath} ${finding.message}`,
              );
            }
            if (report.findings.length > 20) {
              defaultRuntime.log(
                t("cli.secrets.audit.moreFindings", { count: report.findings.length - 20 }),
              );
            }
          }
          if (report.resolution.skippedExecRefs > 0) {
            defaultRuntime.log(
              t("cli.secrets.audit.skippedExecRefs", { count: report.resolution.skippedExecRefs }),
            );
          }
        }
        const exitCode = resolveSecretsAuditExitCode(report, Boolean(opts.check));
        if (exitCode !== 0) {
          defaultRuntime.exit(exitCode);
        }
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(2);
      }
    });

  secrets
    .command("configure")
    .description("Interactive secrets helper (provider setup + SecretRef mapping + preflight)")
    .option("--apply", "Apply changes immediately after preflight", false)
    .option("--yes", "Skip apply confirmation prompt", false)
    .option("--providers-only", "Configure secrets.providers only, skip credential mapping", false)
    .option(
      "--skip-provider-setup",
      "Skip provider setup and only map credential fields to existing providers",
      false,
    )
    .option(
      "--agent <id>",
      "Agent id for auth-profiles targets (default: configured default agent)",
    )
    .option(
      "--allow-exec",
      "Allow exec SecretRef preflight checks (may execute provider commands)",
      false,
    )
    .option("--plan-out <path>", "Write generated plan JSON to a file")
    .option("--json", "Output JSON", false)
    .action(async (opts: SecretsConfigureOptions) => {
      try {
        const configured = await runSecretsConfigureInteractive({
          providersOnly: Boolean(opts.providersOnly),
          skipProviderSetup: Boolean(opts.skipProviderSetup),
          agentId: typeof opts.agent === "string" ? opts.agent : undefined,
          allowExecInPreflight: Boolean(opts.allowExec),
        });
        if (opts.planOut) {
          fs.writeFileSync(opts.planOut, `${JSON.stringify(configured.plan, null, 2)}\n`, "utf8");
        }
        if (opts.json) {
          defaultRuntime.writeJson({
            plan: configured.plan,
            preflight: configured.preflight,
          });
        } else {
          defaultRuntime.log(
            t("cli.secrets.configure.preflightSummary", {
              changed: String(configured.preflight.changed),
              files: configured.preflight.changedFiles.length,
              warnings: configured.preflight.warningCount,
            }),
          );
          if (configured.preflight.warningCount > 0) {
            for (const warning of configured.preflight.warnings) {
              defaultRuntime.log(t("cli.secrets.configure.warningLine", { warning }));
            }
          }
          if (
            !configured.preflight.checks.resolvabilityComplete &&
            configured.preflight.skippedExecRefs > 0
          ) {
            defaultRuntime.log(
              t("cli.secrets.configure.preflightSkippedExecRefs", {
                count: configured.preflight.skippedExecRefs,
              }),
            );
          }
          const providerUpserts = Object.keys(configured.plan.providerUpserts ?? {}).length;
          const providerDeletes = configured.plan.providerDeletes?.length ?? 0;
          defaultRuntime.log(
            t("cli.secrets.configure.planSummary", {
              targets: configured.plan.targets.length,
              providerUpserts,
              providerDeletes,
            }),
          );
          if (opts.planOut) {
            defaultRuntime.log(t("cli.secrets.configure.planWritten", { path: opts.planOut }));
          }
        }

        let shouldApply = Boolean(opts.apply);
        if (!shouldApply && !opts.json) {
          const approved = await confirm({
            message: t("cli.secrets.configure.applyPrompt"),
            initialValue: true,
          });
          if (typeof approved === "boolean") {
            shouldApply = approved;
          }
        }
        if (shouldApply) {
          const needsIrreversiblePrompt = Boolean(opts.apply);
          if (needsIrreversiblePrompt && !opts.yes && !opts.json) {
            const confirmed = await confirm({
              message: t("cli.secrets.configure.irreversiblePrompt"),
              initialValue: true,
            });
            if (confirmed !== true) {
              defaultRuntime.log(t("cli.secrets.configure.applyCancelled"));
              return;
            }
          }
          const result = await runSecretsApply({
            plan: configured.plan,
            write: true,
            allowExec: Boolean(opts.allowExec),
          });
          if (opts.json) {
            defaultRuntime.writeJson(result);
            return;
          }
          defaultRuntime.log(
            result.changed
              ? t("cli.secrets.apply.success", { count: result.changedFiles.length })
              : t("cli.secrets.apply.noChanges"),
          );
        }
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  secrets
    .command("apply")
    .description("Apply a previously generated secrets plan")
    .requiredOption("--from <path>", "Path to plan JSON")
    .option("--dry-run", "Validate/preflight only", false)
    .option("--allow-exec", "Allow exec SecretRef checks (may execute provider commands)", false)
    .option("--json", "Output JSON", false)
    .action(async (opts: SecretsApplyOptions) => {
      try {
        const plan = readPlanFile(opts.from);
        const result = await runSecretsApply({
          plan,
          write: !opts.dryRun,
          allowExec: Boolean(opts.allowExec),
        });
        if (opts.json) {
          defaultRuntime.writeJson(result);
          return;
        }
        if (opts.dryRun) {
          defaultRuntime.log(
            result.changed
              ? t("cli.secrets.apply.dryRunChanges", { count: result.changedFiles.length })
              : t("cli.secrets.apply.dryRunNoChanges"),
          );
          if (!result.checks.resolvabilityComplete && result.skippedExecRefs > 0) {
            defaultRuntime.log(
              t("cli.secrets.apply.dryRunSkippedExecRefs", { count: result.skippedExecRefs }),
            );
          }
          return;
        }
        defaultRuntime.log(
          result.changed
            ? t("cli.secrets.apply.success", { count: result.changedFiles.length })
            : t("cli.secrets.apply.noChanges"),
        );
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });
}
