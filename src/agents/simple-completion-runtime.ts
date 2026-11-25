import {
  complete,
  completeSimple,
  type Api,
  type Model,
  type OpenAICompletionsCompat,
} from "@earendil-works/pi-ai";
import type { KaijiBotConfig } from "../config/config.js";
import { formatErrorMessage } from "../infra/errors.js";
import { resolveAgentDir, resolveAgentEffectiveModelPrimary } from "./agent-scope.js";
import { DEFAULT_PROVIDER } from "./defaults.js";
import {
  applyLocalNoAuthHeaderOverride,
  getApiKeyForModel,
  type ResolvedProviderAuth,
} from "./model-auth.js";
import { splitTrailingAuthProfile } from "./model-ref-profile.js";
import {
  buildModelAliasIndex,
  resolveDefaultModelForAgent,
  resolveModelRefFromString,
} from "./model-selection.js";
import { detectOpenAICompletionsCompat } from "./openai-completions-compat.js";
import { resolveModel } from "./pi-embedded-runner/model.js";

type SimpleCompletionAuthStorage = {
  setRuntimeApiKey: (provider: string, apiKey: string) => void;
};

type CompletionRuntimeCredential = {
  apiKey: string;
  baseUrl?: string;
};

type AllowedMissingApiKeyMode = ResolvedProviderAuth["mode"];

export type SimpleCompletionModelOptions = {
  maxTokens?: number;
  signal?: AbortSignal;
};

export type PreparedSimpleCompletionModel =
  | {
      model: Model<Api>;
      auth: ResolvedProviderAuth;
    }
  | {
      error: string;
      auth?: ResolvedProviderAuth;
    };

export type AgentSimpleCompletionSelection = {
  provider: string;
  modelId: string;
  profileId?: string;
  agentDir: string;
};

export type PreparedSimpleCompletionModelForAgent =
  | {
      selection: AgentSimpleCompletionSelection;
      model: Model<Api>;
      auth: ResolvedProviderAuth;
    }
  | {
      error: string;
      selection?: AgentSimpleCompletionSelection;
      auth?: ResolvedProviderAuth;
    };

export function resolveSimpleCompletionSelectionForAgent(params: {
  cfg: KaijiBotConfig;
  agentId: string;
  modelRef?: string;
}): AgentSimpleCompletionSelection | null {
  const fallbackRef = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const modelRef =
    params.modelRef?.trim() || resolveAgentEffectiveModelPrimary(params.cfg, params.agentId);
  const split = modelRef ? splitTrailingAuthProfile(modelRef) : null;
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider: fallbackRef.provider || DEFAULT_PROVIDER,
  });
  const resolved = split
    ? resolveModelRefFromString({
        raw: split.model,
        defaultProvider: fallbackRef.provider || DEFAULT_PROVIDER,
        aliasIndex,
      })
    : null;
  const provider = resolved?.ref.provider ?? fallbackRef.provider;
  const modelId = resolved?.ref.model ?? fallbackRef.model;
  if (!provider || !modelId) {
    return null;
  }
  return {
    provider,
    modelId,
    profileId: split?.profile || undefined,
    agentDir: resolveAgentDir(params.cfg, params.agentId),
  };
}

async function setRuntimeApiKeyForCompletion(params: {
  authStorage: SimpleCompletionAuthStorage;
  model: Model<Api>;
  apiKey: string;
}): Promise<CompletionRuntimeCredential> {
  if (params.model.provider === "github-copilot") {
    const { resolveCopilotApiToken } = await import("./github-copilot-token.js");
    const copilotToken = await resolveCopilotApiToken({
      githubToken: params.apiKey,
    });
    params.authStorage.setRuntimeApiKey(params.model.provider, copilotToken.token);
    return {
      apiKey: copilotToken.token,
      baseUrl: copilotToken.baseUrl,
    };
  }
  params.authStorage.setRuntimeApiKey(params.model.provider, params.apiKey);
  return {
    apiKey: params.apiKey,
  };
}

function hasMissingApiKeyAllowance(params: {
  mode: ResolvedProviderAuth["mode"];
  allowMissingApiKeyModes?: ReadonlyArray<AllowedMissingApiKeyMode>;
}): boolean {
  return Boolean(params.allowMissingApiKeyModes?.includes(params.mode));
}

/**
 * The model background single-turn calls run on.
 *
 * These calls pass no reasoning option, which pi-ai turns into
 * `thinking: { type: "disabled" }` for a zai-format model. A model that cannot
 * turn thinking off names the effort to send instead in `thinkingLevelMap.off`,
 * but a zai-format request carries no effort, so the prepared model asks for it
 * OpenAI-style. The agent loop keeps the model as resolved.
 */
export function forBackgroundCompletion(model: Model<Api>): Model<Api> {
  if (typeof model.thinkingLevelMap?.off !== "string" || model.api !== "openai-completions") {
    return model;
  }
  // Model["compat"] is a union across APIs; the model is a completions one here.
  const compat = model.compat as OpenAICompletionsCompat | undefined;
  const thinkingFormat =
    compat?.thinkingFormat ?? detectOpenAICompletionsCompat(model).defaults.thinkingFormat;
  if (thinkingFormat !== "zai") {
    return model;
  }
  return {
    ...model,
    compat: { ...compat, thinkingFormat: "openai", supportsReasoningEffort: true },
  };
}

