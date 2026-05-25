// Manual facade. Keep loader boundary explicit.
type RuntimeFacadeModule = typeof import("@kaijibot/memory-core/runtime-api.js");
import { loadBundledPluginPublicSurfaceModuleSync } from "./facade-loader.js";

function loadRuntimeFacadeModule(): RuntimeFacadeModule {
  return loadBundledPluginPublicSurfaceModuleSync<RuntimeFacadeModule>({
    dirName: "memory-core",
    artifactBasename: "runtime-api.js",
  });
}

export const createEmbeddingProvider: RuntimeFacadeModule["createEmbeddingProvider"] = ((...args) =>
  loadRuntimeFacadeModule().createEmbeddingProvider(
    ...args,
  )) as RuntimeFacadeModule["createEmbeddingProvider"];

export const registerBuiltInMemoryEmbeddingProviders: RuntimeFacadeModule["registerBuiltInMemoryEmbeddingProviders"] =
  ((...args) =>
    loadRuntimeFacadeModule().registerBuiltInMemoryEmbeddingProviders(
      ...args,
    )) as RuntimeFacadeModule["registerBuiltInMemoryEmbeddingProviders"];

export const removeGroundedShortTermCandidates: RuntimeFacadeModule["removeGroundedShortTermCandidates"] =
  ((...args) =>
    loadRuntimeFacadeModule().removeGroundedShortTermCandidates(
      ...args,
    )) as RuntimeFacadeModule["removeGroundedShortTermCandidates"];
