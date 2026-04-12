import { existsSync } from "node:fs";
import path from "node:path";
import type { KaijiBotConfig } from "../../../config/config.js";
import { resolveBundledPluginWorkspaceSourcePath } from "../../../plugins/bundled-plugin-metadata.js";
import { resolveBundledPluginInstallCommandHint } from "../../../plugins/bundled-sources.js";
import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "../../../shared/string-coerce.js";

export function resolveAcpInstallCommandHint(cfg: KaijiBotConfig): string {
  const configured = normalizeOptionalString(cfg.acp?.runtime?.installCommand);
  if (configured) {
    return configured;
  }
  const workspaceDir = process.cwd();
  const backendId = normalizeOptionalLowercaseString(cfg.acp?.backend) ?? "acpx";
  if (backendId === "acpx") {
    const workspaceLocalPath = resolveBundledPluginWorkspaceSourcePath({
      rootDir: workspaceDir,
      pluginId: backendId,
    });
    if (workspaceLocalPath && existsSync(workspaceLocalPath)) {
      return `kaijibot plugins install ${workspaceLocalPath}`;
    }
    const bundledInstallHint = resolveBundledPluginInstallCommandHint({
      pluginId: backendId,
      workspaceDir,
    });
    if (bundledInstallHint) {
      const localPath = bundledInstallHint.replace(/^kaijibot plugins install /u, "");
      const resolvedLocalPath = path.resolve(localPath);
      const relativeToWorkspace = path.relative(workspaceDir, resolvedLocalPath);
      const belongsToWorkspace =
        relativeToWorkspace.length === 0 ||
        (!relativeToWorkspace.startsWith("..") && !path.isAbsolute(relativeToWorkspace));
      if (belongsToWorkspace && existsSync(resolvedLocalPath)) {
        return bundledInstallHint;
      }
    }
    return "kaijibot plugins install acpx";
  }
  return `Install and enable the plugin that provides ACP backend "${backendId}".`;
}
