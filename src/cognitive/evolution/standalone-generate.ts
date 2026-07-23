import { randomUUID } from "node:crypto";
import { completeSimple, type Api, type Model, type TextContent } from "@earendil-works/pi-ai";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import { prepareSimpleCompletionModel } from "../../agents/simple-completion-runtime.js";
import type { KaijiBotConfig } from "../../config/types.kaijibot.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/evolution/standalone-generate");

export type StandaloneGenerateTextFn = (prompt: string) => Promise<string>;

export type StandaloneGenerateOptions = {
  maxTokens?: number;
  timeout?: number;
  modelRef?: string;
};

export type BatchGenerateOptions = StandaloneGenerateOptions & {
  /** Interval between batch status polls (ms). Default: 30000. */
  pollIntervalMs?: number;
  /** Max wall-clock time to wait for a batch to finish (ms). Default: 24h. */
  batchTimeoutMs?: number;
};

function isTextBlock(block: { type: string }): block is TextContent {
  return block.type === "text";
}

function isBackgroundBatchEnabled(cfg: KaijiBotConfig): boolean {
  return cfg.agents?.defaults?.backgroundBatch === true;
}

export async function createStandaloneGenerateText(
  cfg: KaijiBotConfig,
  options?: StandaloneGenerateOptions,
): Promise<StandaloneGenerateTextFn> {
  let provider: string;
  let modelId: string;
  if (options?.modelRef && options.modelRef.includes("/")) {
    const slashIdx = options.modelRef.indexOf("/");
    provider = options.modelRef.slice(0, slashIdx);
    modelId = options.modelRef.slice(slashIdx + 1);
  } else {
    const resolved = resolveDefaultModelForAgent({ cfg });
    provider = resolved.provider;
    modelId = resolved.model;
  }
  const prepared = await prepareSimpleCompletionModel({
    cfg,
    provider,
    modelId,
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
    return result.content
      .filter(isTextBlock)
      .map((b) => b.text)
      .join("")
      .trim();
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
  options?: StandaloneGenerateOptions,
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
      return result.content
        .filter(isTextBlock)
        .map((b) => b.text)
        .join("")
        .trim();
    };
  };
}

// ---------------------------------------------------------------------------
// Batch API variant (OpenAI-compatible /v1/batch). Opt-in via
// agents.defaults.backgroundBatch. Each call submits a single-request batch,
// polls until terminal, and returns the assistant text.
// ---------------------------------------------------------------------------

const TERMINAL_BATCH_STATUSES = new Set(["completed", "failed", "expired", "cancelled"]);

export type BatchHttpDeps = {
  fetchFn: typeof fetch;
};

/**
 * Build the auth+headers for a prepared model/auth pair, suitable for the
 * OpenAI-compatible batch endpoints. Uses a Bearer token and any model-level
 * header overrides.
 */
