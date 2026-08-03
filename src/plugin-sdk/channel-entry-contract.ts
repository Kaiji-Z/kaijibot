import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { emptyChannelConfigSchema } from "../channels/plugins/config-schema.js";
import type { ChannelConfigSchema, ChannelPlugin } from "../channels/plugins/types.plugin.js";
import type { ChannelOutboundAdapter } from "../channels/plugins/types.adapters.js";
import { openBoundaryFileSync } from "../infra/boundary-file-read.js";
import type { PluginRuntime } from "../plugins/runtime/types.js";
import {
  buildPluginLoaderJitiOptions,
  resolveLoaderPackageRoot,
  resolvePluginLoaderJitiConfig,
} from "../plugins/sdk-alias.js";
import type { AnyAgentTool, KaijiBotPluginApi, PluginCommandContext } from "../plugins/types.js";
import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";

export type { AnyAgentTool, KaijiBotPluginApi, PluginCommandContext };

type ChannelEntryConfigSchema<TPlugin> =
  TPlugin extends ChannelPlugin<unknown>
    ? NonNullable<TPlugin["configSchema"]>
    : ChannelConfigSchema;

type BundledEntryModuleRef = {
  specifier: string;
  exportName?: string;
};

export type BundledChannelEntryFeatures = {
  accountInspect?: boolean;
};

export type BundledChannelSetupEntryFeatures = {
  legacyStateMigrations?: boolean;
  legacySessionSurfaces?: boolean;
};

/** Test hook for swapping the source-module loader used by bundled entry imports. */
export type BundledEntryModuleLoadOptions = {
  createLoaderForTest?: typeof createJiti;
};

type DefineBundledChannelEntryOptions<TPlugin = ChannelPlugin> = {
  id: string;
  name: string;
  description: string;
  importMetaUrl: string;
  plugin: BundledEntryModuleRef;
  outbound?: BundledEntryModuleRef;
  secrets?: BundledEntryModuleRef;
  configSchema?: ChannelEntryConfigSchema<TPlugin> | (() => ChannelEntryConfigSchema<TPlugin>);
  runtime?: BundledEntryModuleRef;
  accountInspect?: BundledEntryModuleRef;
  features?: BundledChannelEntryFeatures;
  registerCliMetadata?: (api: KaijiBotPluginApi) => void;
  registerFull?: (api: KaijiBotPluginApi) => void;
  registerCapabilities?: (api: KaijiBotPluginApi) => void;
};

type DefineBundledChannelSetupEntryOptions = {
  importMetaUrl: string;
  plugin: BundledEntryModuleRef;
  secrets?: BundledEntryModuleRef;
  runtime?: BundledEntryModuleRef;
  legacyStateMigrations?: BundledEntryModuleRef;
  legacySessionSurface?: BundledEntryModuleRef;
  registerSetupRuntime?: (api: KaijiBotPluginApi) => void;
  features?: BundledChannelSetupEntryFeatures;
};

export type BundledChannelLegacySessionSurface = {
  isLegacyGroupSessionKey?: (key: string) => boolean;
  canonicalizeLegacySessionKey?: (params: {
    key: string;
    agentId: string;
  }) => string | null | undefined;
};

export type BundledChannelLegacyStateMigrationDetector = (params: {
  cfg: unknown;
  env: NodeJS.ProcessEnv;
  stateDir: string;
  oauthDir: string;
}) =>
  | unknown[]
  | Promise<unknown[] | null | undefined>
  | null
  | undefined;