/**
 * The request `complete` sends for a background call, without the streaming fields.
 *
 * pi-ai assembles that request inside its transport from the prepared model: which
 * field carries the token cap, whether thinking is switched off, and which effort
 * replaces it. The batch API takes the same request in a file, so the body is read
 * from the transport instead of being assembled a second time here. The transport
 * hands the body to `onPayload` before it opens the request, and the aborted signal
 * keeps the request from leaving. The key only has to be non-empty.
 */
export async function backgroundRequestBody(params: {
  model: Model<Api>;
  prompt: string;
  maxTokens: number;
  apiKey: string;
}): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | undefined;
  await completeSimple(
    params.model,
    { messages: [{ role: "user", content: params.prompt, timestamp: Date.now() }] },
    {
      apiKey: params.apiKey,
      maxTokens: params.maxTokens,
      signal: AbortSignal.abort(),
      onPayload: (payload) => {
        captured = payload as Record<string, unknown>;
      },
    },
  );
  if (!captured) {
    throw new Error(`The ${params.model.provider} transport built no request for the batch call`);
  }
  const body = { ...captured };
  delete body.stream;
  delete body.stream_options;
  return body;
}

export async function prepareSimpleCompletionModel(params: {
  cfg: KaijiBotConfig | undefined;
  provider: string;
  modelId: string;
  agentDir?: string;
  profileId?: string;
  preferredProfile?: string;
  allowMissingApiKeyModes?: ReadonlyArray<AllowedMissingApiKeyMode>;
}): Promise<PreparedSimpleCompletionModel> {
  const resolved = resolveModel(params.provider, params.modelId, params.agentDir, params.cfg);
  if (!resolved.model) {
    return {
      error: resolved.error ?? `Unknown model: ${params.provider}/${params.modelId}`,
    };
  }

  let auth: ResolvedProviderAuth;
  try {
    auth = await getApiKeyForModel({
      model: resolved.model,
      cfg: params.cfg,
      agentDir: params.agentDir,
      profileId: params.profileId,
      preferredProfile: params.preferredProfile,
    });
  } catch (err) {
    return {
      error: `Auth lookup failed for provider "${resolved.model.provider}": ${formatErrorMessage(err)}`,
    };
  }
  const rawApiKey = auth.apiKey?.trim();
  if (
    !rawApiKey &&
    !hasMissingApiKeyAllowance({
      mode: auth.mode,
      allowMissingApiKeyModes: params.allowMissingApiKeyModes,
    })
  ) {
    return {
      error: `No API key resolved for provider "${resolved.model.provider}" (auth mode: ${auth.mode}).`,
      auth,
    };
  }

  let resolvedApiKey = rawApiKey;
  let resolvedModel = resolved.model;
  if (rawApiKey) {
    const runtimeCredential = await setRuntimeApiKeyForCompletion({
      authStorage: resolved.authStorage,
      model: resolved.model,
      apiKey: rawApiKey,
    });
    resolvedApiKey = runtimeCredential.apiKey;
    const runtimeBaseUrl = runtimeCredential.baseUrl?.trim();
    if (runtimeBaseUrl) {
      resolvedModel = {
        ...resolvedModel,
        baseUrl: runtimeBaseUrl,
      };
    }
  }

  const resolvedAuth: ResolvedProviderAuth = {
    ...auth,
    apiKey: resolvedApiKey,
  };

  return {
    model: applyLocalNoAuthHeaderOverride(forBackgroundCompletion(resolvedModel), resolvedAuth),
    auth: resolvedAuth,
  };
}

export async function prepareSimpleCompletionModelForAgent(params: {
  cfg: KaijiBotConfig;
  agentId: string;
  modelRef?: string;
  preferredProfile?: string;
  allowMissingApiKeyModes?: ReadonlyArray<AllowedMissingApiKeyMode>;
}): Promise<PreparedSimpleCompletionModelForAgent> {
  const selection = resolveSimpleCompletionSelectionForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
    modelRef: params.modelRef,
  });
  if (!selection) {
    return {
      error: `No model configured for agent ${params.agentId}.`,
    };
  }
  const prepared = await prepareSimpleCompletionModel({
    cfg: params.cfg,
    provider: selection.provider,
    modelId: selection.modelId,
    agentDir: selection.agentDir,
    profileId: selection.profileId,
    preferredProfile: params.preferredProfile,
    allowMissingApiKeyModes: params.allowMissingApiKeyModes,
  });
  if ("error" in prepared) {
    return {
      ...prepared,
      selection,
    };
  }
  return {
    selection,
    model: prepared.model,
    auth: prepared.auth,
  };
}

export async function completeWithPreparedSimpleCompletionModel(params: {
  model: Model<Api>;
  auth: ResolvedProviderAuth;
  context: Parameters<typeof complete>[1];
  options?: SimpleCompletionModelOptions;
}) {
  return await complete(params.model, params.context, {
    ...params.options,
    apiKey: params.auth.apiKey,
  });
}
