import type { PersonaTree, ConfidenceValue, DomainNode, RapportMetrics, TypedInsight, InsightCategory, InterestPhase } from "../types.js";
import type { ExtractionResult, ExtractedAttribute, ExtractedInsight } from "./types.js";
import { observeCoOccurrence, seedDomainGraph, decayEdges } from "../insight/cross-domain-mapper.js";
import { computeLifecycleStage, getDecayMultiplier } from "./lifecycle.js";
import { detectContradictions } from "./contradiction-resolver.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
const log = createSubsystemLogger("cognitive/persona-curator");

const DOMAIN_DEPTH_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const EDGE_DECAY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
const AUTO_BLACKLIST_NEGATION_THRESHOLD = 3;
const AUTO_BLACKLIST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const HALF_LIFE_BY_CATEGORY: Record<InsightCategory, number> = {
  tool_config: 7,
  contextual_fact: 14,
  domain_knowledge: 30,
  stated_preference: 60,
  behavioral_pattern: 90,
  goal_or_aspiration: 90,
};

const BACKWARD_COMPAT_EXCLUDE_CATEGORIES: ReadonlySet<InsightCategory> = new Set([
  "tool_config",
  "contextual_fact",
]);

const INSIGHT_ECHO_PATTERNS: ReadonlyArray<RegExp> = [
  /receives?\s+(automated\s+)?cognitive\s+insight/i,
  /最近出现了?一些值得关注的新方向/,
  /结合你在这个领域的深度理解/,
  /可能会影响你的技术决策/,
  /cognitive insight (notifications?|alerts?)/i,
  /new (trends|directions) in this (field|domain)/i,
];

function computeInterestPhase(domain: DomainNode, nowMs: number): InterestPhase {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  const ageSinceLastMention = nowMs - domain.lastMentioned;
  const prevPhase = domain.phase;

  const wasInactive = prevPhase === "dormant" || prevPhase === "declining";
  const isNowActive = ageSinceLastMention < SEVEN_DAYS_MS;

  if (wasInactive && isNowActive) return "revived";
  if (ageSinceLastMention > THIRTY_DAYS_MS) return "dormant";
  if (ageSinceLastMention > FOURTEEN_DAYS_MS) return "declining";
  if (domain.recurrence <= 2) return "emergent";
  if (domain.recurrence > 5 && ageSinceLastMention < SEVEN_DAYS_MS) return "stable";

  return prevPhase ?? "emergent";
}

function toTypedInsight(extracted: ExtractedInsight, nowMs: number): TypedInsight {
  return {
    text: extracted.text,
    category: extracted.category,
    confidence: extracted.confidence,
    source: extracted.source,
    firstObserved: nowMs,
    lastReinforced: nowMs,
    evidenceCount: 1,
    halfLifeDays: HALF_LIFE_BY_CATEGORY[extracted.category],
  };
}

function textSimilar(a: string, b: string): boolean {
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (normA === normB) return true;
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return true;
  const distance = levenshteinDistance(normA, normB);
  return distance / maxLen < 0.3;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    const prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
    }
  }
  return dp[n];
}

