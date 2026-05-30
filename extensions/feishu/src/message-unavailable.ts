/**
 * Message unavailability detection and guard for the KaijiBot feishu extension.
 *
 * When the Lark API returns terminal error codes (230011 = message recalled,
 * 231003 = message deleted), we mark the message_id as unavailable so that
 * subsequent API calls targeting the same message short-circuit immediately.
 *
 * Merged from openclaw-lark's message-unavailable.ts + unavailable-guard.ts.
 */

// ---------------------------------------------------------------------------
// Terminal error codes
// ---------------------------------------------------------------------------

/** Lark API codes that indicate a message is permanently unavailable. */
export const MESSAGE_TERMINAL_CODES: ReadonlySet<number> = new Set([230011, 231003]);

/** Union type for the two terminal codes. */
export type TerminalMessageApiCode = 230011 | 231003;

// ---------------------------------------------------------------------------
// Message-id normalization
// ---------------------------------------------------------------------------

/** Strip whitespace; return undefined when empty. */
export function normalizeMessageId(id: string | undefined): string | undefined {
  if (id == null) return undefined;
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Re-export extractLarkApiCode from card-error.ts (handles all 3 error shapes
// including Axios-style response.data.code). Avoid duplicating the implementation.
export { extractLarkApiCode } from './card-error.js';
import { extractLarkApiCode } from './card-error.js';

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

export function isTerminalMessageApiCode(code: unknown): code is TerminalMessageApiCode {
  return typeof code === 'number' && MESSAGE_TERMINAL_CODES.has(code);
}

// ---------------------------------------------------------------------------
// Cache — module-level, with TTL and size pruning
// ---------------------------------------------------------------------------

export interface MessageUnavailableState {
  apiCode: TerminalMessageApiCode;
  markedAtMs: number;
  operation?: string;
}

const UNAVAILABLE_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_SIZE_BEFORE_PRUNE = 512;

const unavailableMessageCache = new Map<string, MessageUnavailableState>();

function pruneExpired(nowMs = Date.now()): void {
  for (const [mid, state] of unavailableMessageCache) {
    if (nowMs - state.markedAtMs > UNAVAILABLE_CACHE_TTL_MS) {
      unavailableMessageCache.delete(mid);
    }
  }
}

/** Clear the entire cache. Exported for test use only. */
export function resetUnavailableCache(): void {
  unavailableMessageCache.clear();
}

// ---------------------------------------------------------------------------
// Cache write / read helpers
// ---------------------------------------------------------------------------

export function markMessageUnavailable(params: {
  messageId: string;
  apiCode: TerminalMessageApiCode;
  operation?: string;
}): void {
  const normalizedId = normalizeMessageId(params.messageId);
  if (!normalizedId) return;

  if (unavailableMessageCache.size >= MAX_CACHE_SIZE_BEFORE_PRUNE) {
    pruneExpired();
  }

  unavailableMessageCache.set(normalizedId, {
    apiCode: params.apiCode,
    operation: params.operation,
    markedAtMs: Date.now(),
  });
}

export function getMessageUnavailableState(
  messageId: string | undefined,
): MessageUnavailableState | undefined {
  const normalizedId = normalizeMessageId(messageId);
  if (!normalizedId) return undefined;

  const state = unavailableMessageCache.get(normalizedId);
  if (!state) return undefined;

  if (Date.now() - state.markedAtMs > UNAVAILABLE_CACHE_TTL_MS) {
    unavailableMessageCache.delete(normalizedId);
    return undefined;
  }

  return state;
}

export function isMessageUnavailable(messageId: string | undefined): boolean {
  return !!getMessageUnavailableState(messageId);
}

export function markMessageUnavailableFromError(params: {
  messageId: string | undefined;
  error: unknown;
  operation?: string;
}): TerminalMessageApiCode | undefined {
  const normalizedId = normalizeMessageId(params.messageId);
  if (!normalizedId) return undefined;

  const code = extractLarkApiCode(params.error);
  if (!isTerminalMessageApiCode(code)) return undefined;

  markMessageUnavailable({
    messageId: normalizedId,
    apiCode: code,
    operation: params.operation,
  });
  return code;
}

// ---------------------------------------------------------------------------
// MessageUnavailableError
// ---------------------------------------------------------------------------

export class MessageUnavailableError extends Error {
  readonly messageId: string;
  readonly apiCode: TerminalMessageApiCode;
  readonly operation?: string;

  constructor(params: { messageId: string; apiCode: TerminalMessageApiCode; operation?: string }) {
    const operationText = params.operation ? `, op=${params.operation}` : '';
    super(
      `[feishu-message-unavailable] message ${params.messageId} unavailable (code=${params.apiCode}${operationText})`,
    );
    this.name = 'MessageUnavailableError';
    this.messageId = params.messageId;
    this.apiCode = params.apiCode;
    this.operation = params.operation;
  }
}

export function isMessageUnavailableError(error: unknown): error is MessageUnavailableError {
  return (
    error instanceof MessageUnavailableError ||
    (typeof error === 'object' &&
      error != null &&
      (error as { name?: string }).name === 'MessageUnavailableError')
  );
}

// ---------------------------------------------------------------------------
// Assert helper
// ---------------------------------------------------------------------------

export function assertMessageAvailable(messageId: string | undefined, operation?: string): void {
  const normalizedId = normalizeMessageId(messageId);
  if (!normalizedId) return;

  const state = getMessageUnavailableState(normalizedId);
  if (!state) return;

  throw new MessageUnavailableError({
    messageId: normalizedId,
    apiCode: state.apiCode,
    operation: operation ?? state.operation,
  });
}

// ---------------------------------------------------------------------------
// runWithMessageUnavailableGuard
// ---------------------------------------------------------------------------

/**
 * Unified guard for message-scoped API calls:
 *  1. Pre-check — throws `MessageUnavailableError` if already marked.
 *  2. Executes `fn`.
 *  3. On error, inspects the error for terminal codes and marks the message.
 */
export async function runWithMessageUnavailableGuard<T>(params: {
  messageId: string | undefined;
  operation: string;
  fn: () => Promise<T>;
}): Promise<T> {
  const normalizedId = normalizeMessageId(params.messageId);
  if (!normalizedId) {
    return params.fn();
  }

  assertMessageAvailable(normalizedId, params.operation);

  try {
    return await params.fn();
  } catch (error) {
    const code = markMessageUnavailableFromError({
      messageId: normalizedId,
      error,
      operation: params.operation,
    });
    if (code) {
      throw new MessageUnavailableError({
        messageId: normalizedId,
        apiCode: code,
        operation: params.operation,
      });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// UnavailableGuard — stateful guard for reply pipelines
// ---------------------------------------------------------------------------

export interface UnavailableGuardParams {
  replyToMessageId: string | undefined;
  getCardMessageId: () => string | null;
  onTerminate: () => void;
}

export class UnavailableGuard {
  private terminated = false;

  private readonly replyToMessageId: string | undefined;
  private readonly getCardMessageId: () => string | null;
  private readonly onTerminate: () => void;

  constructor(params: UnavailableGuardParams) {
    this.replyToMessageId = params.replyToMessageId;
    this.getCardMessageId = params.getCardMessageId;
    this.onTerminate = params.onTerminate;
  }

  get isTerminated(): boolean {
    return this.terminated;
  }

  /**
   * Check whether the reply pipeline should skip further operations.
   * Returns `true` if the message is already known to be unavailable.
   */
  shouldSkip(source: string): boolean {
    if (this.terminated) return true;
    if (!this.replyToMessageId) return false;
    if (!isMessageUnavailable(this.replyToMessageId)) return false;
    return this.terminate(source);
  }

  /**
   * Attempt to terminate the reply pipeline due to an unavailable message.
   *
   * @param source - Descriptive label for the caller (for logging).
   * @param err    - Optional error that triggered the check.
   * @returns `true` if the pipeline was (or already had been) terminated.
   */
  terminate(source: string, err?: unknown): boolean {
    if (this.terminated) return true;

    const fromError = isMessageUnavailableError(err) ? err : undefined;
    const cardMessageId = this.getCardMessageId();
    const state =
      getMessageUnavailableState(this.replyToMessageId) ??
      getMessageUnavailableState(cardMessageId ?? undefined);
    let apiCode = fromError?.apiCode ?? state?.apiCode;

    if (!apiCode && err) {
      const detectedCode = extractLarkApiCode(err);
      if (isTerminalMessageApiCode(detectedCode)) {
        const fallbackMessageId = this.replyToMessageId ?? cardMessageId ?? undefined;
        if (fallbackMessageId) {
          markMessageUnavailable({
            messageId: fallbackMessageId,
            apiCode: detectedCode,
            operation: source,
          });
        }
        apiCode = detectedCode;
      }
    }
    if (!apiCode) return false;

    this.terminated = true;
    this.onTerminate();
    return true;
  }
}
