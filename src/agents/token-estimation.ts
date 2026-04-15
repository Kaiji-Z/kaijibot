/**
 * CJK-aware token estimation.
 *
 * The upstream `estimateTokens` from `@mariozechner/pi-coding-agent` uses a
 * simple `chars / 4` heuristic which works well for English / ASCII text but
 * drastically under-estimates Chinese, Japanese, and Korean text where each
 * character typically maps to 1–2 tokens (vs. ~0.25 for ASCII).
 *
 * For a conversation with 200K Chinese characters the upstream heuristic would
 * estimate ~50K tokens (well within a 200K context window) when the real count
 * is closer to 300–400K — causing compaction to never trigger and the API to
 * return `context_window_exceeded`.
 *
 * This module provides drop-in replacements that detect CJK code-points and
 * apply a per-character ratio that matches real tokenizer behaviour more
 * closely.
 *
 * Ratios (conservative, slightly over-estimate to stay safe):
 *   ASCII / Latin / other:   1 token per 4 chars  (unchanged)
 *   CJK Unified Ideographs:  1 token per 1.5 chars  (~0.67 token/char)
 *   CJK Extensions / Kana /  1 token per 1.5 chars   (~0.67 token/char)
 *   Hangul Syllables:
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";

// ---------- Character classification ----------

/**
 * Unicode ranges for CJK characters that tokenize at ~1.5 chars/token.
 * This covers the vast majority of everyday Chinese (CJK Unified Ideographs,
 * CJK Compatibility Ideographs, and common extensions).
 */
const CJK_RATIO_1_5_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
];

/**
 * Unicode ranges for CJK-adjacent scripts that tokenize at ~2 chars/token.
 * Includes Hiragana, Katakana, Hangul, and less common CJK extensions.
 */
const CJK_RATIO_2_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0xac00, 0xd7af], // Hangul Syllables
  [0x20000, 0x2a6df], // CJK Unified Ideographs Extension B
  [0x2a700, 0x2b73f], // CJK Unified Ideographs Extension C
  [0x2b740, 0x2b81f], // CJK Unified Ideographs Extension D
  [0x2b820, 0x2ceaf], // CJK Unified Ideographs Extension E
  [0x2ceb0, 0x2ebef], // CJK Unified Ideographs Extension F
  [0x3000, 0x303f], // CJK Symbols and Punctuation
  [0xff00, 0xffef], // Fullwidth Forms
];

function isCJKRatio15(cp: number): boolean {
  for (const [lo, hi] of CJK_RATIO_1_5_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

function isCJKRatio2(cp: number): boolean {
  for (const [lo, hi] of CJK_RATIO_2_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

// ---------- String-level estimation ----------

/**
 * Estimate the token count for a plain-text string, accounting for CJK
 * characters that tokenize much more densely than ASCII.
 */
export function estimateTextTokens(text: string): number {
  let cjk15Chars = 0;
  let cjk2Chars = 0;
  let otherChars = 0;

  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isCJKRatio15(cp)) {
      cjk15Chars++;
    } else if (isCJKRatio2(cp)) {
      cjk2Chars++;
    } else {
      otherChars++;
    }
  }

  // CJK primary: ~1.5 chars/token → chars / 1.5
  // CJK secondary: ~1.5 chars/token → chars / 1.5
  // Other: ~4 chars/token → chars / 4
  const cjk15Tokens = Math.ceil(cjk15Chars / 1.5);
  const cjk2Tokens = Math.ceil(cjk2Chars / 1.5);
  const otherTokens = Math.ceil(otherChars / 4);

  return cjk15Tokens + cjk2Tokens + otherTokens;
}

// ---------- Message-level estimation (drop-in for upstream estimateTokens) ----------

/**
 * Estimate token count for an `AgentMessage`, accounting for CJK text.
 *
 * This is a drop-in replacement for `estimateTokens` from
 * `@mariozechner/pi-coding-agent` that fixes the severe under-estimation for
 * Chinese / Japanese / Korean text.
 */
export function estimateMessageTokens(message: AgentMessage): number {
  const msg = message as unknown as Record<string, unknown>;
  const role = msg.role as string;

  switch (role) {
    case "user": {
      const content = msg.content;
      if (typeof content === "string") {
        return estimateTextTokens(content);
      }
      if (Array.isArray(content)) {
        let total = 0;
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            total += estimateTextTokens(b.text as string);
          }
        }
        return total;
      }
      return 0;
    }
    case "assistant": {
      let total = 0;
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            total += estimateTextTokens(b.text as string);
          } else if (b.type === "thinking" && typeof b.thinking === "string") {
            total += estimateTextTokens(b.thinking as string);
          } else if (b.type === "toolCall") {
            const name = typeof b.name === "string" ? b.name : "";
            const args =
              typeof b.arguments === "string"
                ? b.arguments
                : JSON.stringify(b.arguments ?? "");
            total += estimateTextTokens(name + args);
          }
        }
      }
      return total;
    }
    case "toolResult":
    case "custom": {
      const content = msg.content;
      if (typeof content === "string") {
        return estimateTextTokens(content);
      }
      if (Array.isArray(content)) {
        let total = 0;
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            total += estimateTextTokens(b.text as string);
          }
          if (b.type === "image") {
            total += 1200; // Same as upstream: images ≈ 1200 tokens
          }
        }
        return total;
      }
      return 0;
    }
    case "bashExecution": {
      const command = typeof msg.command === "string" ? msg.command : "";
      const output = typeof msg.output === "string" ? msg.output : "";
      return estimateTextTokens(command + output);
    }
    case "branchSummary":
    case "compactionSummary": {
      const summary = typeof msg.summary === "string" ? msg.summary : "";
      return estimateTextTokens(summary);
    }
    default: {
      // Fallback: serialize to string and estimate
      const text = JSON.stringify(message);
      return estimateTextTokens(text);
    }
  }
}

/**
 * Effective chars-per-token ratio for a given text, used by callers that
 * convert between token budgets and character budgets.
 *
 * For pure ASCII this returns 4 (upstream default).  For CJK-heavy text it
 * returns a lower ratio, reflecting that fewer characters fit in one token.
 */
export function effectiveCharsPerToken(text: string): number {
  if (text.length === 0) return 4;
  const tokens = estimateTextTokens(text);
  if (tokens === 0) return 4;
  return text.length / tokens;
}
