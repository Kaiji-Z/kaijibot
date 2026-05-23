import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { createJiti } from "jiti";
import { tryNativeRequireJavaScriptModule } from "./native-module-require.js";
import { PluginLruCache } from "./plugin-cache-primitives.js";
import {
  buildPluginLoaderJitiOptions,
  createPluginLoaderJitiCacheKey,
  resolvePluginLoaderJitiConfig,
  type PluginSdkResolutionPreference,
} from "./sdk-alias.js";

export type PluginModuleLoader = ReturnType<typeof createJiti>;
export type PluginModuleLoaderFactory = typeof createJiti;
export type PluginModuleLoaderCache = Pick<
  PluginLruCache<PluginModuleLoader>,
  "clear" | "get" | "set" | "size"
>;
export type ResolvePluginModuleLoaderCacheEntryParams = {
  modulePath: string;
  importerUrl: string;
  argvEntry?: string;
  preferBuiltDist?: boolean;
  loaderFilename?: string;
  aliasMap?: Record<string, string>;
  tryNative?: boolean;
  pluginSdkResolution?: PluginSdkResolutionPreference;
  cacheScopeKey?: string;
  sharedCacheScopeKey?: string;
};
export type PluginModuleLoaderCacheEntry = {
  loaderFilename: string;
  aliasMap: Record<string, string>;
  tryNative: boolean;
  cacheKey: string;
  scopedCacheKey: string;
};
export type PluginModuleLoaderStatsSnapshot = {
  calls: number;
  nativeHits: number;
  nativeMisses: number;
  sourceTransformForced: number;
  sourceTransformFallbacks: number;
  topSourceTransformTargets: Array<{ target: string; count: number }>;
};

