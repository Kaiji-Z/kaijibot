import { loadBundledPluginPublicSurfaceSync } from "../../../src/test-utils/bundled-plugin-public-surface.js";

type FeishuSecuritySurface = typeof import("@kaijibot/feishu/security-contract-api.js");

function loadFeishuSecuritySurface(): FeishuSecuritySurface {
  return loadBundledPluginPublicSurfaceSync<FeishuSecuritySurface>({
    pluginId: "feishu",
    artifactBasename: "security-contract-api.js",
  });
}

export const collectFeishuSecurityAuditFindings: FeishuSecuritySurface["collectFeishuSecurityAuditFindings"] =
  ((...args: unknown[]) =>
    loadFeishuSecuritySurface().collectFeishuSecurityAuditFindings(
      ...(args as Parameters<FeishuSecuritySurface["collectFeishuSecurityAuditFindings"]>),
    )) as FeishuSecuritySurface["collectFeishuSecurityAuditFindings"];
