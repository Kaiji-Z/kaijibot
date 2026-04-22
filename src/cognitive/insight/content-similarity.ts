export function extractTrigrams(text: string): Set<string> {
  const trigrams = new Set<string>();
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }
  return trigrams;
}

export function computeTrigramSimilarity(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) return 0;
  const trigramsA = extractTrigrams(a);
  const trigramsB = extractTrigrams(b);
  if (trigramsA.size === 0 || trigramsB.size === 0) return 0;
  let overlap = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) overlap++;
  }
  return overlap / Math.max(trigramsA.size, trigramsB.size);
}

export function isDuplicateByContent(
  newContent: string,
  recentContents: string[],
  threshold: number = 0.6,
): boolean {
  for (const recent of recentContents) {
    if (computeTrigramSimilarity(newContent, recent) > threshold) return true;
  }
  return false;
}
