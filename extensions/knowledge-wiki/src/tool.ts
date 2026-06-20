import { Type } from "typebox";
import type { AnyAgentTool } from "../api.js";
import type { WikiConfig } from "./config.js";
import type { GenerateTextFn } from "./compiler.js";
import { ingestAll, ingestFile } from "./ingest.js";
import { queryWiki } from "./query.js";
import { lintWiki } from "./lint.js";
import { resolveWikiStatus, renderWikiStatus } from "./status.js";
import { initializeWikiVault } from "./vault.js";
import { scanWorkspace } from "./scanner.js";

const WikiStatusSchema = Type.Object({}, { additionalProperties: false });
const WikiQuerySchema = Type.Object(
  { query: Type.String({ minLength: 1 }), maxResults: Type.Optional(Type.Number({ minimum: 1 })) },
  { additionalProperties: false },
);
const WikiIngestSchema = Type.Object(
  { sourcePath: Type.Optional(Type.String({ minLength: 1 })) },
  { additionalProperties: false },
);
const WikiLintSchema = Type.Object({}, { additionalProperties: false });

export type WikiToolContext = {
  config: WikiConfig;
  workspaceDir: string;
  vaultRoot: string;
  getGenerateText: () => Promise<GenerateTextFn>;
};

export function createWikiStatusTool(ctx: WikiToolContext): AnyAgentTool {
  return {
    name: "wiki_status",
    label: "Wiki Status",
    description: "Show the current state of the compiled knowledge wiki.",
    parameters: WikiStatusSchema,
    execute: async () => {
      const status = await resolveWikiStatus(ctx.vaultRoot);
      return {
        content: [{ type: "text", text: renderWikiStatus(status) }],
        details: status,
      };
    },
  };
}

export function createWikiQueryTool(ctx: WikiToolContext): AnyAgentTool {
  return {
    name: "wiki_query",
    label: "Wiki Query",
    description:
      "Search the compiled knowledge wiki for accumulated knowledge, claims, entities, and concepts.",
    parameters: WikiQuerySchema,
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as { query: string; maxResults?: number };
      const result = await queryWiki(
        ctx.vaultRoot,
        params.query,
        params.maxResults ?? 10,
      );
      const text =
        result.matchedPages.length === 0
          ? "No wiki results found."
          : result.matchedPages
              .map(
                (m, i) =>
                  `${i + 1}. ${m.title} (${m.pageType}, score: ${m.score})\nPath: ${m.path}\nSnippet: ${m.snippet}`,
              )
              .join("\n\n");
      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  };
}

export function createWikiIngestTool(ctx: WikiToolContext): AnyAgentTool {
  return {
    name: "wiki_ingest",
    label: "Wiki Ingest",
    description:
      "Ingest a source file (or all changed files) into the knowledge wiki. The LLM reads the file, extracts claims/entities/concepts, and compiles structured wiki pages.",
    parameters: WikiIngestSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as { sourcePath?: string };
      await initializeWikiVault(ctx.vaultRoot);

      const generateText = await ctx.getGenerateText();

      if (params.sourcePath) {
        const scanResult = await scanWorkspace(ctx.workspaceDir, ctx.config);
        const source = scanResult.files.find(
          (f) => f.relativePath === params.sourcePath,
        );
        if (!source) {
          return {
            content: [
              {
                type: "text",
                text: `File not found in workspace: ${params.sourcePath}`,
              },
            ],
            details: { error: "file not found" },
          };
        }
        const result = await ingestFile(
          ctx.vaultRoot,
          source,
          generateText,
          ctx.config,
        );
        return {
          content: [
            {
              type: "text",
              text: result.skipped
                ? `Skipped (unchanged): ${result.sourcePath}`
                : `Ingested: ${result.sourcePath} (${result.claimsAdded} claims, ${result.entityPages.length} entities, ${result.conceptPages.length} concepts)`,
            },
          ],
          details: result,
        };
      }

      const result = await ingestAll(
        ctx.workspaceDir,
        ctx.vaultRoot,
        generateText,
        ctx.config,
      );
      return {
        content: [
          {
            type: "text",
            text: `Ingested ${result.ingested.length} files (${result.skipped} skipped). ${result.errors.length} errors.`,
          },
        ],
        details: result,
      };
    },
  };
}

export function createWikiLintTool(ctx: WikiToolContext): AnyAgentTool {
  return {
    name: "wiki_lint",
    label: "Wiki Lint",
    description:
      "Health-check the wiki for contradictions, stale claims, orphan pages, and missing evidence.",
    parameters: WikiLintSchema,
    execute: async () => {
      const report = await lintWiki(ctx.vaultRoot);
      const summary =
        report.issues.length === 0
          ? "Wiki is healthy. No issues found."
          : [
              `Issues: ${report.issues.length}`,
              ...report.issues
                .slice(0, 10)
                .map(
                  (i) =>
                    `[${i.severity}] ${i.category}: ${i.description} (${i.pagePath})`,
                ),
            ].join("\n");
      return {
        content: [{ type: "text", text: summary }],
        details: report,
      };
    },
  };
}
