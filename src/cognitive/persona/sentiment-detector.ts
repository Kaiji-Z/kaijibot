import type { SentimentResult } from "../types.js";

/**
 * Rule-based sentiment detection — fast (<1ms), no LLM needed.
 *
 * Returns undefined for neutral messages to avoid noise (most messages).
 * Only detects strong emotional signals: frustrated, excited, confused.
 */

type SentimentPattern = {
  label: "frustrated" | "excited" | "confused";
  patterns: RegExp[];
  confidence: number;
};

const SENTIMENT_PATTERNS: SentimentPattern[] = [
  {
    label: "frustrated",
    patterns: [
      /烦死/,
      /受不了/,
      /崩溃/,
      /真烦/,
      /太烦/,
      /气死/,
      /怎么又/,
      /怎么总是/,
      /怎么还是/,
      /不靠谱/,
      /\bfucking\b/i,
      /\bdamn\b/i,
    ],
    confidence: 0.85,
  },
  {
    label: "excited",
    patterns: [
      /太棒/,
      /太好[了啦]/,
      /太酷/,
      /太牛/,
      /太厉害了/,
      /终于搞定/,
      /终于解决/,
      /终于完成/,
      /原来如此/,
      /\bamazing\b/i,
      /\bawesome\b/i,
    ],
    confidence: 0.8,
  },
  {
    label: "confused",
    patterns: [
      /不明白/,
      /不理解/,
      /不懂/,
      /什么意思/,
      /没看懂/,
      /怎么回事/,
      /\bconfused\b/i,
      /能解释一下吗/,
    ],
    confidence: 0.75,
  },
];

/**
 * Detect strong sentiment in a user message.
 * Returns undefined for neutral messages.
 */
export function detectSentiment(userMessage: string): SentimentResult | undefined {
  for (const { label, patterns, confidence } of SENTIMENT_PATTERNS) {
    for (const pattern of patterns) {
      const match = userMessage.match(pattern);
      if (match) {
        return {
          label,
          confidence,
          evidence: match[0],
        };
      }
    }
  }
  return undefined;
}
