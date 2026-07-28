import { jaccardSimilarity, tokenize } from "../../infra/text-similarity.js";
import { L, pickLocalized, type CognitiveLocale } from "../cognitive-locale.js";
import type { CorrectionRecord } from "./types.js";

export const MAX_INJECTED_CORRECTIONS = 15;

const MIN_SUBSTRING_LEN = 4;

function computeRelevanceScore(messageTokens: Set<string>, correctionTokens: Set<string>): number {
  const jaccard = jaccardSimilarity(messageTokens, correctionTokens);
  if (jaccard > 0) {
    return jaccard;
  }
  let hits = 0;
  for (const mt of messageTokens) {
    if (mt.length < MIN_SUBSTRING_LEN) {
      continue;
    }
    for (const ct of correctionTokens) {
      if (ct.length < MIN_SUBSTRING_LEN) {
        continue;
      }
      if (ct.includes(mt) || mt.includes(ct)) {
        hits++;
        break;
      }
    }
  }
  return hits > 0 ? 0.01 * hits : 0;
}

/** Select corrections by Jaccard relevance to current message; falls back to top-N by reinforcedCount when no overlap. */
export function selectRelevantCorrections(
  all: CorrectionRecord[],
  currentMessage: string,
  limit: number = MAX_INJECTED_CORRECTIONS,
): CorrectionRecord[] {
  if (all.length === 0) {
    return [];
  }
  if (all.length <= limit) {
    return [...all].toSorted((a, b) => b.reinforcedCount - a.reinforcedCount);
  }

  const messageTokens = tokenize(currentMessage);
  const scored = all.map((record) => {
    const correctionText = `${record.domain} ${record.trigger} ${record.mistake}`;
    const score = computeRelevanceScore(messageTokens, tokenize(correctionText));
    return { record, score };
  });

  const maxScore = scored.reduce((max, s) => (s.score > max ? s.score : max), 0);
  if (maxScore === 0) {
    return [...all].toSorted((a, b) => b.reinforcedCount - a.reinforcedCount).slice(0, limit);
  }

  return scored
    .toSorted((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.record.reinforcedCount - a.record.reinforcedCount;
    })
    .slice(0, limit)
    .map((s) => s.record);
}

const SECTION_HEADER = L(
  "以下是你过去犯过的错误和正确的做法，请避免重复：",
  "Below are mistakes you have made in the past along with the correct approach. Avoid repeating them:",
);

export function formatCorrectionsPrompt(
  corrections: CorrectionRecord[],
  locale: CognitiveLocale = "zh",
): string {
  if (corrections.length === 0) {
    return "";
  }

  const sorted = [...corrections]
    .toSorted((a, b) => {
      if (b.reinforcedCount !== a.reinforcedCount) {
        return b.reinforcedCount - a.reinforcedCount;
      }
      return b.lastReinforced - a.lastReinforced;
    })
    .slice(0, MAX_INJECTED_CORRECTIONS);

  const lines = ["## Known Corrections", pickLocalized(SECTION_HEADER, locale), ""];

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    lines.push(`${i + 1}. [${c.trigger}] ${c.mistake} → ${c.correction}`);
  }

  return lines.join("\n");
}
