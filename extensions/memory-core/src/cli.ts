import type { Command } from "commander";
import {
  formatDocsLink,
  formatHelpExamples,
  theme,
} from "kaijibot/plugin-sdk/memory-core-host-runtime-cli";
import type {
  MemoryCommandOptions,
  MemoryPromoteCommandOptions,
  MemoryPromoteExplainOptions,
  MemorySearchCommandOptions,
} from "./cli.types.js";
import {
  DEFAULT_PROMOTION_MIN_RECALL_COUNT,
  DEFAULT_PROMOTION_MIN_SCORE,
  DEFAULT_PROMOTION_MIN_UNIQUE_QUERIES,
} from "./short-term-promotion.js";

type MemoryCliRuntime = typeof import("./cli.runtime.js");

let memoryCliRuntimePromise: Promise<MemoryCliRuntime> | null = null;

async function loadMemoryCliRuntime(): Promise<MemoryCliRuntime> {
  memoryCliRuntimePromise ??= import("./cli.runtime.js");
  return await memoryCliRuntimePromise;
}

export async function runMemoryStatus(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryStatus(opts);
}

async function runMemoryIndex(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryIndex(opts);
}

async function runMemorySearch(queryArg: string | undefined, opts: MemorySearchCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemorySearch(queryArg, opts);
}

async function runMemoryPromote(opts: MemoryPromoteCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryPromote(opts);
}

async function runMemoryPromoteExplain(
  selectorArg: string | undefined,
  opts: MemoryPromoteExplainOptions,
) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryPromoteExplain(selectorArg, opts);
}

export function registerMemoryCli(program: Command) {
  const memory = program
    .command("memory")
    .description("Search, inspect, and reindex memory files")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["kaijibot memory status", "Show index and provider status."],
          [
            "kaijibot memory status --fix",
            "Repair stale recall locks and normalize promotion metadata.",
          ],
          ["kaijibot memory status --deep", "Probe embedding provider readiness."],
          ["kaijibot memory index --force", "Force a full reindex."],
          ['kaijibot memory search "meeting notes"', "Quick search using positional query."],
          [
            'kaijibot memory search --query "deployment" --max-results 20',
            "Limit results for focused troubleshooting.",
          ],
          [
            `kaijibot memory promote --limit 10 --min-score ${DEFAULT_PROMOTION_MIN_SCORE}`,
            "Review weighted short-term candidates for long-term memory.",
          ],
          [
            "kaijibot memory promote --apply",
            "Append top-ranked short-term candidates into MEMORY.md.",
          ],
          [
            'kaijibot memory promote-explain "router vlan"',
            "Explain why a specific candidate would or would not promote.",
          ],
          ["kaijibot memory status --json", "Output machine-readable JSON (good for scripts)."],
        ])}\n\n${theme.muted("Docs:")} ${formatDocsLink("/cli/memory", "gitee.com/kaiji1126/kaijibot/blob/main/docs/cli/memory.md")}\n`,
    );

  memory
    .command("status")
    .description("Show memory search index status")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .option("--deep", "Probe embedding provider availability")
    .option("--index", "Reindex if dirty (implies --deep)")
    .option("--fix", "Repair stale recall locks and normalize promotion metadata")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions & { force?: boolean }) => {
      await runMemoryStatus(opts);
    });

  memory
    .command("index")
    .description("Reindex memory files")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--force", "Force full reindex", false)
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryIndex(opts);
    });

  memory
    .command("search")
    .description("Search memory files")
    .argument("[query]", "Search query")
    .option("--query <text>", "Search query (alternative to positional argument)")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--max-results <n>", "Max results", (value: string) => Number(value))
    .option("--min-score <n>", "Minimum score", (value: string) => Number(value))
    .option("--json", "Print JSON")
    .action(async (queryArg: string | undefined, opts: MemorySearchCommandOptions) => {
      await runMemorySearch(queryArg, opts);
    });

  memory
    .command("promote")
    .description("Rank short-term recalls and optionally append top entries to MEMORY.md")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--limit <n>", "Max candidates", (value: string) => Number(value))
    .option(
      "--min-score <n>",
      `Minimum weighted score (default: ${DEFAULT_PROMOTION_MIN_SCORE})`,
      (value: string) => Number(value),
    )
    .option(
      "--min-recall-count <n>",
      `Minimum recall count (default: ${DEFAULT_PROMOTION_MIN_RECALL_COUNT})`,
      (value: string) => Number(value),
    )
    .option(
      "--min-unique-queries <n>",
      `Minimum distinct query count (default: ${DEFAULT_PROMOTION_MIN_UNIQUE_QUERIES})`,
      (value: string) => Number(value),
    )
    .option("--apply", "Append selected candidates to MEMORY.md", false)
    .option("--include-promoted", "Include already promoted candidates", false)
    .option("--json", "Print JSON")
    .action(async (opts: MemoryPromoteCommandOptions) => {
      await runMemoryPromote(opts);
    });

  memory
    .command("promote-explain")
    .description("Explain a specific promotion candidate and its score breakdown")
    .argument("<selector>", "Candidate key, path fragment, or snippet fragment")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--include-promoted", "Include already promoted candidates", false)
    .option("--json", "Print JSON")
    .action(async (selectorArg: string | undefined, opts: MemoryPromoteExplainOptions) => {
      await runMemoryPromoteExplain(selectorArg, opts);
    });
}
