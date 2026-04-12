// Defaults for agent metadata when upstream does not supply them.
// KaijiBot Simplify: Z.AI (智谱 GLM) as default provider.
export const DEFAULT_PROVIDER = "zai";
export const DEFAULT_MODEL = "glm-5-turbo";
// Conservative fallback used when model metadata is unavailable.
export const DEFAULT_CONTEXT_TOKENS = 200_000;