export type BundledChannelEntryContract<TPlugin = ChannelPlugin> = {
  kind: "bundled-channel-entry";
  id: string;
  name: string;
  description: string;
  configSchema: ChannelEntryConfigSchema<TPlugin>;
  features?: BundledChannelEntryFeatures;
  register: (api: KaijiBotPluginApi) => void;
  loadChannelPlugin: (options?: BundledEntryModuleLoadOptions) => TPlugin;
  loadChannelOutbound?: (options?: BundledEntryModuleLoadOptions) => ChannelOutboundAdapter | undefined;
  loadChannelSecrets?: (options?: BundledEntryModuleLoadOptions) => ChannelPlugin["secrets"] | undefined;
  loadChannelAccountInspector?: (options?: BundledEntryModuleLoadOptions) => NonNullable<ChannelPlugin["config"]["inspectAccount"]>;
  setChannelRuntime?: (runtime: PluginRuntime) => void;
};

export type BundledChannelSetupEntryContract<TPlugin = ChannelPlugin> = {
  kind: "bundled-channel-setup-entry";
  loadSetupPlugin: (options?: BundledEntryModuleLoadOptions) => TPlugin;
  loadSetupSecrets?: (options?: BundledEntryModuleLoadOptions) => ChannelPlugin["secrets"] | undefined;
  loadLegacyStateMigrationDetector?: (options?: BundledEntryModuleLoadOptions) => BundledChannelLegacyStateMigrationDetector;
  loadLegacySessionSurface?: (options?: BundledEntryModuleLoadOptions) => BundledChannelLegacySessionSurface;
  setChannelRuntime?: (runtime: PluginRuntime) => void;
  registerSetupRuntime?: (api: KaijiBotPluginApi) => void;
  features?: BundledChannelSetupEntryFeatures;
};

const nodeRequire = createRequire(import.meta.url);
const jitiLoaders = new Map<string, ReturnType<typeof createJiti>>();
const loadedModuleExports = new Map<string, unknown>();
const disableBundledEntrySourceFallbackEnv = "KAIJIBOT_DISABLE_BUNDLED_ENTRY_SOURCE_FALLBACK";

function isTruthyEnvFlag(value: string | undefined): boolean {
  return value !== undefined && !/^(?:0|false)$/iu.test(value.trim());
}

function resolveSpecifierCandidates(modulePath: string): string[] {
  const ext = normalizeLowercaseStringOrEmpty(path.extname(modulePath));
  if (ext === ".js") {
    return [modulePath, modulePath.slice(0, -3) + ".ts"];
  }
  if (ext === ".mjs") {
    return [modulePath, modulePath.slice(0, -4) + ".mts"];
  }
  if (ext === ".cjs") {
    return [modulePath, modulePath.slice(0, -4) + ".cts"];
  }
  return [modulePath];
}

function resolveEntryBoundaryRoot(importMetaUrl: string): string {
  return path.dirname(fileURLToPath(importMetaUrl));
}

type BundledEntryModuleCandidate = {
  path: string;
  boundaryRoot: string;
};

function addBundledEntryCandidates(
  candidates: BundledEntryModuleCandidate[],
  basePath: string,
  boundaryRoot: string,
): void {
  for (const candidate of resolveSpecifierCandidates(basePath)) {
    if (
      candidates.some((entry) => entry.path === candidate && entry.boundaryRoot === boundaryRoot)
    ) {
      continue;
    }
    candidates.push({ path: candidate, boundaryRoot });
  }
}

