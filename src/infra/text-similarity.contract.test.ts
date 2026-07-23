/**
 * Contract test: the duplicated `tokenize()` in the memory-core extension's
 * `mmr.ts` MUST produce identical token sets to the canonical implementation
 * in `src/infra/text-similarity.ts`.
 *
 * The canonical file's header comment states: "The memory-core extension has
 * its own copy in mmr.ts with identical logic; both must stay in sync."
 * This test enforces that contract so a fix to one copy cannot silently drift
 * from the other.
 */
import { describe, expect, it } from "vitest";

import { tokenize as canonicalTokenize } from "./text-similarity.js";
import { tokenize as mmrTokenize } from "../../extensions/memory-core/src/memory/mmr.js";

const CORPUS = [
  // Pure ASCII
  "hello world",
  "TypeScript 6.x",
  "",
  // Pure CJK (Chinese)
  "我喜欢写代码",
  "认知层主动推送洞察",
  // Mixed CJK + ASCII (the spurious-bigram guard case from the docstring)
  "我喜欢hello你好",
  // Japanese (Hiragana + Katakana + Kanji)
  "私はプログラミングが好きです",
  // Korean (Hangul)
  "안녕하세요 세계",
  // CJK with punctuation
  "你好，世界！Hello, World!",
  // Single CJK char
  "中",
  // Numbers + CJK
  "GPT-4 和 Claude 3.5",
  // Emoji (should not be treated as CJK)
  "hello 👋 world 🌍",
];

describe("tokenizer sync contract: text-similarity.ts ↔ memory-core/mmr.ts", () => {
  for (const text of CORPUS) {
    it(`produces identical token sets for: ${JSON.stringify(text).slice(0, 40)}`, () => {
      const canonical = canonicalTokenize(text);
      const mmr = mmrTokenize(text);
      expect(mmr).toEqual(canonical);
    });
  }

  it("token sets have equal size across the whole corpus", () => {
    for (const text of CORPUS) {
      const canonical = canonicalTokenize(text);
      const mmr = mmrTokenize(text);
      expect(mmr.size).toBe(canonical.size);
    }
  });
});
