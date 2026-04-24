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

const CHINESE_STOP_CHARS = "的了是在和与但也都就把被让对给从到为以其之所等着过得地会有能可以要将于中上下里外时后前间个这那什么怎么哪几多少";

export function extractChinesePhrases(text: string): string[] {
  let spaced = text;
  for (const ch of CHINESE_STOP_CHARS) {
    spaced = spaced.replaceAll(ch, " ");
  }
  return spaced
    .split(/[\s,，。.？?！!；;：:、""''「」【】（）()\[\]{}<>《》\/\\—–\-]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2 && s.length <= 20);
}

export function computeContentWordOverlap(a: string, b: string): number {
  const phrasesA = extractChinesePhrases(a);
  const phrasesB = extractChinesePhrases(b);
  if (phrasesA.length === 0 || phrasesB.length === 0) return 0;

  const cjkFilter = (s: string) => [...s].filter(ch => ch.charCodeAt(0) > 0x2e7f);
  const charsA = new Set(cjkFilter(phrasesA.join("")).map(c => c.toLowerCase()));
  const charsB = new Set(cjkFilter(phrasesB.join("")).map(c => c.toLowerCase()));

  if (charsA.size === 0 || charsB.size === 0) return 0;

  let intersection = 0;
  for (const ch of charsA) {
    if (charsB.has(ch)) intersection++;
  }
  const union = new Set([...charsA, ...charsB]).size;
  return union > 0 ? intersection / union : 0;
}

export function isDuplicateBySemanticOverlap(
  newContent: string,
  recentContents: string[],
  options?: { trigramThreshold?: number; contentWordThreshold?: number },
): boolean {
  const trigramThreshold = options?.trigramThreshold ?? 0.6;
  const contentWordThreshold = options?.contentWordThreshold ?? 0.15;

  for (const recent of recentContents) {
    if (computeTrigramSimilarity(newContent, recent) > trigramThreshold) return true;
    if (computeContentWordOverlap(newContent, recent) > contentWordThreshold) return true;
  }
  return false;
}
