// Defaults for agent metadata when upstream does not supply them.

/**
 * No longer bound to a specific vendor. Kept as an empty string for SDK
 * backwards compatibility (`kaijibot/plugin-sdk/agent-runtime` re-exports it).
 *
 * In practice this value is rarely reached at runtime:
 * - Alias resolution falls back to `inferUniqueProviderFromConfiguredModels`
 *   when the operator writes a bare model id without a `provider/` prefix.
 * - `resolveConfiguredProviderFallback` walks all configured providers and
 *   returns the first one with a usable model — it no longer short-circuits
 *   on a hardcoded "default provider" key.
 * - The final fallback in `resolveConfiguredModelRef` throws
 *   {@link MissingAgentModelConfigError} rather than silently producing a
 *   partial ref like `"/"` or `"zai/"`.
 *
 * Operators set their provider/model via `agents.defaults.model.primary` in
 * `kaijibot.json` or through `kaijibot onboard`.
 */
export const DEFAULT_PROVIDER = "";

/**
 * No longer bound to a specific vendor model. Kept as an empty string for SDK
 * backwards compatibility (`kaijibot/plugin-sdk/agent-runtime` re-exports it).
 *
 * See {@link DEFAULT_PROVIDER} for the resolution strategy when this value
 * is empty.
 */
export const DEFAULT_MODEL = "";

// Conservative fallback used when model metadata is unavailable.
export const DEFAULT_CONTEXT_TOKENS = 200_000;

/**
 * Thrown when an inference path needs a concrete model but none is configured.
 * Replaces the legacy behavior of silently falling back to a hardcoded vendor id.
 */
export class MissingAgentModelConfigError extends Error {
  constructor(public readonly context?: string) {
    const ctx = context ? ` (context: ${context})` : "";
    super(
      `No agent model is configured. Set \`agents.defaults.model.primary\` in kaijibot.json ` +
        `or run \`kaijibot onboard\` to choose a provider/model.${ctx}`,
    );
    this.name = "MissingAgentModelConfigError";
  }
}
