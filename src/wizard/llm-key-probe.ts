import type { WizardPrompter } from "./prompts.js";

/**
 * LLM provider API key validation probe.
 *
 * Mirrors the {@link probeFeishu} pattern: make a lightweight authenticated
 * request to a provider API and report whether the key is usable. Used by the
 * onboard wizard to catch typos before the user sends their first message.
 *
 * Design notes:
 * - For known providers, a minimal endpoint is hit (model list or a 1-token
 *   chat completion). Any 2xx response counts as success.
 * - Unknown providers are silently skipped ({@link ProbeResult.skipped}) so we
 *   never block a working setup just because we don't know how to probe it.
 * - All network and parsing errors are caught and returned as
 *   {@link ProbeResult.error}; the probe never throws.
 * - Each call is bounded by {@link ProbeLlmKeyOptions.timeoutMs} (default 5s)
 *   via {@link AbortController} so a hung provider can't stall the wizard.
 */

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Result of probing a provider API key. */
export type ProbeResult = {
  ok: boolean;
  /** Human-readable error message when {@link ok} is false. */
  error?: string;
  /** Set when the provider is unknown and the probe was deliberately skipped. */
  skipped?: boolean;
  /** Model identifier echoed by the provider, when available. */
  model?: string;
};

export type ProbeLlmKeyOptions = {
  /** Per-request timeout in milliseconds. Default: 5000. */
  timeoutMs?: number;
  /**
   * Optional fetch implementation. Defaults to the global {@link fetch}.
   * Injected by tests to avoid real network calls; production callers should
   * omit this.
   */
  fetchImpl?: FetchLike;
  /** Optional external abort signal. Combined with the internal timeout. */
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 5000;

/** Canonical provider id → list of aliases that should route to the same prober. */
const PROVIDER_ALIASES: Record<string, readonly string[]> = {
  zai: ["zai", "z_ai", "zai-glm", "glm", "bigmodel", "chatglm"],
  deepseek: ["deepseek"],
  anthropic: ["anthropic", "claude"],
  google: ["google", "gemini", "google-gemini-cli", "google_gemini"],
  qwen: ["qwen", "dashscope", "modelstudio", "alibaba", "tongyi", "qwencloud"],
};

/** Reverse lookup: alias (lowercase) → canonical provider id. */
const ALIAS_TO_CANONICAL: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(PROVIDER_ALIASES)) {
    map.set(canonical, canonical);
    for (const alias of aliases) {
      map.set(alias, canonical);
    }
  }
  return map;
})();

export function canonicalProviderId(provider: string): string | undefined {
  return ALIAS_TO_CANONICAL.get(provider.trim().toLowerCase());
}

function formatError(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return String(err);
}

function isAbortTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return (
    err.name === "AbortError" || err.name === "TimeoutError" || /timed?\s*out/i.test(err.message)
  );
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  if (isAbortTimeoutError(err)) {
    return false;
  }
  // Node's fetch throws TypeError on network failure ("fetch failed") or
  // DNS errors. Also match common phrasings.
  const msg = err.message.toLowerCase();
  return (
    err.name === "TypeError" ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset")
  );
}

