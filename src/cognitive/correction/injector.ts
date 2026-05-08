import type { CorrectionRecord } from "./types.js";

export const MAX_INJECTED_CORRECTIONS = 15;

export function formatCorrectionsPrompt(corrections: CorrectionRecord[]): string {
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

  const lines = [
    "## Known Corrections",
    "以下是你过去犯过的错误和正确的做法，请避免重复：",
    "",
  ];

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    lines.push(`${i + 1}. [${c.trigger}] ${c.mistake} → ${c.correction}`);
  }

  return lines.join("\n");
}