const DEFAULT_PLUGIN_MODULE_LOADER_CACHE_ENTRIES = 128;
const MAX_TRACKED_SOURCE_TRANSFORM_TARGETS = 24;
const PLUGIN_SDK_IMPORT_SPECIFIER_PATTERN =
  /(?:\bfrom\s*["']|\bimport\s*\(\s*["']|\brequire\s*\(\s*["'])(?:kaijibot|@kaiji-z)\/plugin-sdk(?:\/[^"']*)?["']/u;
const requireForJiti = createRequire(import.meta.url);
let createJitiLoaderFactory: PluginModuleLoaderFactory | undefined;
const pluginModuleLoaderStats = {
  calls: 0,
  nativeHits: 0,
  nativeMisses: 0,
  sourceTransformForced: 0,
  sourceTransformFallbacks: 0,
  sourceTransformTargets: new Map<string, number>(),
};

function recordSourceTransformTarget(target: string): void {
  const current = pluginModuleLoaderStats.sourceTransformTargets.get(target) ?? 0;
  pluginModuleLoaderStats.sourceTransformTargets.set(target, current + 1);
  if (pluginModuleLoaderStats.sourceTransformTargets.size <= MAX_TRACKED_SOURCE_TRANSFORM_TARGETS) {
    return;
  }
  let leastUsedTarget: string | undefined;
  let leastUsedCount = Number.POSITIVE_INFINITY;
  for (const [candidate, count] of pluginModuleLoaderStats.sourceTransformTargets) {
    if (count < leastUsedCount) {
      leastUsedTarget = candidate;
      leastUsedCount = count;
    }
  }
  if (leastUsedTarget) {
    pluginModuleLoaderStats.sourceTransformTargets.delete(leastUsedTarget);
  }
}

export function getPluginModuleLoaderStats(): PluginModuleLoaderStatsSnapshot {
  return {
    calls: pluginModuleLoaderStats.calls,
    nativeHits: pluginModuleLoaderStats.nativeHits,
    nativeMisses: pluginModuleLoaderStats.nativeMisses,
    sourceTransformForced: pluginModuleLoaderStats.sourceTransformForced,
    sourceTransformFallbacks: pluginModuleLoaderStats.sourceTransformFallbacks,
    topSourceTransformTargets: [...pluginModuleLoaderStats.sourceTransformTargets]
      .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .map(([target, count]) => ({ target, count })),
  };
}

export function resetPluginModuleLoaderStatsForTest(): void {
  pluginModuleLoaderStats.calls = 0;
  pluginModuleLoaderStats.nativeHits = 0;
  pluginModuleLoaderStats.nativeMisses = 0;
  pluginModuleLoaderStats.sourceTransformForced = 0;
  pluginModuleLoaderStats.sourceTransformFallbacks = 0;
  pluginModuleLoaderStats.sourceTransformTargets.clear();
}

function loadCreateJitiLoaderFactory(): PluginModuleLoaderFactory {
  if (createJitiLoaderFactory) {
    return createJitiLoaderFactory;
  }
  const loaded = requireForJiti("jiti") as { createJiti?: PluginModuleLoaderFactory };
  if (typeof loaded.createJiti !== "function") {
    throw new Error("jiti module did not export createJiti");
  }
  createJitiLoaderFactory = loaded.createJiti;
  return createJitiLoaderFactory;
}

export function createPluginModuleLoaderCache(
  maxEntries = DEFAULT_PLUGIN_MODULE_LOADER_CACHE_ENTRIES,
): PluginModuleLoaderCache {
  return new PluginLruCache<PluginModuleLoader>(maxEntries);
}

function toSourceTransformImportPath(specifier: string): string {
  if (process.platform === "win32" && path.isAbsolute(specifier)) {
    return pathToFileURL(specifier).href;
  }
  return toSafeImportPath(specifier);
}

function resolveDefaultPluginModuleLoaderConfig(
  params: ResolvePluginModuleLoaderCacheEntryParams,
): ReturnType<typeof resolvePluginLoaderJitiConfig> {
  return resolvePluginLoaderJitiConfig({
    modulePath: params.modulePath,
    argv1: params.argvEntry ?? process.argv[1],
    moduleUrl: params.importerUrl,
    ...(params.preferBuiltDist ? { preferBuiltDist: true } : {}),
  });
}

export function resolvePluginModuleLoaderCacheEntry(
  params: ResolvePluginModuleLoaderCacheEntryParams,
): PluginModuleLoaderCacheEntry {
  const loaderFilename = toSafeImportPath(params.loaderFilename ?? params.modulePath);
  const hasAliasOverride = Boolean(params.aliasMap);
  const hasTryNativeOverride = typeof params.tryNative === "boolean";
  const defaultConfig =
    hasAliasOverride || hasTryNativeOverride
      ? resolveDefaultPluginModuleLoaderConfig(params)
      : null;
  const canReuseDefaultCacheKey =
    defaultConfig !== null &&
    (!hasAliasOverride || params.aliasMap === defaultConfig.aliasMap) &&
    (!hasTryNativeOverride || params.tryNative === defaultConfig.tryNative);
  const resolved = defaultConfig
    ? {
        tryNative: params.tryNative ?? defaultConfig.tryNative,
        aliasMap: params.aliasMap ?? defaultConfig.aliasMap,
        cacheKey: canReuseDefaultCacheKey ? defaultConfig.cacheKey : undefined,
      }
    : resolveDefaultPluginModuleLoaderConfig(params);
  const { tryNative, aliasMap } = resolved;
  const cacheKey =
    resolved.cacheKey ??
    createPluginLoaderJitiCacheKey({
      tryNative,
      aliasMap,
    });
  const scopedCacheKey = `${loaderFilename}::${
    params.sharedCacheScopeKey ??
    (params.cacheScopeKey ? `${params.cacheScopeKey}::${cacheKey}` : cacheKey)
  }`;
  return {
    loaderFilename,
    aliasMap,
    tryNative,
    cacheKey,
    scopedCacheKey,
  };
}

function createLazySourceTransformLoader(params: {
  loaderFilename: string;
  aliasMap: Record<string, string>;
  sourceTransformTryNative: boolean;
  createLoader?: PluginModuleLoaderFactory;
}): () => PluginModuleLoader {
  let loadWithSourceTransform: PluginModuleLoader | undefined;
  return () => {
    if (loadWithSourceTransform) {
      return loadWithSourceTransform;
    }
    const jitiLoader = (params.createLoader ?? loadCreateJitiLoaderFactory())(
      params.loaderFilename,
      {
        ...buildPluginLoaderJitiOptions(params.aliasMap),
        tryNative: params.sourceTransformTryNative,
      },
    );
    loadWithSourceTransform = new Proxy(jitiLoader, {
      apply(target, thisArg, argArray) {
        const [first, ...rest] = argArray as [unknown, ...unknown[]];
        if (typeof first === "string") {
          return Reflect.apply(target, thisArg, [
            toSourceTransformImportPath(first),
            ...rest,
          ]) as never;
        }
        return Reflect.apply(target, thisArg, argArray as never) as never;
      },
    });
    return loadWithSourceTransform;
  };
}

function shouldForceSourceTransformForPluginSdkAlias(params: {
  target: string;
  aliasMap: Record<string, string>;
}): boolean {
  if (
    !params.aliasMap["kaijibot/plugin-sdk"] &&
    !params.aliasMap["@kaiji-z/plugin-sdk"] &&
    !Object.keys(params.aliasMap).some(
      (key) => key.startsWith("kaijibot/plugin-sdk/") || key.startsWith("@kaiji-z/plugin-sdk/"),
    )
  ) {
    return false;
  }
  if (!/\.[cm]?js$/iu.test(params.target)) {
    return false;
  }
  try {
    return PLUGIN_SDK_IMPORT_SPECIFIER_PATTERN.test(fs.readFileSync(params.target, "utf-8"));
  } catch {
    return false;
  }
}

function createPluginModuleLoader(params: {
  loaderFilename: string;
  aliasMap: Record<string, string>;
  tryNative: boolean;
  createLoader?: PluginModuleLoaderFactory;
}): PluginModuleLoader {
  const getLoadWithSourceTransform = createLazySourceTransformLoader({
    ...params,
    sourceTransformTryNative: params.tryNative,
  });
  if (!params.tryNative) {
    return ((target: string, ...rest: unknown[]) => {
      pluginModuleLoaderStats.calls += 1;
      pluginModuleLoaderStats.sourceTransformForced += 1;
      recordSourceTransformTarget(target);
      return (getLoadWithSourceTransform() as (t: string, ...a: unknown[]) => unknown)(
        target,
        ...rest,
      );
    }) as PluginModuleLoader;
  }
  const getLoadWithAliasTransform = createLazySourceTransformLoader({
    ...params,
    sourceTransformTryNative: false,
  });
  return ((target: string, ...rest: unknown[]) => {
    pluginModuleLoaderStats.calls += 1;
    if (shouldForceSourceTransformForPluginSdkAlias({ target, aliasMap: params.aliasMap })) {
      pluginModuleLoaderStats.sourceTransformForced += 1;
      recordSourceTransformTarget(target);
      return (getLoadWithAliasTransform() as (t: string, ...a: unknown[]) => unknown)(
        target,
        ...rest,
      );
    }
    const native = tryNativeRequireJavaScriptModule(target, {
      allowWindows: true,
      aliasMap: params.aliasMap,
      fallbackOnMissingDependency: true,
      fallbackOnNativeError: true,
    });
    if (native.ok) {
      pluginModuleLoaderStats.nativeHits += 1;
      return native.moduleExport;
    }
    pluginModuleLoaderStats.nativeMisses += 1;
    pluginModuleLoaderStats.sourceTransformFallbacks += 1;
    recordSourceTransformTarget(target);
    return (getLoadWithSourceTransform() as (t: string, ...a: unknown[]) => unknown)(
      target,
      ...rest,
    );
  }) as PluginModuleLoader;
}

export function getCachedPluginModuleLoader(
  params: ResolvePluginModuleLoaderCacheEntryParams & {
    cache: PluginModuleLoaderCache;
    createLoader?: PluginModuleLoaderFactory;
  },
): PluginModuleLoader {
  const cacheEntry = resolvePluginModuleLoaderCacheEntry(params);
  const cached = params.cache.get(cacheEntry.scopedCacheKey);
  if (cached) {
    return cached;
  }
  const loader = createPluginModuleLoader({
    loaderFilename: cacheEntry.loaderFilename,
    aliasMap: cacheEntry.aliasMap,
    tryNative: cacheEntry.tryNative,
    ...(params.createLoader ? { createLoader: params.createLoader } : {}),
  });
  params.cache.set(cacheEntry.scopedCacheKey, loader);
  return loader;
}

export function getCachedPluginSourceModuleLoader(
  params: Omit<Parameters<typeof getCachedPluginModuleLoader>[0], "tryNative">,
): PluginModuleLoader {
  return getCachedPluginModuleLoader({
    ...params,
    tryNative: false,
  });
}

function toSafeImportPath(specifier: string): string {
  if (process.platform !== "win32") {
    return specifier;
  }
  if (specifier.startsWith("file://")) {
    return specifier;
  }
  if (path.win32.isAbsolute(specifier)) {
    const normalizedSpecifier = specifier.replaceAll("\\", "/");
    if (normalizedSpecifier.startsWith("//")) {
      return new URL(`file:${encodeURI(normalizedSpecifier)}`).href;
    }
    return new URL(`file:///${encodeURI(normalizedSpecifier)}`).href;
  }
  return specifier;
}