function resolveBundledEntryModuleCandidates(
  importMetaUrl: string,
  specifier: string,
): BundledEntryModuleCandidate[] {
  const importerPath = fileURLToPath(importMetaUrl);
  const importerDir = path.dirname(importerPath);
  const boundaryRoot = resolveEntryBoundaryRoot(importMetaUrl);
  const candidates: BundledEntryModuleCandidate[] = [];
  const primaryResolved = path.resolve(importerDir, specifier);
  addBundledEntryCandidates(candidates, primaryResolved, boundaryRoot);

  const sourceRelativeSpecifier = specifier.replace(/^\.\/src\//u, "./");
  if (sourceRelativeSpecifier !== specifier) {
    addBundledEntryCandidates(
      candidates,
      path.resolve(importerDir, sourceRelativeSpecifier),
      boundaryRoot,
    );
  }

  const packageRoot = resolveLoaderPackageRoot({
    modulePath: importerPath,
    moduleUrl: importMetaUrl,
    cwd: importerDir,
    argv1: process.argv[1],
  });
  if (!packageRoot) {
    return candidates;
  }

  const distExtensionsRoot = path.join(packageRoot, "dist", "extensions") + path.sep;
  if (!importerPath.startsWith(distExtensionsRoot)) {
    return candidates;
  }
  if (isTruthyEnvFlag(process.env[disableBundledEntrySourceFallbackEnv])) {
    return candidates;
  }

  const pluginDirName = path.basename(importerDir);
  const sourcePluginRoot = path.join(packageRoot, "extensions", pluginDirName);
  if (sourcePluginRoot === boundaryRoot) {
    return candidates;
  }

  addBundledEntryCandidates(
    candidates,
    path.resolve(sourcePluginRoot, specifier),
    sourcePluginRoot,
  );
  if (sourceRelativeSpecifier !== specifier) {
    addBundledEntryCandidates(
      candidates,
      path.resolve(sourcePluginRoot, sourceRelativeSpecifier),
      sourcePluginRoot,
    );
  }
  return candidates;
}

function formatBundledEntryUnknownError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error === undefined) {
    return "boundary validation failed";
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "non-serializable error";
  }
}

function formatBundledEntryModuleOpenFailure(params: {
  importMetaUrl: string;
  specifier: string;
  resolvedPath: string;
  boundaryRoot: string;
  failure: Extract<ReturnType<typeof openBoundaryFileSync>, { ok: false }>;
}): string {
  const importerPath = fileURLToPath(params.importMetaUrl);
  const errorDetail =
    params.failure.error instanceof Error
      ? params.failure.error.message
      : formatBundledEntryUnknownError(params.failure.error);
  return [
    `bundled plugin entry "${params.specifier}" failed to open`,
    `from "${importerPath}"`,
    `(resolved "${params.resolvedPath}", plugin root "${params.boundaryRoot}",`,
    `reason "${params.failure.reason}"): ${errorDetail}`,
  ].join(" ");
}

function resolveBundledEntryModulePath(importMetaUrl: string, specifier: string): string {
  const candidates = resolveBundledEntryModuleCandidates(importMetaUrl, specifier);
  const fallbackCandidate = candidates[0] ?? {
    path: path.resolve(path.dirname(fileURLToPath(importMetaUrl)), specifier),
    boundaryRoot: resolveEntryBoundaryRoot(importMetaUrl),
  };

  let firstFailure: {
    candidate: BundledEntryModuleCandidate;
    failure: Extract<ReturnType<typeof openBoundaryFileSync>, { ok: false }>;
  } | null = null;

  for (const candidate of candidates) {
    const opened = openBoundaryFileSync({
      absolutePath: candidate.path,
      rootPath: candidate.boundaryRoot,
      boundaryLabel: "plugin root",
      rejectHardlinks: false,
      skipLexicalRootCheck: true,
    });
    if (opened.ok) {
      fs.closeSync(opened.fd);
      return opened.path;
    }
    firstFailure ??= { candidate, failure: opened };
  }

  const failure = firstFailure;
  if (!failure) {
    throw new Error(
      formatBundledEntryModuleOpenFailure({
        importMetaUrl,
        specifier,
        resolvedPath: fallbackCandidate.path,
        boundaryRoot: fallbackCandidate.boundaryRoot,
        failure: {
          ok: false,
          reason: "path",
          error: new Error(`ENOENT: no such file or directory, lstat '${fallbackCandidate.path}'`),
        },
      }),
    );
  }

  throw new Error(
    formatBundledEntryModuleOpenFailure({
      importMetaUrl,
      specifier,
      resolvedPath: failure.candidate.path,
      boundaryRoot: failure.candidate.boundaryRoot,
      failure: failure.failure,
    }),
  );
}