/** Try to extract a helpful error message from a non-2xx response body. */
async function extractErrorMessage(response: Response, fallbackPrefix: string): Promise<string> {
  const status = response.status;
  const fallback = `${fallbackPrefix} (HTTP ${status})`;
  try {
    const text = await response.text();
    if (!text) {
      return fallback;
    }
    // Most provider errors are JSON with a `message` / `error.message` field.
    try {
      const parsed = JSON.parse(text) as unknown;
      const message = pickErrorMessage(parsed);
      if (message) {
        return `${fallbackPrefix}: ${message}`;
      }
    } catch {
      // Not JSON — use a trimmed snippet of raw text.
      const trimmed = text.trim().slice(0, 200);
      if (trimmed) {
        return `${fallbackPrefix}: ${trimmed}`;
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function pickErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }
  const errorField = record.error;
  if (typeof errorField === "string" && errorField.trim()) {
    return errorField.trim();
  }
  if (typeof errorField === "object" && errorField !== null) {
    const nested = (errorField as Record<string, unknown>).message;
    if (typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
  }
  const detail = record.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  return undefined;
}

function pickModelId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const fromModel = typeof record.model === "string" ? (record.model as string) : undefined;
  if (fromModel) {
    return fromModel;
  }
  const data = record.data;
  if (Array.isArray(data)) {
    const first = data[0];
    if (typeof first === "object" && first !== null) {
      const id = (first as Record<string, unknown>).id;
      if (typeof id === "string") {
        return id;
      }
    }
  }
  return undefined;
}

/** Combined abort signal: external + internal timeout. */
function createTimeoutAbortSignal(
  timeoutMs: number,
  external?: AbortSignal,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`probe timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener("abort", () => controller.abort(external.reason), {
        once: true,
      });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

// --- Per-provider probes ----------------------------------------------------

async function probeZai(apiKey: string, options: ProbeLlmKeyOptions): Promise<ProbeResult> {
  return await probeGetJson(
    "https://open.bigmodel.cn/api/paas/v4/models",
    {
      headers: { authorization: `Bearer ${apiKey}` },
    },
    { ...options, label: "ZAI" },
  );
}

async function probeDeepSeek(apiKey: string, options: ProbeLlmKeyOptions): Promise<ProbeResult> {
  return await probeGetJson(
    "https://api.deepseek.com/models",
    {
      headers: { authorization: `Bearer ${apiKey}` },
    },
    { ...options, label: "DeepSeek" },
  );
}

async function probeAnthropic(apiKey: string, options: ProbeLlmKeyOptions): Promise<ProbeResult> {
  // Anthropic requires x-api-key + anthropic-version. We hit /v1/messages with
  // a 1-token cap so the probe costs essentially nothing on success.
  const body = JSON.stringify({
    model: "claude-3-5-haiku-latest",
    max_tokens: 1,
    messages: [{ role: "user", content: "." }],
  });
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { signal, cleanup } = createTimeoutAbortSignal(timeoutMs, options.signal);
  try {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body,
      signal,
    });
    return await interpretResponse(response, "Anthropic API key rejected");
  } catch (err) {
    return errorFromFetchException(err);
  } finally {
    cleanup();
  }
}

async function probeGoogle(apiKey: string, options: ProbeLlmKeyOptions): Promise<ProbeResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  return await probeGetJson(url, {}, { ...options, label: "Google/Gemini" });
}

async function probeQwen(apiKey: string, options: ProbeLlmKeyOptions): Promise<ProbeResult> {
  // DashScope OpenAI-compatible /v1/models endpoint.
  return await probeGetJson(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
    {
      headers: { authorization: `Bearer ${apiKey}` },
    },
    { ...options, label: "Qwen/DashScope" },
  );
}

// --- Generic helpers --------------------------------------------------------

async function probeGetJson(
  url: string,
  init: RequestInit,
  params: ProbeLlmKeyOptions & { label: string },
): Promise<ProbeResult> {
  const fetchImpl = params.fetchImpl ?? (globalThis.fetch as FetchLike);
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { signal, cleanup } = createTimeoutAbortSignal(timeoutMs, params.signal);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal,
    });
    return await interpretResponse(response, `${params.label} API key rejected`);
  } catch (err) {
    return errorFromFetchException(err);
  } finally {
    cleanup();
  }
}

async function interpretResponse(
  response: Response,
  rejectionPrefix: string,
): Promise<ProbeResult> {
  if (response.status >= 200 && response.status < 300) {
    return { ok: true, model: await tryReadModelId(response) };
  }
  const error = await extractErrorMessage(response, rejectionPrefix);
  return { ok: false, error };
}

async function tryReadModelId(response: Response): Promise<string | undefined> {
  try {
    const cloned = response.clone();
    const parsed = (await cloned.json()) as unknown;
    return pickModelId(parsed);
  } catch {
    return undefined;
  }
}

function errorFromFetchException(err: unknown): ProbeResult {
  if (isAbortTimeoutError(err)) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "probe timed out",
    };
  }
  if (isNetworkError(err)) {
    return {
      ok: false,
      error: `network error: ${formatError(err)}`,
    };
  }
  return { ok: false, error: formatError(err) };
}

// --- Public entry point ------------------------------------------------------

/**
 * Probe an LLM provider API key by making a minimal authenticated request.
 *
 * - Returns {@link ProbeResult.ok} true on success.
 * - Returns {@link ProbeResult.skipped} true (with {@link ProbeResult.ok} true)
 *   when the provider is not one we know how to probe — callers should treat
 *   this as a non-blocking pass.
 * - Never throws: all failures surface as {@link ProbeResult.ok} false with a
 *   populated {@link ProbeResult.error}.
 */
export async function probeLlmKey(
  provider: string,
  apiKey: string,
  options: ProbeLlmKeyOptions = {},
): Promise<ProbeResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { ok: false, error: "API key is empty" };
  }

  const canonical = canonicalProviderId(provider);
  if (!canonical) {
    return { ok: true, skipped: true };
  }

  switch (canonical) {
    case "zai":
      return await probeZai(trimmedKey, options);
    case "deepseek":
      return await probeDeepSeek(trimmedKey, options);
    case "anthropic":
      return await probeAnthropic(trimmedKey, options);
    case "google":
      return await probeGoogle(trimmedKey, options);
    case "qwen":
      return await probeQwen(trimmedKey, options);
    default:
      return { ok: true, skipped: true };
  }
}

/**
 * Ergonomic wrapper for wizard integration: probe a key and surface a
 * {@link WizardPrompter.note} warning when validation fails. Never throws and
 * never blocks the wizard — the warning is informational only.
 *
 * - Known-good key → silent (no note).
 * - Unknown provider ({@link ProbeResult.skipped}) → silent.
 * - Invalid key or network error → single warning note.
 *
 * Returns the underlying {@link ProbeResult} so callers can branch further
 * (e.g. offer a retry loop) if they want to.
 */
export async function probeLlmKeyAndWarn(
  provider: string,
  apiKey: string,
  prompter: Pick<WizardPrompter, "note">,
  options: ProbeLlmKeyOptions = {},
): Promise<ProbeResult> {
  const result = await probeLlmKey(provider, apiKey, options);
  if (!result.ok && !result.skipped) {
    const detail = result.error ?? "unknown error";
    try {
      await prompter.note(
        [
          `⚠ API key validation failed: ${detail}`,
          "The key was still saved — the bot may fail to respond until it's corrected.",
        ].join("\n"),
        "API Key Check",
      );
    } catch {
      // The wizard prompter should never throw on note(); ignore if it does.
    }
  }
  return result;
}
