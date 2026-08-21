/**
 * Circuit breaker for degenerate agent replies on heartbeat-family runs
 * (insight/evolution/exec/cron relays and periodic heartbeats).
 *
 * A model stuck in a self-referential planning loop emits meta-text that grows
 * without bound (see the 2026-08-20/21 incidents: 16-18 minute streams of
 * "My reply now:" variants, ~400K chars delivered to users). Two structural
 * signals distinguish that from any legitimate reply:
 *   - sheer length: heartbeat relays are short; nothing sane exceeds the cap
 *   - shingle diversity: degenerate text is the same few phrases recombined,
 *     so distinct n-grams / total n-grams collapses toward zero
 */

export type DegenerateReplyVerdict =
  | { degenerate: false; shingleRatio?: number }
  | { degenerate: true; reason: "length" | "repetition"; shingleRatio?: number };

export const DEGENERATE_REPLY_MAX_CHARS = 24_000;
export const DEGENERATE_REPLY_SCAN_MIN_CHARS = 6_000;
export const DEGENERATE_REPLY_SHINGLE_SIZE = 24;
export const DEGENERATE_REPLY_SHINGLE_RATIO = 0.12;

function distinctShingleRatio(text: string): number {
  const size = DEGENERATE_REPLY_SHINGLE_SIZE;
  const total = text.length - size + 1;
  if (total <= 0) {
    return 1;
  }
  // Cap the scan cost: sample at most 20k shingles, evenly spaced.
  const step = Math.max(1, Math.ceil(total / 20_000));
  const seen = new Set<string>();
  let scanned = 0;
  for (let i = 0; i + size <= text.length; i += step) {
    seen.add(text.slice(i, i + size));
    scanned += 1;
  }
  return scanned === 0 ? 1 : seen.size / scanned;
}

export function isDegenerateReplyText(text: string): DegenerateReplyVerdict {
  const trimmed = text.trim();
  if (trimmed.length > DEGENERATE_REPLY_MAX_CHARS) {
    return { degenerate: true, reason: "length" };
  }
  if (trimmed.length <= DEGENERATE_REPLY_SCAN_MIN_CHARS) {
    return { degenerate: false };
  }
  const ratio = distinctShingleRatio(trimmed);
  if (ratio < DEGENERATE_REPLY_SHINGLE_RATIO) {
    return { degenerate: true, reason: "repetition", shingleRatio: ratio };
  }
  return { degenerate: false, shingleRatio: ratio };
}

const INSIGHT_EVENT_PREFIX = "[Cognitive Insight] ";
const INSIGHT_EVENT_INSTRUCTION =
  "（这是一条已生成的主动洞察，请用你自己的语言自然地分享给用户。）";
const FALLBACK_INSIGHT_MAX_CHARS = 2_000;

/**
 * Bounded fallback text for a blocked insight relay: the insight itself was
 * verified before delivery, so relaying the stored event text is strictly
 * safer than whatever the relay turn produced.
 */
export function buildDegenerateReplyFallback(insightEventText?: string): string {
  const notice = "（转述生成异常，已自动拦截。以下为洞察原文）";
  const raw = insightEventText?.trim();
  if (!raw) {
    return "（主动回复生成异常，已自动拦截。原始事件仍保留在系统记录中。）";
  }
  let content = raw.startsWith(INSIGHT_EVENT_PREFIX)
    ? raw.slice(INSIGHT_EVENT_PREFIX.length).trim()
    : raw;
  const instructionIndex = content.indexOf(INSIGHT_EVENT_INSTRUCTION);
  if (instructionIndex >= 0) {
    content = content.slice(0, instructionIndex).trim();
  }
  if (content.length > FALLBACK_INSIGHT_MAX_CHARS) {
    content = `${content.slice(0, FALLBACK_INSIGHT_MAX_CHARS)}…`;
  }
  return `${notice}\n\n${content}`;
}
