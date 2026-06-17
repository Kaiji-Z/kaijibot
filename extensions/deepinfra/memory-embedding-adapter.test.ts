import { describe, expect, it } from "vitest";
import { DEFAULT_DEEPINFRA_EMBEDDING_MODEL } from "./embedding-provider.js";
import { deepinfraMemoryEmbeddingProviderAdapter } from "./memory-embedding-adapter.js";

describe("deepinfra memory embedding adapter", () => {
  it("declares a remote auth-backed embedding provider", () => {
    // `authProviderId` is set by the adapter at runtime but is not part of the
    // typed `MemoryEmbeddingProviderAdapter` contract; access it via a record.
    const adapter = deepinfraMemoryEmbeddingProviderAdapter as Record<string, unknown>;
    expect(Object.keys(deepinfraMemoryEmbeddingProviderAdapter)).toEqual([
      "id",
      "defaultModel",
      "transport",
      "authProviderId",
      "autoSelectPriority",
      "allowExplicitWhenConfiguredAuto",
      "shouldContinueAutoSelection",
      "create",
    ]);
    expect(deepinfraMemoryEmbeddingProviderAdapter.id).toBe("deepinfra");
    expect(deepinfraMemoryEmbeddingProviderAdapter.defaultModel).toBe(
      DEFAULT_DEEPINFRA_EMBEDDING_MODEL,
    );
    expect(deepinfraMemoryEmbeddingProviderAdapter.transport).toBe("remote");
    expect(adapter.authProviderId).toBe("deepinfra");
    expect(deepinfraMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(55);
    expect(deepinfraMemoryEmbeddingProviderAdapter.allowExplicitWhenConfiguredAuto).toBe(true);
    // `shouldContinueAutoSelection` resolves to a provider-local error guard that
    // is not part of the public SDK contract; verify it is wired as a function.
    expect(deepinfraMemoryEmbeddingProviderAdapter.shouldContinueAutoSelection).toBeTypeOf(
      "function",
    );
    expect(deepinfraMemoryEmbeddingProviderAdapter.create).toBeTypeOf("function");
  });
});
