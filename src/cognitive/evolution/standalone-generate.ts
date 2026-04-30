import { completeSimple, type Api, type Model, type TextContent } from "@mariozechner/pi-ai";
import type { KaijiBotConfig } from "../../config/types.kaijibot.js";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import { prepareSimpleCompletionModel } from "../../agents/simple-completion-runtime.js";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";

export type StandaloneGenerateTextFn = (prompt: string) => Promise<string>;

function isTextBlock(block: { type: string }): block is TextContent {
  return block.type === "text";
}

export async function createStandaloneGenerateText(
  cfg: KaijiBotConfig,
  options?: { maxTokens?: number; timeout?: number },
): Promise<StandaloneGenerateTextFn> {
  const resolved = resolveDefaultModelForAgent({ cfg });
  const prepared = await prepareSimpleCompletionModel({
    cfg,
    provider: resolved.provider,
    modelId: resolved.model,
  });
  if ("error" in prepared) {
    throw new Error(`Cannot create standalone generateText: ${prepared.error}`);
  }
  const { model, auth } = prepared;
  const maxTokens = options?.maxTokens ?? 4000;
  const timeout = options?.timeout ?? 60_000;

  return async (prompt: string): Promise<string> => {
    const result = await completeSimple(
      model,
        { messages: [{ role: "user" as const, content: prompt, timestamp: Date.now() }] },
      {
        apiKey: auth.apiKey,
        maxTokens,
        signal: AbortSignal.timeout(timeout),
      },
    );
    return result.content.filter(isTextBlock).map((b) => b.text).join("").trim();
  };
}

export type StandaloneGenerateDeps = {
  complete: typeof completeSimple;
  prepareModel: (
    cfg: KaijiBotConfig,
  ) => Promise<{ model: Model<Api>; auth: ResolvedProviderAuth } | { error: string }>;
};

export function createStandaloneGenerateTextWithDeps(
  deps: StandaloneGenerateDeps,
  options?: { maxTokens?: number; timeout?: number },
): (cfg: KaijiBotConfig) => Promise<StandaloneGenerateTextFn> {
  const maxTokens = options?.maxTokens ?? 4000;
  const timeout = options?.timeout ?? 60_000;

  return async (cfg: KaijiBotConfig): Promise<StandaloneGenerateTextFn> => {
    const prepared = await deps.prepareModel(cfg);
    if ("error" in prepared) {
      throw new Error(`Cannot create standalone generateText: ${prepared.error}`);
    }
    const { model, auth } = prepared;

    return async (prompt: string): Promise<string> => {
      const result = await deps.complete(
        model,
      { messages: [{ role: "user" as const, content: prompt, timestamp: Date.now() }] },
        {
          apiKey: auth.apiKey,
          maxTokens,
          signal: AbortSignal.timeout(timeout),
        },
      );
      return result.content.filter(isTextBlock).map((b) => b.text).join("").trim();
    };
  };
}
