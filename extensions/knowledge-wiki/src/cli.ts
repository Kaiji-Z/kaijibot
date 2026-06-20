import type { Command } from "commander";
import type { WikiConfig } from "./config.js";
import type { GenerateTextFn } from "./compiler.js";
import { ingestAll } from "./ingest.js";
import { queryWiki } from "./query.js";
import { lintWiki } from "./lint.js";
import { resolveWikiStatus, renderWikiStatus } from "./status.js";
import { initializeWikiVault } from "./vault.js";

export type CliDeps = {
  config: WikiConfig;
  workspaceDir: string;
  vaultRoot: string;
  getGenerateText: () => Promise<GenerateTextFn>;
};

export function registerWikiCli(
  program: Command,
  deps: CliDeps,
): void {
  const wiki = program
    .command("wiki")
    .description("LLM-compiled knowledge wiki");

  wiki
    .command("status")
    .description("Show wiki vault status")
    .option("--json", "Print JSON")
    .action(async (opts: { json?: boolean }) => {
      const status = await resolveWikiStatus(deps.vaultRoot);
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(renderWikiStatus(status));
      }
    });

  wiki
    .command("init")
    .description("Initialize the wiki vault")
    .action(async () => {
      const result = await initializeWikiVault(deps.vaultRoot);
      console.log(
        result.created
          ? `Initialized wiki at ${result.vaultPath} (${result.createdDirs.length} dirs, ${result.createdFiles.length} files)`
          : `Wiki already exists at ${result.vaultPath}`,
      );
    });

  wiki
    .command("ingest")
    .description("Ingest all changed workspace files into the wiki")
    .option("--json", "Print JSON")
    .action(async (opts: { json?: boolean }) => {
      await initializeWikiVault(deps.vaultRoot);
      const generateText = await deps.getGenerateText();
      const result = await ingestAll(
        deps.workspaceDir,
        deps.vaultRoot,
        generateText,
        deps.config,
      );
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(
          `Ingested ${result.ingested.length} files (${result.skipped} skipped, ${result.errors.length} errors)`,
        );
        for (const err of result.errors) {
          console.error(`  ERROR: ${err}`);
        }
      }
    });

  wiki
    .command("query <search>")
    .description("Search the compiled wiki")
    .option("--json", "Print JSON")
    .action(
      async (search: string, opts: { json?: boolean }) => {
        const result = await queryWiki(deps.vaultRoot, search);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.matchedPages.length === 0) {
            console.log("No results.");
            return;
          }
          for (const m of result.matchedPages) {
            console.log(`  ${m.title} (${m.pageType}, score: ${m.score})`);
            console.log(`    ${m.snippet}`);
            console.log("");
          }
        }
      },
    );

  wiki
    .command("lint")
    .description("Health-check the wiki")
    .option("--json", "Print JSON")
    .action(async (opts: { json?: boolean }) => {
      const report = await lintWiki(deps.vaultRoot);
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`Issues: ${report.issues.length} (${report.totalPages} pages, ${report.totalClaims} claims)`);
        for (const issue of report.issues.slice(0, 20)) {
          console.log(`  [${issue.severity}] ${issue.category}: ${issue.description}`);
        }
      }
    });
}
