import type { Command } from "commander";
import type { GenerateTextFn } from "./compiler.js";
import type { WikiConfig } from "./config.js";
import { ingestAll } from "./ingest.js";
import { lintWiki } from "./lint.js";
import { queryWiki } from "./query.js";
import { resolveWikiStatus, renderWikiStatus } from "./status.js";
import { initializeWikiVault } from "./vault.js";

export type CliDeps = {
  config: WikiConfig;
  resolveVault: (workspaceDir: string | undefined) => string;
  defaultWorkspaceDir: string;
  getGenerateText: () => Promise<GenerateTextFn>;
};

export function registerWikiCli(program: Command, deps: CliDeps): void {
  const wiki = program.command("wiki").description("LLM-compiled knowledge wiki");

  const resolveFromOpts = (opts: { workspaceDir?: string }) => {
    const workspaceDir = opts.workspaceDir ?? deps.defaultWorkspaceDir;
    return {
      workspaceDir,
      vaultRoot: deps.resolveVault(workspaceDir || undefined),
    };
  };

  wiki
    .command("status")
    .description("Show wiki vault status")
    .option("--json", "Print JSON")
    .option("--workspace-dir <dir>", "Agent workspace directory")
    .action(async (opts: { json?: boolean; workspaceDir?: string }) => {
      const { vaultRoot } = resolveFromOpts(opts);
      const status = await resolveWikiStatus(vaultRoot);
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(renderWikiStatus(status));
      }
    });

  wiki
    .command("init")
    .description("Initialize the wiki vault")
    .option("--workspace-dir <dir>", "Agent workspace directory")
    .action(async (opts: { workspaceDir?: string }) => {
      const { vaultRoot } = resolveFromOpts(opts);
      const result = await initializeWikiVault(vaultRoot);
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
    .option("--workspace-dir <dir>", "Agent workspace directory")
    .action(async (opts: { json?: boolean; workspaceDir?: string }) => {
      const { workspaceDir, vaultRoot } = resolveFromOpts(opts);
      await initializeWikiVault(vaultRoot);
      const generateText = await deps.getGenerateText();
      const result = await ingestAll(workspaceDir, vaultRoot, generateText, deps.config);
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
    .option("--workspace-dir <dir>", "Agent workspace directory")
    .action(async (search: string, opts: { json?: boolean; workspaceDir?: string }) => {
      const { vaultRoot } = resolveFromOpts(opts);
      const result = await queryWiki(vaultRoot, search);
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
    });

  wiki
    .command("lint")
    .description("Health-check the wiki")
    .option("--json", "Print JSON")
    .option("--workspace-dir <dir>", "Agent workspace directory")
    .action(async (opts: { json?: boolean; workspaceDir?: string }) => {
      const { vaultRoot } = resolveFromOpts(opts);
      const report = await lintWiki(vaultRoot);
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(
          `Issues: ${report.issues.length} (${report.totalPages} pages, ${report.totalClaims} claims)`,
        );
        for (const issue of report.issues.slice(0, 20)) {
          console.log(`  [${issue.severity}] ${issue.category}: ${issue.description}`);
        }
      }
    });
}
