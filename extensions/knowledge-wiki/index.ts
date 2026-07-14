import path from "node:path";
import { definePluginEntry } from "./api.js";
import { registerWikiCli } from "./src/cli.js";
import type { GenerateTextFn } from "./src/compiler.js";
import {
  knowledgeWikiConfigSchema,
  resolveWikiConfig,
  resolveEffectiveVaultRoot,
} from "./src/config.js";
import { registerWikiGatewayMethods } from "./src/gateway.js";
import { createWikiPromptSectionBuilder } from "./src/prompt-section.js";
import {
  createWikiIngestTool,
  createWikiLintTool,
  createWikiQueryTool,
  createWikiStatusTool,
  type WikiToolContext,
} from "./src/tool.js";

export default definePluginEntry({
  id: "knowledge-wiki",
  name: "Knowledge Wiki",
  description:
    "LLM-compiled knowledge wiki. Reads workspace files, compiles structured knowledge pages with claims, entities, and concepts. Based on the Karpathy LLM Wiki pattern.",
  configSchema: knowledgeWikiConfigSchema,
  register(api) {
    const config = resolveWikiConfig(api.pluginConfig);

    const getGenerateText = async (): Promise<GenerateTextFn> => {
      const { createStandaloneGenerateText } = await import("kaijibot/plugin-sdk/generate-text");
      const fn = await createStandaloneGenerateText(api.config);
      return fn;
    };

    const resolveVault = (workspaceDir: string | undefined) =>
      resolveEffectiveVaultRoot(config, workspaceDir);

    const makeToolContext = (workspaceDir: string | undefined): WikiToolContext => ({
      config,
      workspaceDir: workspaceDir ?? "",
      vaultRoot: resolveVault(workspaceDir),
      getGenerateText,
    });

    api.registerTool((ctx) => createWikiStatusTool(makeToolContext(ctx.workspaceDir)), {
      name: "wiki_status",
    });
    api.registerTool((ctx) => createWikiQueryTool(makeToolContext(ctx.workspaceDir)), {
      name: "wiki_query",
    });
    api.registerTool((ctx) => createWikiIngestTool(makeToolContext(ctx.workspaceDir)), {
      name: "wiki_ingest",
    });
    api.registerTool((ctx) => createWikiLintTool(makeToolContext(ctx.workspaceDir)), {
      name: "wiki_lint",
    });

    api.registerMemoryPromptSupplement?.(createWikiPromptSectionBuilder(config));

    const defaultWorkspaceDir = path.dirname(resolveVault(undefined) || "");

    registerWikiGatewayMethods(api, {
      config,
      resolveVault,
      defaultWorkspaceDir,
      getGenerateText,
    });

    api.registerCli(
      ({ program }) => {
        registerWikiCli(program, {
          config,
          resolveVault,
          defaultWorkspaceDir,
          getGenerateText,
        });
      },
      {
        descriptors: [
          {
            name: "wiki",
            description: "LLM-compiled knowledge wiki",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
