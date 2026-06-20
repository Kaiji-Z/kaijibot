import path from "node:path";
import { definePluginEntry } from "./api.js";
import { registerWikiCli } from "./src/cli.js";
import { knowledgeWikiConfigSchema, resolveWikiConfig } from "./src/config.js";
import { registerWikiGatewayMethods } from "./src/gateway.js";
import { createWikiPromptSectionBuilder } from "./src/prompt-section.js";
import {
  createWikiIngestTool,
  createWikiLintTool,
  createWikiQueryTool,
  createWikiStatusTool,
  type WikiToolContext,
} from "./src/tool.js";
import type { GenerateTextFn } from "./src/compiler.js";

export default definePluginEntry({
  id: "knowledge-wiki",
  name: "Knowledge Wiki",
  description:
    "LLM-compiled knowledge wiki. Reads workspace files, compiles structured knowledge pages with claims, entities, and concepts. Based on the Karpathy LLM Wiki pattern.",
  configSchema: knowledgeWikiConfigSchema,
  register(api) {
    const config = resolveWikiConfig(api.pluginConfig);

    const vaultRoot = config.vault.path;
    const workspaceDir = path.dirname(vaultRoot);

    const getGenerateText = async (): Promise<GenerateTextFn> => {
      const { createStandaloneGenerateText } = await import(
        "kaijibot/plugin-sdk/generate-text"
      );
      const fn = await createStandaloneGenerateText(api.config);
      return fn;
    };

    const toolContext: WikiToolContext = {
      config,
      workspaceDir,
      vaultRoot,
      getGenerateText,
    };

    api.registerTool(createWikiStatusTool(toolContext), { name: "wiki_status" });
    api.registerTool(createWikiQueryTool(toolContext), { name: "wiki_query" });
    api.registerTool(createWikiIngestTool(toolContext), { name: "wiki_ingest" });
    api.registerTool(createWikiLintTool(toolContext), { name: "wiki_lint" });

    api.registerMemoryPromptSupplement?.(
      createWikiPromptSectionBuilder(config, vaultRoot),
    );

    registerWikiGatewayMethods(api, {
      config,
      workspaceDir,
      vaultRoot,
      getGenerateText,
    });

    api.registerCli(
      ({ program }) => {
        registerWikiCli(program, {
          config,
          workspaceDir,
          vaultRoot,
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