function mergeTypedInsights(existing: TypedInsight[], incoming: TypedInsight[]): TypedInsight[] {
  const result = [...existing];
  for (const inc of incoming) {
    let matched = false;
    for (let i = 0; i < result.length; i++) {
      if (textSimilar(result[i]!.text, inc.text)) {
        const ex = result[i]!;
        const totalEvidence = ex.evidenceCount + 1;
        const existingWeight = ex.evidenceCount / totalEvidence;
        const incomingWeight = 1 / totalEvidence;
        result[i] = {
          ...ex,
          confidence: Math.min(1, ex.confidence * existingWeight + inc.confidence * incomingWeight),
          evidenceCount: totalEvidence,
          lastReinforced: inc.lastReinforced,
          source: inc.source === "explicit" ? "explicit" : ex.source,
        };
        matched = true;
        break;
      }
    }
    if (!matched) {
      result.push(inc);
    }
  }
  return result.slice(-20);
}

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

    const incomingTyped = (domain.typedInsights ?? []).map(ei => toTypedInsight(ei, now));
    const backwardCompatTexts = incomingTyped
      .filter(ti => !BACKWARD_COMPAT_EXCLUDE_CATEGORIES.has(ti.category))
      .map(ti => ti.text)
      .filter(isPlausibleKeyInsight);

    if (existing) {
      const mergedInsights = incomingTyped.length > 0
        ? mergeTypedInsights(existing.insights ?? [], incomingTyped)
        : existing.insights;

      const prevPhase = existing.phase;
      const newPhase = computeInterestPhase({ ...existing, recurrence: existing.recurrence + 1, lastMentioned: now }, now);
      const phaseChanged = prevPhase !== newPhase;
      if (phaseChanged) {
        log.info("domain phase transition", { domain: domain.name, from: prevPhase, to: newPhase });
      }

      newDomains[domain.name] = {
        ...existing,
        depth: Math.max(existing.depth, domain.depth),
        recurrence: existing.recurrence + 1,
        lastMentioned: now,
        keyInsights: [...new Set([...existing.keyInsights, ...domain.insights.filter(isPlausibleKeyInsight), ...backwardCompatTexts])].slice(-20),
        insights: mergedInsights,
        activeQuestions: [...new Set([...existing.activeQuestions, ...domain.questions])].slice(-10),
        negationSignals: existing.negationSignals ?? 0,
        phase: newPhase,
        phaseEnteredAt: phaseChanged ? now : existing.phaseEnteredAt,
      };
    } else {
      const freshNode: DomainNode = {
        depth: domain.depth,
        recurrence: 1,
        lastMentioned: now,
        keyInsights: [...domain.insights.filter(isPlausibleKeyInsight), ...backwardCompatTexts],
        insights: incomingTyped.length > 0 ? incomingTyped : undefined,
        activeQuestions: domain.questions,
        negationSignals: 0,
      };
      freshNode.phase = computeInterestPhase(freshNode, now);
      freshNode.phaseEnteredAt = now;
      log.info("new domain discovered", { domain: domain.name, depth: freshNode.depth.toFixed(1), insights: freshNode.insights?.length ?? 0 });
      newDomains[domain.name] = freshNode;
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

  const displayName = newCoreTraits["称呼"]?.confidence >= 0.5
    ? String(newCoreTraits["称呼"].value)
    : persona.identity.displayName;
  log.info("displayName synced", { displayName, source: newCoreTraits["称呼"]?.confidence >= 0.5 ? "coreTraits" : "existing" });

  const newIdentity = {
    ...persona.identity,
    coreTraits: newCoreTraits,
    displayName,
    expertDomains: expertDomains.length > 0 ? expertDomains : persona.identity.expertDomains,
    interestDomains: interestDomains.length > 0 ? interestDomains : persona.identity.interestDomains,
    curiosityDomains: curiosityDomains.length > 0 ? curiosityDomains : persona.identity.curiosityDomains,
  };

  return {
    ...persona,
    identity: newIdentity,
    domains: newDomains,
    recentFocus: newRecentFocus,
    rapport: newRapport,
    domainGraph: updatedGraph,
    moodHistory: newMoodHistory.slice(-10),
    domainBlacklist: newBlacklist,
    lifecycle: newLifecycle,
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
    const decayedTypedInsights = (domain.insights ?? [])
      .map(ti => {
        const ageMs = now - ti.lastReinforced;
        const halfLifeMs = ti.halfLifeDays * 24 * 60 * 60 * 1000;
        const decayFactor = Math.exp((-Math.LN2 * ageMs) / halfLifeMs);
        return { ...ti, confidence: ti.confidence * decayFactor };
      })
      .filter(ti => ti.confidence >= 0.1);
    const updatedDomain: DomainNode = { ...domain, keyInsights: cleanedInsights };
    if (domain.insights !== undefined || decayedTypedInsights.length > 0) {
      updatedDomain.insights = decayedTypedInsights.length > 0 ? decayedTypedInsights : undefined;
    }
    prunedDomains[name] = updatedDomain;
  }

  return {
    ...persona,
    identity: { ...persona.identity, coreTraits: prunedTraits },
    domains: prunedDomains,
  };
}