function getJiti(modulePath: string, loaderFactory?: typeof createJiti) {
  const { tryNative, aliasMap, cacheKey } = resolvePluginLoaderJitiConfig({
    modulePath,
    argv1: process.argv[1],
    moduleUrl: import.meta.url,
    preferBuiltDist: true,
  });
  const cached = jitiLoaders.get(cacheKey);
  if (cached) {
    return cached;
  }
  const loader = (loaderFactory ?? createJiti)(import.meta.url, {
    ...buildPluginLoaderJitiOptions(aliasMap),
    tryNative,
  });
  jitiLoaders.set(cacheKey, loader);
  return loader;
}

function loadBundledEntryModuleSync(
  importMetaUrl: string,
  specifier: string,
  options?: BundledEntryModuleLoadOptions,
): unknown {
  const modulePath = resolveBundledEntryModulePath(importMetaUrl, specifier);
  const cached = loadedModuleExports.get(modulePath);
  if (cached !== undefined) {
    return cached;
  }
  let loaded: unknown;
  if (
    process.platform === "win32" &&
    modulePath.includes(`${path.sep}dist${path.sep}`) &&
    [".js", ".mjs", ".cjs"].includes(normalizeLowercaseStringOrEmpty(path.extname(modulePath)))
  ) {
    try {
      loaded = nodeRequire(modulePath);
    } catch {
      loaded = getJiti(modulePath, options?.createLoaderForTest)(modulePath);
    }
  } else {
    loaded = getJiti(modulePath, options?.createLoaderForTest)(modulePath);
  }
  loadedModuleExports.set(modulePath, loaded);
  return loaded;
}

export function loadBundledEntryExportSync<T>(
  importMetaUrl: string,
  reference: BundledEntryModuleRef,
  options?: BundledEntryModuleLoadOptions,
): T {
  const loaded = loadBundledEntryModuleSync(importMetaUrl, reference.specifier, options);
  const resolved =
    loaded && typeof loaded === "object" && "default" in (loaded as Record<string, unknown>)
      ? (loaded as { default: unknown }).default
      : loaded;
  if (!reference.exportName) {
    return resolved as T;
  }
  const record = (resolved ?? loaded) as Record<string, unknown> | undefined;
  if (!record || !(reference.exportName in record)) {
    throw new Error(
      `missing export "${reference.exportName}" from bundled entry module ${reference.specifier}`,
    );
  }
  return record[reference.exportName] as T;
}

