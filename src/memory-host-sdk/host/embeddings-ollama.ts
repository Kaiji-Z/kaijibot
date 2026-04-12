// [fork-removed] ollama-runtime.js removed with Ollama extension — graceful stubs

export type OllamaEmbeddingClient = Record<string, never>;

export const DEFAULT_OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";

export async function createOllamaEmbeddingProvider(
  _options: unknown,
): Promise<{ provider: never; client: OllamaEmbeddingClient }> {
  throw new Error("[fork-removed] Ollama embedding provider is not available in this build");
}