function buildBatchHeaders(model: Model<Api>, auth: ResolvedProviderAuth): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.apiKey}`,
    "Content-Type": "application/json",
  };
  if (model.headers) {
    for (const [key, value] of Object.entries(model.headers)) {
      headers[key] = value;
    }
  }
  return headers;
}

function extractBatchText(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new Error(`Batch result had unexpected body shape`);
  }
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error(`Batch result had no choices`);
  }
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (b): b is { type: string; text: string } =>
          typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
      )
      .map((b) => b.text ?? "")
      .join("")
      .trim();
  }
  throw new Error(`Batch result choice had no message.content`);
}

/**
 * Submit one prompt to the provider's OpenAI-compatible batch API and poll
 * until it completes, returning the assistant text. Throws on any error,
 * non-completed terminal status, or timeout.
 */
export async function runBatchGenerate(params: {
  model: Model<Api>;
  auth: ResolvedProviderAuth;
  prompt: string;
  maxTokens: number;
  requestTimeoutMs: number;
  pollIntervalMs: number;
  batchTimeoutMs: number;
  deps: BatchHttpDeps;
}): Promise<string> {
  const { model, auth, prompt, maxTokens, requestTimeoutMs, pollIntervalMs, batchTimeoutMs, deps } =
    params;

  const base = model.baseUrl.replace(/\/+$/, "");
  const headers = buildBatchHeaders(model, auth);
  const customId = `req-${randomUUID()}`;

  const submitBody = {
    input: [
      {
        custom_id: customId,
        method: "post",
        url: "/v1/chat/completions",
        body: {
          model: model.id,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
        },
      },
    ],
    endpoint: "/v1/chat/completions",
    completion_window: "24h",
  };

  const submitRes = await deps.fetchFn(`${base}/batch`, {
    method: "POST",
    headers,
    body: JSON.stringify(submitBody),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!submitRes.ok) {
    const detail = await submitRes.text().catch(() => "");
    throw new Error(`Batch submit failed (${submitRes.status}): ${detail.slice(0, 500)}`);
  }
  const batch = (await submitRes.json()) as {
    id?: string;
    status?: string;
    output_file_id?: string;
    errors?: { data?: Array<{ message?: string }> };
  };
  const batchId = batch.id;
  if (!batchId) {
    throw new Error(`Batch submit returned no id: ${JSON.stringify(batch).slice(0, 500)}`);
  }
  log.debug("Batch submitted", { batchId, initialStatus: batch.status });

  let status: string = batch.status ?? "validating";
  let outputObjectId: string | undefined = batch.output_file_id;
  const deadline = Date.now() + batchTimeoutMs;

  while (!TERMINAL_BATCH_STATUSES.has(status)) {
    if (Date.now() >= deadline) {
      throw new Error(`Batch ${batchId} timed out waiting for completion (status=${status})`);
    }
    await sleep(pollIntervalMs);

    const pollRes = await deps.fetchFn(`${base}/batches/${batchId}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!pollRes.ok) {
      const detail = await pollRes.text().catch(() => "");
      throw new Error(`Batch poll failed (${pollRes.status}): ${detail.slice(0, 500)}`);
    }
    const polled = (await pollRes.json()) as {
      status?: string;
      output_file_id?: string;
      errors?: { data?: Array<{ message?: string }> };
    };
    status = polled.status ?? status;
    if (status === "completed") {
      outputObjectId = polled.output_file_id;
    } else if (status === "failed" && polled.errors?.data?.length) {
      const msgs = polled.errors.data.map((e) => e.message ?? "unknown").join("; ");
      throw new Error(`Batch ${batchId} failed: ${msgs}`);
    }
  }

  if (status !== "completed") {
    throw new Error(`Batch ${batchId} ended with status=${status}`);
  }
  if (!outputObjectId) {
    throw new Error(`Batch ${batchId} completed but returned no output file id`);
  }

  const resultRes = await deps.fetchFn(`${base}/files/${outputObjectId}/content`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!resultRes.ok) {
    const detail = await resultRes.text().catch(() => "");
    throw new Error(`Batch results fetch failed (${resultRes.status}): ${detail.slice(0, 500)}`);
  }
  const resultsText = await resultRes.text();

  for (const line of resultsText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let entry: {
      custom_id?: string;
      response?: { status_code?: number; body?: unknown };
      error?: { message?: string } | string | null;
    };
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (entry.custom_id !== customId) {
      continue;
    }
    if (entry.error) {
      const msg =
        typeof entry.error === "string" ? entry.error : (entry.error.message ?? "unknown");
      throw new Error(`Batch request error for ${customId}: ${msg}`);
    }
    if (entry.response?.status_code && entry.response.status_code >= 400) {
      throw new Error(`Batch request ${customId} failed upstream (${entry.response.status_code})`);
    }
    return extractBatchText(entry.response?.body);
  }
  throw new Error(`Batch results missing entry for custom_id=${customId}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createStandaloneGenerateTextBatch(
  cfg: KaijiBotConfig,
  options?: BatchGenerateOptions,
): Promise<StandaloneGenerateTextFn> {
  const resolved = resolveDefaultModelForAgent({ cfg });
  const prepared = await prepareSimpleCompletionModel({
    cfg,
    provider: resolved.provider,
    modelId: resolved.model,
  });
  if ("error" in prepared) {
    throw new Error(`Cannot create standalone batch generateText: ${prepared.error}`);
  }
  const { model, auth } = prepared;
  const maxTokens = options?.maxTokens ?? 4000;
  const requestTimeoutMs = options?.timeout ?? 60_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 30_000;
  const batchTimeoutMs = options?.batchTimeoutMs ?? 24 * 60 * 60 * 1000;
  const deps: BatchHttpDeps = { fetchFn: globalThis.fetch };

  return async (prompt: string): Promise<string> => {
    return runBatchGenerate({
      model,
      auth,
      prompt,
      maxTokens,
      requestTimeoutMs,
      pollIntervalMs,
      batchTimeoutMs,
      deps,
    });
  };
}

export type BackgroundGenerateDeps = {
  sync: StandaloneGenerateDeps;
  batch: StandaloneGenerateDeps & {
    run: typeof runBatchGenerate;
    http: BatchHttpDeps;
  };
};

export function createStandaloneGenerateTextBatchWithDeps(
  deps: BackgroundGenerateDeps,
  options?: BatchGenerateOptions,
): (cfg: KaijiBotConfig) => Promise<StandaloneGenerateTextFn> {
  const maxTokens = options?.maxTokens ?? 4000;
  const requestTimeoutMs = options?.timeout ?? 60_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 30_000;
  const batchTimeoutMs = options?.batchTimeoutMs ?? 24 * 60 * 60 * 1000;

  return async (cfg: KaijiBotConfig): Promise<StandaloneGenerateTextFn> => {
    const prepared = await deps.batch.prepareModel(cfg);
    if ("error" in prepared) {
      throw new Error(`Cannot create standalone batch generateText: ${prepared.error}`);
    }
    const { model, auth } = prepared;

    return async (prompt: string): Promise<string> => {
      return deps.batch.run({
        model,
        auth,
        prompt,
        maxTokens,
        requestTimeoutMs,
        pollIntervalMs,
        batchTimeoutMs,
        deps: deps.batch.http,
      });
    };
  };
}

/**
 * Background pipeline dispatcher. Picks the batch variant when
 * `agents.defaults.backgroundBatch` is enabled, otherwise the synchronous
 * variant. Used by memory consolidation, correction extraction, and session
 * summary — all non-latency-sensitive single-turn LLM callers.
 */
export async function createBackgroundGenerateText(
  cfg: KaijiBotConfig,
  options?: StandaloneGenerateOptions,
): Promise<StandaloneGenerateTextFn> {
  if (isBackgroundBatchEnabled(cfg)) {
    log.info("background batch enabled; routing background LLM calls through batch API");
    return createStandaloneGenerateTextBatch(cfg, options);
  }
  return createStandaloneGenerateText(cfg, options);
}
