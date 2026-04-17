import type { PersonaTree, ConfidenceValue, DomainNode, RapportMetrics } from "../types.js";
import type { ExtractionResult, ExtractedAttribute } from "./types.js";
import { observeCoOccurrence, seedDomainGraph, decayEdges } from "../insight/cross-domain-mapper.js";
import { computeLifecycleStage, getDecayMultiplier } from "./lifecycle.js";
import { detectContradictions, pruneContradictionLog } from "./contradiction-resolver.js";

const DOMAIN_DEPTH_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const EDGE_DECAY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
const AUTO_BLACKLIST_NEGATION_THRESHOLD = 3;
const AUTO_BLACKLIST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const INSIGHT_ECHO_PATTERNS: ReadonlyArray<RegExp> = [
  /receives?\s+(automated\s+)?cognitive\s+insight/i,
  /最近出现了?一些值得关注的新方向/,
  /结合你在这个领域的深度理解/,
  /可能会影响你的技术决策/,
  /cognitive insight (notifications?|alerts?)/i,
  /new (trends|directions) in this (field|domain)/i,
];

/**
 * Merge extraction results into an existing PersonaTree.
 * Returns a new PersonaTree (does not mutate input).
 */
export function mergeExtraction(
  persona: PersonaTree,
  extraction: ExtractionResult,
  nowMs?: number,
): PersonaTree {
  const now = nowMs ?? Date.now();

  const coreTraitAttrs = extraction.attributes.filter(a => a.field.startsWith("identity.coreTraits."));
  const { records: contradictions, resolvedTraits } = detectContradictions(
    persona.identity.coreTraits,
    coreTraitAttrs,
    now,
  );

  const newCoreTraits = { ...persona.identity.coreTraits };
  for (const attr of extraction.attributes) {
    if (attr.field.startsWith("identity.coreTraits.")) {
      const traitName = attr.field.replace("identity.coreTraits.", "");
      if (resolvedTraits[traitName]?.resolution === "resolved_old") continue;
      newCoreTraits[traitName] = mergeConfidenceValue(
        newCoreTraits[traitName],
        {
          value: attr.value,
          confidence: attr.confidence,
          evidenceCount: 1,
          lastUpdated: now,
          source: attr.source,
        },
        now,
      );
    }
  }

  const extractionDomainNames = new Set(extraction.domains.map((d) => d.name));
  const newDomains = { ...persona.domains };

  const isPlausibleKeyInsight = (s: string): boolean => {
    if (s.length < 4 || s.length > 200) return false;
    for (const pat of INSIGHT_ECHO_PATTERNS) {
      if (pat.test(s)) return false;
    }
    return true;
  };

  const decayMultiplier = getDecayMultiplier(persona.lifecycle);
  for (const [name, node] of Object.entries(newDomains)) {
    if (!extractionDomainNames.has(name)) {
      const ageMs = now - node.lastMentioned;
      const decayFactor = Math.exp((-Math.LN2 * ageMs) / (DOMAIN_DEPTH_HALF_LIFE_MS / decayMultiplier));
      const decayedDepth = node.depth * decayFactor;
      if (decayedDepth < 0.5) {
        delete newDomains[name];
      } else {
        newDomains[name] = { ...node, depth: Math.round(decayedDepth * 10) / 10 };
      }
    }
  }

  for (const domain of extraction.domains) {
    const existing = newDomains[domain.name];

    if (domain.negated) {
      if (existing) {
        const reducedDepth = Math.max(0.5, existing.depth * 0.7);
        newDomains[domain.name] = {
          ...existing,
          depth: reducedDepth,
          negationSignals: (existing.negationSignals ?? 0) + 1,
          lastNegatedAt: now,
        };
      }
      continue;
    }

    if (existing) {
      newDomains[domain.name] = {
        ...existing,
        depth: Math.max(existing.depth, domain.depth),
        recurrence: existing.recurrence + 1,
        lastMentioned: now,
        keyInsights: [...new Set([...existing.keyInsights, ...domain.insights.filter(isPlausibleKeyInsight)])].slice(-20),
        activeQuestions: [...new Set([...existing.activeQuestions, ...domain.questions])].slice(-10),
        negationSignals: existing.negationSignals ?? 0,
      };
    } else {
      newDomains[domain.name] = {
        depth: domain.depth,
        recurrence: 1,
        lastMentioned: now,
        keyInsights: domain.insights.filter(isPlausibleKeyInsight),
        activeQuestions: domain.questions,
        connections: [],
        negationSignals: 0,
      } satisfies DomainNode;
    }
  }

  const newBlacklist = [...(persona.domainBlacklist ?? [])];
  for (const domain of extraction.blacklistRequests ?? []) {
    if (!newBlacklist.includes(domain)) {
      newBlacklist.push(domain);
    }
  }

  for (const [name, node] of Object.entries(newDomains)) {
    if (newBlacklist.includes(name)) continue;
    if (
      node.negationSignals >= AUTO_BLACKLIST_NEGATION_THRESHOLD &&
      node.lastNegatedAt !== undefined &&
      (now - node.lastNegatedAt) <= AUTO_BLACKLIST_WINDOW_MS
    ) {
      newBlacklist.push(name);
    }
  }

  for (const blacklisted of newBlacklist) {
    delete newDomains[blacklisted];
  }

  const hasCJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test.bind(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u);
  const TECH_DOMAIN_TERMS: ReadonlySet<string> = new Set([
    "kubernetes", "docker", "typescript", "python", "javascript", "rust",
    "react", "vue", "angular", "node", "deno", "bun", "go", "java",
    "k8s", "api", "rest", "graphql", "sql", "redis", "mongodb",
    "git", "github", "linux", "aws", "gcp", "azure", "devops",
  ]);
  const ENGLISH_STOPWORDS: ReadonlySet<string> = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "do", "does", "did", "will", "would", "can", "could", "should", "may",
    "might", "shall", "to", "of", "in", "for", "on", "with", "at", "by",
    "from", "as", "into", "about", "this", "that", "these", "those", "it",
    "its", "or", "and", "but", "not", "no", "so", "than", "too", "very",
    "if", "then", "else", "when", "where", "which", "who", "whom", "how",
    "what", "why", "all", "each", "every", "both", "few", "more", "most",
    "other", "some", "such", "only", "own", "same", "also", "just", "one",
    "two", "here", "there", "now", "up", "out", "off", "over", "under",
    "i", "me", "my", "we", "us", "our", "you", "your", "he", "him", "his",
    "she", "her", "they", "them", "their", "has", "have", "had", "get",
    "got", "make", "made", "go", "went", "come", "came", "take", "took",
    "give", "gave", "see", "saw", "know", "knew", "think", "thought",
    "say", "said", "tell", "told", "find", "found", "use", "used",
    "mannerisms", "provided", "available", "following", "however",
  ]);
  const isPlausibleEnglishTopic = (s: string): boolean => {
    const lower = s.toLowerCase().replace(/[^a-z0-9\s.-]/g, "").trim();
    if (TECH_DOMAIN_TERMS.has(lower)) return true;
    const words = lower.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return false;
    if (words.length === 1 && !TECH_DOMAIN_TERMS.has(words[0]!)) return false;
    const contentWords = words.filter(w => !ENGLISH_STOPWORDS.has(w));
    return contentWords.length >= 2;
  };
  const isValidFocus = (s: string) => {
    if (s.length < 2 || s.length > 30 || /^```/.test(s) || /^[^\p{L}\p{N}]+$/u.test(s)) return false;
    if (!hasCJK(s) && !isPlausibleEnglishTopic(s)) return false;
    return true;
  };
  const isValidQuestion = (s: string) =>
    s.length >= 4 && s.length <= 100 && !s.includes("\\n") && !/[#*_~`>|]{3,}/.test(s)
    && !/^ou_[a-f0-9]{20,}/.test(s) && !/[\"\\]]$/.test(s.trim());

  const newRecentFocus = [...new Set([...extraction.recentFocus, ...persona.recentFocus])]
    .filter(isValidFocus)
    .slice(0, 10);

  const newPendingQuestions = [
    ...new Set([...extraction.pendingQuestions, ...persona.pendingQuestions]),
  ]
    .filter(isValidQuestion)
    .slice(0, 10);

  // Update rapport
  const newRapport: RapportMetrics = {
    ...persona.rapport,
    totalExchanges: persona.rapport.totalExchanges + 1,
  };

  const mentionedDomains = extraction.domains.map((d) => d.name);
  const baseGraph = persona.domainGraph ?? seedDomainGraph();
  const coOccurrenceGraph = mentionedDomains.length >= 2
    ? observeCoOccurrence(baseGraph, mentionedDomains, now)
    : baseGraph;
  const updatedGraph = decayEdges(coOccurrenceGraph, now, EDGE_DECAY_HALF_LIFE_MS);

  const newMoodHistory = [...(persona.moodHistory ?? [])];
  if (extraction.sentiment) {
    const prev = newMoodHistory.slice(-2);
    const prevPositive = prev.some(s => s.sentiment.label === "excited" || s.sentiment.label === "positive");
    const currNegative = extraction.sentiment.label === "frustrated" || extraction.sentiment.label === "negative";
    const currPositive = extraction.sentiment.label === "excited" || extraction.sentiment.label === "positive";
    const trend = prevPositive && currNegative ? "declining" : !prevPositive && currPositive ? "improving" : "stable";
    newMoodHistory.push({ sentiment: extraction.sentiment, timestamp: now, trend });
  }

  const newLifecycle = { ...persona.lifecycle, lastActiveAt: now };
  const prevActiveDate = new Date(persona.lifecycle.lastActiveAt).toDateString();
  const currActiveDate = new Date(now).toDateString();
  if (prevActiveDate !== currActiveDate) {
    newLifecycle.totalActiveDays += 1;
  }
  const prevStage = newLifecycle.stage;
  if (prevStage === "dormant" || prevStage === "lapsed") {
    newLifecycle.stage = "active";
  }
  const nextStage = computeLifecycleStage(newLifecycle, newRapport.totalExchanges, now);
  if (nextStage !== newLifecycle.stage) {
    newLifecycle.stage = nextStage;
    newLifecycle.lastStageTransitionAt = now;
  }

  const expertDomains: string[] = [];
  const interestDomains: string[] = [];
  const curiosityDomains: string[] = [];
  for (const [name, node] of Object.entries(newDomains)) {
    if (node.depth >= 4 && node.recurrence >= 10) expertDomains.push(name);
    else if (node.depth >= 2) interestDomains.push(name);
    else if (node.depth >= 1) curiosityDomains.push(name);
  }

  const newIdentity = {
    ...persona.identity,
    coreTraits: newCoreTraits,
    expertDomains: expertDomains.length > 0 ? expertDomains : persona.identity.expertDomains,
    interestDomains: interestDomains.length > 0 ? interestDomains : persona.identity.interestDomains,
    curiosityDomains: curiosityDomains.length > 0 ? curiosityDomains : persona.identity.curiosityDomains,
  };

  return {
    ...persona,
    identity: newIdentity,
    domains: newDomains,
    recentFocus: newRecentFocus,
    pendingQuestions: newPendingQuestions,
    rapport: newRapport,
    domainGraph: updatedGraph,
    moodHistory: newMoodHistory.slice(-10),
    domainBlacklist: newBlacklist,
    lifecycle: newLifecycle,
    contradictionLog: pruneContradictionLog([...persona.contradictionLog, ...contradictions]),
  };
}

function mergeConfidenceValue(
  existing: ConfidenceValue | undefined,
  incoming: ConfidenceValue,
  now: number,
): ConfidenceValue {
  if (!existing) return incoming;

  // Weighted confidence update: more evidence = more stable
  const totalEvidence = existing.evidenceCount + 1;
  const existingWeight = existing.evidenceCount / totalEvidence;
  const incomingWeight = 1 / totalEvidence;
  const blendedConfidence =
    existing.confidence * existingWeight + incoming.confidence * incomingWeight;

  // If value changed, lower confidence unless new source is explicit
  const valueChanged = existing.value !== incoming.value;
  const adjustedConfidence =
    valueChanged && incoming.source !== "explicit" ? blendedConfidence * 0.8 : blendedConfidence;

  return {
    value: incoming.source === "explicit" ? incoming.value : existing.value,
    confidence: Math.min(1, adjustedConfidence),
    evidenceCount: totalEvidence,
    lastUpdated: now,
    source: incoming.source === "explicit" ? "explicit" : existing.source,
  };
}

/**
 * Prune persona to keep it manageable.
 * - Remove traits with very low confidence after many observations
 * - Remove domains not mentioned in 30 days
 * - Cap list sizes
 */
export function prunePersona(persona: PersonaTree, nowMs?: number): PersonaTree {
  const now = nowMs ?? Date.now();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  // Prune low-confidence traits (confidence < 0.2 after 5+ observations)
  const prunedTraits: Record<string, ConfidenceValue> = {};
  for (const [key, val] of Object.entries(persona.identity.coreTraits)) {
    if (val.evidenceCount >= 5 && val.confidence < 0.2) continue;
    prunedTraits[key] = val;
  }

  // Prune stale domains
  const prunedDomains: Record<string, DomainNode> = {};
  for (const [name, domain] of Object.entries(persona.domains)) {
    if (now - domain.lastMentioned > THIRTY_DAYS && domain.recurrence < 3) continue;
    if ((domain.negationSignals ?? 0) >= 3 && domain.depth < 2) continue;
    const cleanedInsights = domain.keyInsights.filter((s) => {
      if (s.length < 4 || s.length > 200) return false;
      for (const pat of INSIGHT_ECHO_PATTERNS) { if (pat.test(s)) return false; }
      return true;
    });
    prunedDomains[name] = { ...domain, keyInsights: cleanedInsights };
  }

  return {
    ...persona,
    identity: { ...persona.identity, coreTraits: prunedTraits },
    domains: prunedDomains,
  };
}
