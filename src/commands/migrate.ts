import os from "node:os";
import path from "node:path";
import {
  buildInteractiveSelection,
  detectMigrationSource,
  detectScenario,
  runFreshMigration,
  runImportMigration,
} from "../infra/openclaw-migrator/index.js";
import type { DataType, MigrationReport, MigrationScenario } from "../infra/openclaw-migrator/types.js";
import type { OutputRuntimeEnv } from "../runtime.js";
import { theme } from "../terminal/theme.js";

export type MigrationCommandOptions = {
  dryRun: boolean;
  source?: string;
  overwrite: boolean;
  migrateSecrets: boolean;
  json: boolean;
  scenario?: "fresh" | "import" | "auto";
};

export async function migrateCommand(
  runtime: OutputRuntimeEnv,
  opts: MigrationCommandOptions,
): Promise<void> {
  if (!opts.json) {
    runtime.log(theme.heading("KaijiBot Migration Tool"));
    runtime.log("");
  }

  const detected = detectMigrationSource();
  if (!detected && !opts.source) {
    runtime.error(
      "No OpenClaw installation found. Searched ~/.openclaw/, ~/.clawdbot/, ~/.moltbot/.\n" +
        "Use --source <path> to specify the source directory explicitly.",
    );
    runtime.exit(1);
    return;
  }

  if (detected && !opts.json) {
    runtime.log(`Found ${detected.brand} installation at: ${detected.dir}`);
    runtime.log("");
  }

  const source = detected ?? {
    dir: path.resolve(opts.source!),
    brand: "openclaw" as const,
    configPath: path.resolve(opts.source!, "openclaw.json"),
    configFilename: "openclaw.json",
  };

  const targetDir = path.resolve(os.homedir(), ".kaijibot");

  const scenario: MigrationScenario =
    opts.scenario === "auto" || !opts.scenario
      ? detectScenario(targetDir)
      : opts.scenario;

  if (!opts.json) {
    runtime.log(`Scenario: ${theme.accent(scenario)}`);
    runtime.log("");
  }

  const migrationLog = opts.json ? () => {} : (msg: string) => runtime.log(`  ${theme.muted(msg)}`);

  const migrationOpts = {
    dryRun: opts.dryRun,
    source: opts.source,
    overwrite: opts.overwrite,
    migrateSecrets: opts.migrateSecrets,
    log: migrationLog,
  };

  runtime.log("Previewing migration (dry-run)...");
  runtime.log("");

  const preview =
    scenario === "fresh"
      ? await runFreshMigration(source, targetDir, { ...migrationOpts, dryRun: true })
      : await runImportMigration(source, targetDir, { ...migrationOpts, dryRun: true }, [], []);

  if (opts.json) {
    runtime.writeJson(preview);
    return;
  }

  printPreview(runtime, preview);

  if (preview.totalChanges === 0) {
    runtime.log("");
    runtime.log(theme.muted("No changes to migrate."));
    return;
  }

  if (opts.dryRun) {
    runtime.log("");
    runtime.log(theme.muted("(dry-run mode — no changes were written)"));
    return;
  }

  runtime.log("");
  runtime.log(
    `  ${theme.warn("⚠")} This will apply ${preview.totalChanges} change(s) to your KaijiBot installation.`,
  );

  if (preview.totalWarnings > 0) {
    runtime.log(
      `  ${theme.warn("⚠")} ${preview.totalWarnings} warning(s) detected during preview.`,
    );
  }

  if (opts.migrateSecrets) {
    runtime.log(
      `  ${theme.warn("⚠")} --migrate-secrets is enabled. Credentials and API keys will be copied.`,
    );
  }

  runtime.log("");

  const answer = await promptConfirmation(runtime, "Proceed with migration? [y/N] ");
  if (answer !== "y" && answer !== "yes") {
    runtime.log("Migration cancelled.");
    return;
  }

  runtime.log("");
  runtime.log("Running migration...");
  runtime.log("");

  let report: MigrationReport;

  if (scenario === "fresh") {
    report = await runFreshMigration(source, targetDir, { ...migrationOpts, dryRun: false });
  } else {
    const selection = await buildInteractiveSelection(source);
    report = await runImportMigration(
      source,
      targetDir,
      { ...migrationOpts, dryRun: false },
      selection.agents.map((a) => ({
        agentId: a.id,
        dataTypes: ["workspace", "memory", "sessions", "skills", "config"] as DataType[],
      })),
      selection.skills,
    );
  }

  runtime.log("");
  runtime.log(theme.success("Migration complete."));
  runtime.log(`  Changes:  ${report.totalChanges}`);
  runtime.log(`  Warnings: ${report.totalWarnings}`);
  runtime.log(`  Skipped:  ${report.totalSkipped}`);

  if (report.totalWarnings > 0) {
    runtime.log("");
    runtime.log(theme.heading("Warnings:"));
    for (const result of report.results) {
      for (const warning of result.warnings) {
        runtime.log(`  ${theme.warn("⚠")} ${warning}`);
      }
    }
  }

  runtime.log("");
  runtime.log(theme.heading("Post-migration steps:"));
  runtime.log(`  1. Run ${theme.accent("kaijibot doctor")} to verify your installation.`);
  runtime.log(`  2. Run ${theme.accent("kaijibot memory index --force")} to rebuild search indexes.`);
  runtime.log(`  3. In conversation, ask KaijiBot to ${theme.accent("organize memory")} to restructure imported memory.`);
}

function printPreview(runtime: OutputRuntimeEnv, report: MigrationReport): void {
  if (report.results.length === 0) {
    runtime.log(theme.muted("  No changes to preview."));
    return;
  }

  for (const result of report.results) {
    if (result.changes.length === 0 && result.skipped.length === 0) { continue; }

    runtime.log(`  ${theme.heading(result.changes.length > 0 ? "Changes" : "No changes")}:`);

    for (const change of result.changes) {
      const kindLabel = formatKind(change.kind);
      runtime.log(
        `    ${kindLabel} ${change.source} → ${change.target}`,
      );
      runtime.log(`      ${theme.muted(change.detail)}`);
    }

    if (result.skipped.length > 0) {
      runtime.log(`  ${theme.muted("Skipped:")}`);
      for (const skip of result.skipped) {
        runtime.log(`    ${theme.muted("-")} ${skip}`);
      }
    }

    runtime.log("");
  }
}

function formatKind(kind: string): string {
  switch (kind) {
    case "copy":
      return theme.info("COPY");
    case "move":
      return theme.info("MOVE");
    case "create":
      return theme.success("CREATE");
    case "merge":
      return theme.accent("MERGE");
    case "skip":
      return theme.muted("SKIP");
    default:
      return kind.toUpperCase();
  }
}

async function promptConfirmation(runtime: OutputRuntimeEnv, prompt: string): Promise<string> {
  runtime.writeStdout(prompt);

  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      resolve("n");
      return;
    }

    const onData = (chunk: Buffer) => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      resolve(chunk.toString("utf-8").trim().toLowerCase());
    };

    const onEnd = () => {
      stdin.removeListener("data", onData);
      resolve("n");
    };

    stdin.once("data", onData);
    stdin.once("end", onEnd);
  });
}
