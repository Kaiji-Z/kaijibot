import { normalizeOptionalString } from "../../../src/shared/string-coerce.js";
import { isRecord } from "../../../src/utils.js";

export type JsonObject = Record<string, unknown>;

export type ExternalPluginCompatibility = {
  pluginApiRange?: string;
  builtWithKaijiBotVersion?: string;
  pluginSdkVersion?: string;
  minGatewayVersion?: string;
};

export type ExternalPluginValidationIssue = {
  fieldPath: string;
  message: string;
};

export type ExternalCodePluginValidationResult = {
  compatibility?: ExternalPluginCompatibility;
  issues: ExternalPluginValidationIssue[];
};

export const EXTERNAL_CODE_PLUGIN_REQUIRED_FIELD_PATHS = [
  "kaijibot.compat.pluginApi",
  "kaijibot.build.kaijibotVersion",
] as const;

function readKaijiBotBlock(packageJson: unknown) {
  const root = isRecord(packageJson) ? packageJson : undefined;
  const kaijibot = isRecord(root?.kaijibot) ? root.kaijibot : undefined;
  const compat = isRecord(kaijibot?.compat) ? kaijibot.compat : undefined;
  const build = isRecord(kaijibot?.build) ? kaijibot.build : undefined;
  const install = isRecord(kaijibot?.install) ? kaijibot.install : undefined;
  return { root, kaijibot, compat, build, install };
}

export function normalizeExternalPluginCompatibility(
  packageJson: unknown,
): ExternalPluginCompatibility | undefined {
  const { root, compat, build, install } = readKaijiBotBlock(packageJson);
  const version = normalizeOptionalString(root?.version);
  const minHostVersion = normalizeOptionalString(install?.minHostVersion);
  const compatibility: ExternalPluginCompatibility = {};

  const pluginApi = normalizeOptionalString(compat?.pluginApi);
  if (pluginApi) {
    compatibility.pluginApiRange = pluginApi;
  }

  const minGatewayVersion = normalizeOptionalString(compat?.minGatewayVersion) ?? minHostVersion;
  if (minGatewayVersion) {
    compatibility.minGatewayVersion = minGatewayVersion;
  }

  const builtWithKaijiBotVersion = normalizeOptionalString(build?.kaijibotVersion) ?? version;
  if (builtWithKaijiBotVersion) {
    compatibility.builtWithKaijiBotVersion = builtWithKaijiBotVersion;
  }

  const pluginSdkVersion = normalizeOptionalString(build?.pluginSdkVersion);
  if (pluginSdkVersion) {
    compatibility.pluginSdkVersion = pluginSdkVersion;
  }

  return Object.keys(compatibility).length > 0 ? compatibility : undefined;
}

export function listMissingExternalCodePluginFieldPaths(packageJson: unknown): string[] {
  const { compat, build } = readKaijiBotBlock(packageJson);
  const missing: string[] = [];
  if (!normalizeOptionalString(compat?.pluginApi)) {
    missing.push("kaijibot.compat.pluginApi");
  }
  if (!normalizeOptionalString(build?.kaijibotVersion)) {
    missing.push("kaijibot.build.kaijibotVersion");
  }
  return missing;
}

export function validateExternalCodePluginPackageJson(
  packageJson: unknown,
): ExternalCodePluginValidationResult {
  const issues = listMissingExternalCodePluginFieldPaths(packageJson).map((fieldPath) => ({
    fieldPath,
    message: `${fieldPath} is required for external code plugins published to ClawHub.`,
  }));
  return {
    compatibility: normalizeExternalPluginCompatibility(packageJson),
    issues,
  };
}