export function defineBundledChannelEntry<TPlugin = ChannelPlugin>({
  id,
  name,
  description,
  importMetaUrl,
  plugin,
  outbound,
  secrets,
  configSchema,
  runtime,
  accountInspect,
  features,
  registerCliMetadata,
  registerFull,
  registerCapabilities,
}: DefineBundledChannelEntryOptions<TPlugin>): BundledChannelEntryContract<TPlugin> {
  const resolvedConfigSchema: ChannelEntryConfigSchema<TPlugin> =
    typeof configSchema === "function"
      ? configSchema()
      : ((configSchema ?? emptyChannelConfigSchema()) as ChannelEntryConfigSchema<TPlugin>);
  const loadChannelPlugin = (options?: BundledEntryModuleLoadOptions) =>
    loadBundledEntryExportSync<TPlugin>(importMetaUrl, plugin, options);
  const loadChannelOutbound = outbound
    ? (options?: BundledEntryModuleLoadOptions) =>
        loadBundledEntryExportSync<ChannelOutboundAdapter | undefined>(importMetaUrl, outbound, options)
    : undefined;
  const loadChannelSecrets = secrets
    ? (options?: BundledEntryModuleLoadOptions) =>
        loadBundledEntryExportSync<ChannelPlugin["secrets"] | undefined>(importMetaUrl, secrets, options)
    : undefined;
  const loadChannelAccountInspector = accountInspect
    ? (options?: BundledEntryModuleLoadOptions) =>
        loadBundledEntryExportSync<NonNullable<ChannelPlugin["config"]["inspectAccount"]>>(
          importMetaUrl,
          accountInspect,
          options,
        )
    : undefined;
  const setChannelRuntime = runtime
    ? (pluginRuntime: PluginRuntime) => {
        const setter = loadBundledEntryExportSync<(runtime: PluginRuntime) => void>(
          importMetaUrl,
          runtime,
        );
        setter(pluginRuntime);
      }
    : undefined;

  return {
    kind: "bundled-channel-entry",
    id,
    name,
    description,
    configSchema: resolvedConfigSchema,
    ...(features || accountInspect
      ? { features: { ...features, ...(accountInspect ? { accountInspect: true } : {}) } }
      : {}),
    register(api: KaijiBotPluginApi) {
      if (api.registrationMode === "cli-metadata") {
        registerCliMetadata?.(api);
        return;
      }
      if (api.registrationMode === "tool-discovery") {
        registerCapabilities?.(api);
        return;
      }
      setChannelRuntime?.(api.runtime);
      api.registerChannel({ plugin: loadChannelPlugin() as ChannelPlugin });
      if (api.registrationMode === "discovery") {
        registerCliMetadata?.(api);
        registerCapabilities?.(api);
        return;
      }
      if (api.registrationMode !== "full") {
        return;
      }
      registerCliMetadata?.(api);
      registerFull?.(api);
      registerCapabilities?.(api);
    },
    loadChannelPlugin,
    ...(loadChannelOutbound ? { loadChannelOutbound } : {}),
    ...(loadChannelSecrets ? { loadChannelSecrets } : {}),
    ...(loadChannelAccountInspector ? { loadChannelAccountInspector } : {}),
    ...(setChannelRuntime ? { setChannelRuntime } : {}),
  };
}

export function defineBundledChannelSetupEntry<TPlugin = ChannelPlugin>({
  importMetaUrl,
  plugin,
  secrets,
  runtime,
  legacyStateMigrations,
  legacySessionSurface,
  registerSetupRuntime,
  features,
}: DefineBundledChannelSetupEntryOptions): BundledChannelSetupEntryContract<TPlugin> {
  const setChannelRuntime = runtime
    ? (pluginRuntime: PluginRuntime) => {
        const setter = loadBundledEntryExportSync<(runtime: PluginRuntime) => void>(
          importMetaUrl,
          runtime,
        );
        setter(pluginRuntime);
      }
    : undefined;
  const loadLegacyStateMigrationDetector = legacyStateMigrations
    ? (options?: BundledEntryModuleLoadOptions) =>
        loadBundledEntryExportSync<BundledChannelLegacyStateMigrationDetector>(
          importMetaUrl,
          legacyStateMigrations,
          options,
        )
    : undefined;
  const loadLegacySessionSurface = legacySessionSurface
    ? (options?: BundledEntryModuleLoadOptions) =>
        loadBundledEntryExportSync<BundledChannelLegacySessionSurface>(
          importMetaUrl,
          legacySessionSurface,
          options,
        )
    : undefined;
  return {
    kind: "bundled-channel-setup-entry",
    loadSetupPlugin: (options?: BundledEntryModuleLoadOptions) =>
      loadBundledEntryExportSync<TPlugin>(importMetaUrl, plugin, options),
    ...(secrets
      ? {
          loadSetupSecrets: (options?: BundledEntryModuleLoadOptions) =>
            loadBundledEntryExportSync<ChannelPlugin["secrets"] | undefined>(
              importMetaUrl,
              secrets,
              options,
            ),
        }
      : {}),
    ...(loadLegacyStateMigrationDetector ? { loadLegacyStateMigrationDetector } : {}),
    ...(loadLegacySessionSurface ? { loadLegacySessionSurface } : {}),
    ...(setChannelRuntime ? { setChannelRuntime } : {}),
    ...(registerSetupRuntime ? { registerSetupRuntime } : {}),
    ...(features ? { features } : {}),
  };
}
