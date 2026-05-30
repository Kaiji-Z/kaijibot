import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MESSAGE_TERMINAL_CODES,
  type MessageUnavailableState,
  MessageUnavailableError,
  UnavailableGuard,
  assertMessageAvailable,
  extractLarkApiCode,
  getMessageUnavailableState,
  isMessageUnavailable,
  isMessageUnavailableError,
  isTerminalMessageApiCode,
  markMessageUnavailable,
  markMessageUnavailableFromError,
  normalizeMessageId,
  resetUnavailableCache,
  runWithMessageUnavailableGuard,
} from './message-unavailable.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLarkError(code: number): { code: number } {
  return { code };
}

function makeNestedLarkError(code: number): { data: { code: number } } {
  return { data: { code } };
}

// ---------------------------------------------------------------------------
// normalizeMessageId
// ---------------------------------------------------------------------------

describe('normalizeMessageId', () => {
  it('returns trimmed string for normal input', () => {
    expect(normalizeMessageId('  om_abc123  ')).toBe('om_abc123');
  });

  it('returns undefined for undefined input', () => {
    expect(normalizeMessageId(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(normalizeMessageId('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    expect(normalizeMessageId('   ')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractLarkApiCode
// ---------------------------------------------------------------------------

describe('extractLarkApiCode', () => {
  it('extracts from { code: number } shape', () => {
    expect(extractLarkApiCode(makeLarkError(230011))).toBe(230011);
  });

  it('extracts from { data: { code: number } } shape', () => {
    expect(extractLarkApiCode(makeNestedLarkError(231003))).toBe(231003);
  });

  it('prefers top-level code over nested', () => {
    expect(extractLarkApiCode({ code: 230011, data: { code: 999 } })).toBe(230011);
  });

  it('returns undefined for null', () => {
    expect(extractLarkApiCode(null)).toBeUndefined();
  });

  it('returns undefined for non-object', () => {
    expect(extractLarkApiCode('error')).toBeUndefined();
  });

  it('returns undefined when code is not a number', () => {
    expect(extractLarkApiCode({ code: 'bad' })).toBeUndefined();
  });

  it('returns undefined when data.code is not a number', () => {
    expect(extractLarkApiCode({ data: { code: 'bad' } })).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    expect(extractLarkApiCode({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MESSAGE_TERMINAL_CODES & isTerminalMessageApiCode
// ---------------------------------------------------------------------------

describe('MESSAGE_TERMINAL_CODES', () => {
  it('contains 230011 and 231003', () => {
    expect(MESSAGE_TERMINAL_CODES.has(230011)).toBe(true);
    expect(MESSAGE_TERMINAL_CODES.has(231003)).toBe(true);
    expect(MESSAGE_TERMINAL_CODES.size).toBe(2);
  });
});

describe('isTerminalMessageApiCode', () => {
  it('returns true for 230011', () => {
    expect(isTerminalMessageApiCode(230011)).toBe(true);
  });

  it('returns true for 231003', () => {
    expect(isTerminalMessageApiCode(231003)).toBe(true);
  });

  it('returns false for other numbers', () => {
    expect(isTerminalMessageApiCode(99999)).toBe(false);
    expect(isTerminalMessageApiCode(0)).toBe(false);
  });

  it('returns false for non-number', () => {
    expect(isTerminalMessageApiCode('230011')).toBe(false);
    expect(isTerminalMessageApiCode(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cache — mark / get / is / reset
// ---------------------------------------------------------------------------

describe('message unavailable cache', () => {
  beforeEach(() => {
    resetUnavailableCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks and retrieves a message as unavailable', () => {
    markMessageUnavailable({ messageId: 'msg_1', apiCode: 230011 });
    expect(isMessageUnavailable('msg_1')).toBe(true);
  });

  it('returns undefined for unknown message', () => {
    expect(getMessageUnavailableState('msg_unknown')).toBeUndefined();
    expect(isMessageUnavailable('msg_unknown')).toBe(false);
  });

  it('returns undefined for undefined messageId', () => {
    expect(getMessageUnavailableState(undefined)).toBeUndefined();
    expect(isMessageUnavailable(undefined)).toBe(false);
  });

  it('stores the full state including operation', () => {
    markMessageUnavailable({ messageId: 'msg_2', apiCode: 231003, operation: 'reply' });
    const state = getMessageUnavailableState('msg_2');
    expect(state).toBeDefined();
    expect(state!.apiCode).toBe(231003);
    expect(state!.operation).toBe('reply');
    expect(state!.markedAtMs).toBeTypeOf('number');
  });

  it('normalizes messageId whitespace', () => {
    markMessageUnavailable({ messageId: '  msg_3  ', apiCode: 230011 });
    expect(isMessageUnavailable('msg_3')).toBe(true);
    expect(isMessageUnavailable('  msg_3  ')).toBe(true);
  });

  it('no-ops on empty messageId', () => {
    markMessageUnavailable({ messageId: '', apiCode: 230011 });
    expect(isMessageUnavailable('')).toBe(false);
  });

  it('resetUnavailableCache clears all entries', () => {
    markMessageUnavailable({ messageId: 'msg_a', apiCode: 230011 });
    markMessageUnavailable({ messageId: 'msg_b', apiCode: 231003 });
    resetUnavailableCache();
    expect(isMessageUnavailable('msg_a')).toBe(false);
    expect(isMessageUnavailable('msg_b')).toBe(false);
  });

  // --- TTL tests with fake timers ---

  it('expires entries after TTL (30 min)', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    markMessageUnavailable({ messageId: 'msg_ttl', apiCode: 230011 });
    expect(isMessageUnavailable('msg_ttl')).toBe(true);

    // Advance 29 min — still valid
    vi.setSystemTime(now + 29 * 60 * 1000);
    expect(isMessageUnavailable('msg_ttl')).toBe(true);

    // Advance past 30 min — expired
    vi.setSystemTime(now + 30 * 60 * 1000 + 1);
    expect(isMessageUnavailable('msg_ttl')).toBe(false);
  });

  it('getMessageUnavailableState returns undefined after TTL', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    markMessageUnavailable({ messageId: 'msg_ttl2', apiCode: 231003 });
    vi.setSystemTime(now + 31 * 60 * 1000);
    expect(getMessageUnavailableState('msg_ttl2')).toBeUndefined();
  });

  it('prunes expired entries when cache exceeds max size', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    // Fill 512 entries (all at time=now)
    for (let i = 0; i < 512; i++) {
      markMessageUnavailable({ messageId: `msg_${i}`, apiCode: 230011 });
    }
    expect(isMessageUnavailable('msg_0')).toBe(true);

    // Advance time past TTL so all existing entries are expired
    vi.setSystemTime(now + 31 * 60 * 1000);

    // Adding one more should trigger pruneExpired
    markMessageUnavailable({ messageId: 'msg_new', apiCode: 231003 });

    // Old entries should be gone (pruned)
    expect(isMessageUnavailable('msg_0')).toBe(false);
    expect(isMessageUnavailable('msg_511')).toBe(false);
    // New entry should exist
    expect(isMessageUnavailable('msg_new')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// markMessageUnavailableFromError
// ---------------------------------------------------------------------------

describe('markMessageUnavailableFromError', () => {
  beforeEach(() => {
    resetUnavailableCache();
  });

  it('marks unavailable when error has terminal code', () => {
    const code = markMessageUnavailableFromError({
      messageId: 'msg_err1',
      error: makeLarkError(230011),
      operation: 'send',
    });
    expect(code).toBe(230011);
    expect(isMessageUnavailable('msg_err1')).toBe(true);
  });

  it('returns undefined for non-terminal code', () => {
    const code = markMessageUnavailableFromError({
      messageId: 'msg_err2',
      error: makeLarkError(99999),
    });
    expect(code).toBeUndefined();
    expect(isMessageUnavailable('msg_err2')).toBe(false);
  });

  it('returns undefined for undefined messageId', () => {
    const code = markMessageUnavailableFromError({
      messageId: undefined,
      error: makeLarkError(230011),
    });
    expect(code).toBeUndefined();
  });

  it('returns undefined for null error', () => {
    const code = markMessageUnavailableFromError({
      messageId: 'msg_err3',
      error: null,
    });
    expect(code).toBeUndefined();
  });

  it('extracts from nested error shape', () => {
    const code = markMessageUnavailableFromError({
      messageId: 'msg_nested',
      error: makeNestedLarkError(231003),
    });
    expect(code).toBe(231003);
    expect(isMessageUnavailable('msg_nested')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MessageUnavailableError
// ---------------------------------------------------------------------------

describe('MessageUnavailableError', () => {
  it('stores messageId, apiCode, operation', () => {
    const err = new MessageUnavailableError({
      messageId: 'msg_1',
      apiCode: 230011,
      operation: 'reply',
    });
    expect(err.messageId).toBe('msg_1');
    expect(err.apiCode).toBe(230011);
    expect(err.operation).toBe('reply');
    expect(err.name).toBe('MessageUnavailableError');
    expect(err.message).toContain('msg_1');
    expect(err.message).toContain('230011');
    expect(err.message).toContain('op=reply');
  });

  it('works without operation', () => {
    const err = new MessageUnavailableError({ messageId: 'msg_2', apiCode: 231003 });
    expect(err.operation).toBeUndefined();
    expect(err.message).not.toContain('op=');
  });

  it('is instanceof Error', () => {
    const err = new MessageUnavailableError({ messageId: 'msg_3', apiCode: 230011 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MessageUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// isMessageUnavailableError
// ---------------------------------------------------------------------------

describe('isMessageUnavailableError', () => {
  it('returns true for MessageUnavailableError instance', () => {
    const err = new MessageUnavailableError({ messageId: 'msg', apiCode: 230011 });
    expect(isMessageUnavailableError(err)).toBe(true);
  });

  it('returns true for object with name === MessageUnavailableError', () => {
    const err = { name: 'MessageUnavailableError', message: 'test' };
    expect(isMessageUnavailableError(err)).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isMessageUnavailableError(new Error('test'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isMessageUnavailableError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isMessageUnavailableError(undefined)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isMessageUnavailableError('error')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertMessageAvailable
// ---------------------------------------------------------------------------

describe('assertMessageAvailable', () => {
  beforeEach(() => {
    resetUnavailableCache();
  });

  it('does nothing for available message', () => {
    expect(() => assertMessageAvailable('msg_ok')).not.toThrow();
  });

  it('does nothing for undefined messageId', () => {
    expect(() => assertMessageAvailable(undefined)).not.toThrow();
  });

  it('does nothing for empty messageId', () => {
    expect(() => assertMessageAvailable('')).not.toThrow();
  });

  it('throws MessageUnavailableError if message is marked', () => {
    markMessageUnavailable({ messageId: 'msg_bad', apiCode: 230011 });
    expect(() => assertMessageAvailable('msg_bad')).toThrow(MessageUnavailableError);
  });

  it('throws with the correct apiCode', () => {
    markMessageUnavailable({ messageId: 'msg_code', apiCode: 231003, operation: 'orig' });
    try {
      assertMessageAvailable('msg_code', 'new-op');
    } catch (err) {
      expect(err).toBeInstanceOf(MessageUnavailableError);
      const mue = err as MessageUnavailableError;
      expect(mue.apiCode).toBe(231003);
      // Operation from assert call takes precedence
      expect(mue.operation).toBe('new-op');
    }
  });

  it('uses cache operation when none provided to assert', () => {
    markMessageUnavailable({ messageId: 'msg_op', apiCode: 230011, operation: 'cached-op' });
    try {
      assertMessageAvailable('msg_op');
    } catch (err) {
      expect((err as MessageUnavailableError).operation).toBe('cached-op');
    }
  });
});

// ---------------------------------------------------------------------------
// runWithMessageUnavailableGuard
// ---------------------------------------------------------------------------

describe('runWithMessageUnavailableGuard', () => {
  beforeEach(() => {
    resetUnavailableCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls fn when message is available', async () => {
    const fn = vi.fn(async () => 42);
    const result = await runWithMessageUnavailableGuard({
      messageId: 'msg_ok',
      operation: 'test',
      fn,
    });
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('calls fn when messageId is undefined', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await runWithMessageUnavailableGuard({
      messageId: undefined,
      operation: 'test',
      fn,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('throws MessageUnavailableError if message already marked', async () => {
    markMessageUnavailable({ messageId: 'msg_bad', apiCode: 230011 });
    const fn = vi.fn(async () => 'never');

    await expect(
      runWithMessageUnavailableGuard({ messageId: 'msg_bad', operation: 'test', fn }),
    ).rejects.toThrow(MessageUnavailableError);

    expect(fn).not.toHaveBeenCalled();
  });

  it('marks and throws when fn throws terminal error', async () => {
    const fn = vi.fn(async () => {
      throw makeLarkError(231003);
    });

    await expect(
      runWithMessageUnavailableGuard({ messageId: 'msg_fail', operation: 'reply', fn }),
    ).rejects.toThrow(MessageUnavailableError);

    expect(isMessageUnavailable('msg_fail')).toBe(true);
  });

  it('re-throws non-terminal errors without marking', async () => {
    const fn = vi.fn(async () => {
      throw makeLarkError(99999);
    });

    await expect(
      runWithMessageUnavailableGuard({ messageId: 'msg_other', operation: 'test', fn }),
    ).rejects.toEqual(makeLarkError(99999));

    expect(isMessageUnavailable('msg_other')).toBe(false);
  });

  it('re-throws generic errors', async () => {
    const genericErr = new Error('network');
    const fn = vi.fn(async () => {
      throw genericErr;
    });

    await expect(
      runWithMessageUnavailableGuard({ messageId: 'msg_net', operation: 'test', fn }),
    ).rejects.toBe(genericErr);
  });

  it('handles whitespace messageId by calling fn directly', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await runWithMessageUnavailableGuard({
      messageId: '   ',
      operation: 'test',
      fn,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// UnavailableGuard
// ---------------------------------------------------------------------------

describe('UnavailableGuard', () => {
  beforeEach(() => {
    resetUnavailableCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createGuard(overrides?: { replyToMessageId?: string | undefined }) {
    const terminated: string[] = [];
    const replyToMessageId = overrides && 'replyToMessageId' in overrides ? overrides.replyToMessageId : 'msg_reply';
    const guard = new UnavailableGuard({
      replyToMessageId,
      getCardMessageId: () => 'msg_card',
      onTerminate: () => terminated.push('called'),
    });
    return { guard, terminated };
  }

  // --- shouldSkip ---

  it('returns false when message is available', () => {
    const { guard } = createGuard();
    expect(guard.shouldSkip('test')).toBe(false);
    expect(guard.isTerminated).toBe(false);
  });

  it('returns false when replyToMessageId is undefined', () => {
    const { guard } = createGuard({ replyToMessageId: undefined });
    expect(guard.shouldSkip('test')).toBe(false);
  });

  it('returns true and terminates when message is already unavailable', () => {
    markMessageUnavailable({ messageId: 'msg_reply', apiCode: 230011 });
    const { guard, terminated } = createGuard();
    expect(guard.shouldSkip('test')).toBe(true);
    expect(guard.isTerminated).toBe(true);
    expect(terminated).toEqual(['called']);
  });

  it('returns true immediately on second call after termination', () => {
    markMessageUnavailable({ messageId: 'msg_reply', apiCode: 230011 });
    const { guard } = createGuard();
    expect(guard.shouldSkip('first')).toBe(true);
    expect(guard.shouldSkip('second')).toBe(true);
  });

  // --- terminate ---

  it('returns false when no terminal info is available', () => {
    const { guard, terminated } = createGuard();
    expect(guard.terminate('test')).toBe(false);
    expect(guard.isTerminated).toBe(false);
    expect(terminated).toEqual([]);
  });

  it('returns true when already terminated', () => {
    markMessageUnavailable({ messageId: 'msg_reply', apiCode: 230011 });
    const { guard } = createGuard();
    expect(guard.terminate('first')).toBe(true);
    expect(guard.terminate('second')).toBe(true);
  });

  it('terminates via MessageUnavailableError', () => {
    const { guard, terminated } = createGuard();
    const err = new MessageUnavailableError({ messageId: 'msg_reply', apiCode: 231003 });
    expect(guard.terminate('test', err)).toBe(true);
    expect(guard.isTerminated).toBe(true);
    expect(terminated).toEqual(['called']);
  });

  it('terminates via terminal error code in raw error', () => {
    const { guard, terminated } = createGuard();
    expect(guard.terminate('test', makeLarkError(230011))).toBe(true);
    expect(guard.isTerminated).toBe(true);
    expect(terminated).toEqual(['called']);
    // Also marks the message in cache
    expect(isMessageUnavailable('msg_reply')).toBe(true);
  });

  it('falls back to cardMessageId when replyToMessageId is undefined', () => {
    const { guard, terminated } = createGuard({ replyToMessageId: undefined });
    expect(guard.terminate('test', makeLarkError(231003))).toBe(true);
    expect(guard.isTerminated).toBe(true);
    expect(terminated).toEqual(['called']);
    // Falls back to cardMessageId for marking
    expect(isMessageUnavailable('msg_card')).toBe(true);
  });

  it('returns false for non-terminal error code', () => {
    const { guard, terminated } = createGuard();
    expect(guard.terminate('test', makeLarkError(99999))).toBe(false);
    expect(guard.isTerminated).toBe(false);
    expect(terminated).toEqual([]);
  });

  it('uses cached state to find apiCode', () => {
    markMessageUnavailable({ messageId: 'msg_reply', apiCode: 230011, operation: 'cached' });
    const { guard, terminated } = createGuard();
    // terminate with no error — should use cached state
    expect(guard.terminate('test')).toBe(true);
    expect(guard.isTerminated).toBe(true);
    expect(terminated).toEqual(['called']);
  });

  it('uses cached state from cardMessageId when replyToMessageId has no state', () => {
    const { guard, terminated } = createGuard({ replyToMessageId: undefined });
    markMessageUnavailable({ messageId: 'msg_card', apiCode: 231003 });
    expect(guard.terminate('test')).toBe(true);
    expect(guard.isTerminated).toBe(true);
  });
});
