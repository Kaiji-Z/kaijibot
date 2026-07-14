import type { KaijiBotPluginApi } from "../api.js";
import type { GenerateTextFn } from "./compiler.js";
import type { WikiConfig } from "./config.js";
import { ingestAll } from "./ingest.js";
import { lintWiki } from "./lint.js";
import { queryWiki } from "./query.js";
import { resolveWikiStatus } from "./status.js";
import { initializeWikiVault } from "./vault.js";

export type GatewayDeps = {
  config: WikiConfig;
  resolveVault: (workspaceDir: string | undefined) => string;
  defaultWorkspaceDir: string;
  getGenerateText: () => Promise<GenerateTextFn>;
};

export function registerWikiGatewayMethods(api: KaijiBotPluginApi, deps: GatewayDeps): void {
  const resolveVaultFromParams = (params: Record<string, unknown>) => {
    const workspaceDir =
      typeof params.workspaceDir === "string" ? params.workspaceDir : deps.defaultWorkspaceDir;
    return {
      vaultRoot: deps.resolveVault(workspaceDir || undefined),
      workspaceDir,
    };
  };

  api.registerGatewayMethod("wiki.status", async ({ params, respond }) => {
    const { vaultRoot } = resolveVaultFromParams(params);
    const status = await resolveWikiStatus(vaultRoot);
    respond(true, status);
  });

  api.registerGatewayMethod("wiki.query", async ({ params, respond }) => {
    const query = params.query as string | undefined;
    if (!query) {
      respond(false, { error: "query is required" });
      return;
    }
    const { vaultRoot } = resolveVaultFromParams(params);
    const result = await queryWiki(vaultRoot, query);
    respond(true, result);
  });

  api.registerGatewayMethod("wiki.lint", async ({ params, respond }) => {
    const { vaultRoot } = resolveVaultFromParams(params);
    const report = await lintWiki(vaultRoot);
    respond(true, report);
  });

  api.registerGatewayMethod("wiki.ingest", async ({ params, respond }) => {
    const { vaultRoot, workspaceDir } = resolveVaultFromParams(params);
    await initializeWikiVault(vaultRoot);
    const generateText = await deps.getGenerateText();
    const result = await ingestAll(workspaceDir, vaultRoot, generateText, deps.config);
    respond(true, result);
  });
}
