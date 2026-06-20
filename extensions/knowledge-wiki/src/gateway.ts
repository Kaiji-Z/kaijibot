import type { KaijiBotPluginApi } from "../api.js";
import type { WikiConfig } from "./config.js";
import type { GenerateTextFn } from "./compiler.js";
import { ingestAll } from "./ingest.js";
import { queryWiki } from "./query.js";
import { lintWiki } from "./lint.js";
import { resolveWikiStatus } from "./status.js";
import { initializeWikiVault } from "./vault.js";

export type GatewayDeps = {
  config: WikiConfig;
  workspaceDir: string;
  vaultRoot: string;
  getGenerateText: () => Promise<GenerateTextFn>;
};

export function registerWikiGatewayMethods(
  api: KaijiBotPluginApi,
  deps: GatewayDeps,
): void {
  api.registerGatewayMethod("wiki.status", async ({ respond }) => {
    const status = await resolveWikiStatus(deps.vaultRoot);
    respond(true, status);
  });

  api.registerGatewayMethod("wiki.query", async ({ params, respond }) => {
    const query = params.query as string | undefined;
    if (!query) {
      respond(false, { error: "query is required" });
      return;
    }
    const result = await queryWiki(deps.vaultRoot, query);
    respond(true, result);
  });

  api.registerGatewayMethod("wiki.lint", async ({ respond }) => {
    const report = await lintWiki(deps.vaultRoot);
    respond(true, report);
  });

  api.registerGatewayMethod("wiki.ingest", async ({ respond }) => {
    await initializeWikiVault(deps.vaultRoot);
    const generateText = await deps.getGenerateText();
    const result = await ingestAll(
      deps.workspaceDir,
      deps.vaultRoot,
      generateText,
      deps.config,
    );
    respond(true, result);
  });
}
