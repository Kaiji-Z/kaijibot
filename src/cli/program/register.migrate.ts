import type { Command } from "commander";
import { migrateCommand } from "../../commands/migrate.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { formatHelpExamples } from "../help-format.js";

export function registerMigrateCommand(program: Command) {
  program
    .command("migrate")
    .description("Migrate data from OpenClaw or legacy installations to KaijiBot")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/migrate", "docs.kaijibot.ai/cli/migrate")}\n`,
    )
    .option("--dry-run", "Preview migration without applying changes", false)
    .option("--source <path>", "Explicit source directory (overrides auto-detection)")
    .option("--overwrite", "Overwrite existing files during migration", false)
    .option("--migrate-secrets", "Include credentials and secrets in migration", false)
    .option("--json", "Output JSON report", false)
    .option("--scenario <type>", "Migration scenario: fresh, import, or auto (default)", "auto")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["kaijibot migrate", "Auto-detect OpenClaw and preview migration."],
          ["kaijibot migrate --dry-run", "Preview what would be migrated without writing."],
          ["kaijibot migrate --source ~/.openclaw", "Migrate from an explicit source directory."],
          ["kaijibot migrate --migrate-secrets", "Include credentials and API keys in migration."],
          ["kaijibot migrate --overwrite", "Overwrite existing files."],
          ["kaijibot migrate --scenario fresh", "Run fresh migration (new KaijiBot install)."],
          ["kaijibot migrate --scenario import", "Import into existing KaijiBot installation."],
        ])}`,
    )
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await migrateCommand(defaultRuntime, {
          dryRun: Boolean(opts.dryRun),
          source: opts.source as string | undefined,
          overwrite: Boolean(opts.overwrite),
          migrateSecrets: Boolean(opts.migrateSecrets),
          json: Boolean(opts.json),
          scenario: opts.scenario as "fresh" | "import" | "auto" | undefined,
        });
      });
    });
}
