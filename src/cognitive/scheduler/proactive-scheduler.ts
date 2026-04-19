import type { PersonaTree } from "../types.js";
import type { SchedulerEvent, SchedulerConfig, GateContext, Opportunity } from "./types.js";
import { computeGradedGate } from "./gate.js";
import type { InsightCandidate, InsightEngineInput } from "../insight/types.js";
import { generateInsightCandidates } from "../insight/engine.js";
import { findCrossDomainConnections } from "../insight/cross-domain-mapper.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/scheduler");

function computeDomainOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b.map((d) => d.toLowerCase()));
  const overlap = a.filter((d) => setB.has(d.toLowerCase())).length;
  return overlap / Math.max(a.length, b.length);
}

function isDuplicateByDomainOverlap(
  newDomains: string[],
  recentDomains: string[][],
): boolean {
  for (const prev of recentDomains) {
    if (computeDomainOverlap(newDomains, prev) > 0.5) return true;
  }
  return false;
}

export type InsightGeneratorFn = (persona: PersonaTree, input: InsightEngineInput, options?: { verificationLevel?: "basic" | "strict" | "paranoid"; maxCandidates?: number }) => Promise<InsightCandidate[]>;

export class ProactiveScheduler {
  private timerHandle: ReturnType<typeof setTimeout> | undefined;
  private readonly generateInsights: InsightGeneratorFn;

  constructor(
    private readonly config: SchedulerConfig,
    private readonly callbacks: {
      loadPersona: (userId: string) => Promise<PersonaTree | undefined>;
      onInsightReady: (userId: string, candidate: InsightCandidate) => Promise<void>;
      savePersona: (userId: string, persona: PersonaTree) => Promise<void>;
    },
    deps?: {
      insightGenerator?: InsightGeneratorFn;
    },
  ) {
    this.generateInsights = deps?.insightGenerator ?? defaultInsightGenerator;
  }

  search(persona: PersonaTree, event: SchedulerEvent): Opportunity[] {
    const opportunities: Opportunity[] = [];
    const domains = Object.keys(persona.domains);

    switch (event.type) {
      case "timer":
      case "external":
        opportunities.push(...scanCrossDomain(persona));
        opportunities.push(...scanPendingQuestions(persona));
        opportunities.push(...scanDomainDepth(persona));
        break;
      case "persona_change":
        opportunities.push(...scanPersonaChange(persona, event));
        opportunities.push(...scanDomainDepth(persona));
        break;
      case "info_scan":
        opportunities.push(...scanCrossDomain(persona));
        opportunities.push(...scanPendingQuestions(persona));
        opportunities.push(...scanDomainDepth(persona));
        opportunities.push(...scanInfoScan(persona, event));
        break;
    }

    opportunities.push(...scanExploration(persona, event));

    return filterBlacklistedOpportunities(opportunities, persona.domainBlacklist);
  }

  identify(opportunities: Opportunity[]): Opportunity | null {
    if (opportunities.length === 0) return null;

    const cfn = this.config.costFalseNegative ?? DEFAULT_C_FN;
    const cfa = this.config.costFalseAlarm ?? DEFAULT_C_FA;
    const threshold = cfa / (cfn + cfa);

    const sorted = [...opportunities].sort((a, b) => b.pAct - a.pAct);
    const best = sorted[0];
    if (!best || best.pAct <= threshold) return null;

    return best;
  }

  async resolve(persona: PersonaTree, opportunity: Opportunity): Promise<InsightCandidate | null> {
    const recentInsightIds = persona.feedbackProfile.recentInsightIds ?? [];
    const recentInsightContents = persona.feedbackProfile.recentInsightContents ?? [];
    const candidates = await this.generateInsights(
      persona,
      {
        targetDomains: opportunity.targetDomains.length > 0
          ? opportunity.targetDomains
          : Object.keys(persona.domains),
        recentFocus: persona.recentFocus,
        pendingQuestions: persona.pendingQuestions,
        trustScore: persona.rapport.trustScore,
        recentInsightIds,
        recentInsightContents,
      },
      {
        verificationLevel: "basic",
        maxCandidates: 1,
      },
    );

    return candidates[0] ?? null;
  }

  async processEvent(
    userId: string,
    event: SchedulerEvent,
  ): Promise<InsightCandidate | undefined> {
    const persona = await this.callbacks.loadPersona(userId);
    if (!persona) return undefined;

    const gateContext: GateContext = {
      persona,
      event,
      recentInsightCount: 0,
      config: this.config,
    };
    const gateResult = computeGradedGate(gateContext);
    if (!gateResult.decision) {
      log.info("gate vetoed", { userId, pNeed: gateResult.pNeed, pAct: gateResult.pNeed * gateResult.pAccept, reasons: gateResult.reasons });
      return undefined;
    }
    log.info("gate passed", { userId, pNeed: gateResult.pNeed, pAccept: gateResult.pAccept, pAct: gateResult.pNeed * gateResult.pAccept });

    const opportunities = this.search(persona, event);
    log.info("search found opportunities", { userId, count: opportunities.length });
    const selected = this.identify(opportunities);
    if (!selected) {
      log.info("identify selected nothing", { userId });
      return undefined;
    }
    log.info("identify selected", { userId, type: selected.type, targetDomains: selected.targetDomains, pAct: selected.pAct });

    const insight = await this.resolve(persona, selected);
    if (!insight) return undefined;

    const recentDomains = persona.feedbackProfile.recentInsightDomains ?? [];
    if (recentDomains.length > 0 && isDuplicateByDomainOverlap(insight.targetDomains, recentDomains)) {
      log.info("dedup: domain overlap", {
        userId,
        newDomains: insight.targetDomains,
        recentDomains,
      });
      return undefined;
    }

    log.info("insight generated", {
      userId,
      insightId: insight.id,
      contentPreview: insight.content.slice(0, 80),
      sourceCount: insight.sources.length,
      hasWebSources: insight.sources.length > 0,
      targetDomains: insight.targetDomains,
    });

    await this.callbacks.onInsightReady(userId, insight);

    persona.feedbackProfile.lastProactiveAt = event.timestamp;
    const ids = [...(persona.feedbackProfile.recentInsightIds ?? []), insight.id].slice(-20);
    persona.feedbackProfile.recentInsightIds = ids;
    const contents = [...(persona.feedbackProfile.recentInsightContents ?? []), insight.content].slice(-5);
    persona.feedbackProfile.recentInsightContents = contents;
    const insightDomains = [...(persona.feedbackProfile.recentInsightDomains ?? []), insight.targetDomains].slice(-5);
    persona.feedbackProfile.recentInsightDomains = insightDomains;
    const insightTypes = [...(persona.feedbackProfile.recentInsightTypes ?? []), selected.type].slice(-5);
    persona.feedbackProfile.recentInsightTypes = insightTypes;
    await this.callbacks.savePersona(userId, persona);

    return insight;
  }

  start(listUserIds: () => Promise<string[]>, intervalMs?: number): void {
    const baseInterval =
      intervalMs ?? this.config.minIntervalHours * 60 * 60 * 1000;

    const scheduleNext = (): void => {
      const jitter = baseInterval * (0.5 + Math.random());
      this.timerHandle = setTimeout(tick, jitter);
      this.timerHandle?.unref?.();
    };

    const tick = async (): Promise<void> => {
      const userIds = await listUserIds();
      log.info("timer tick", { userCount: userIds.length, baseInterval });
      for (const userId of userIds) {
        try {
          const result = await this.processEvent(userId, {
            type: "timer",
            timestamp: Date.now(),
          });
          log.info("processEvent done", { userId, result: result ? "insight generated" : "no insight" });
        } catch (err) {
          log.warn("tick failed", { userId, error: String(err) });
        }
      }

      scheduleNext();
    };

    scheduleNext();
  }

  stop(): void {
    if (this.timerHandle !== undefined) {
      clearTimeout(this.timerHandle);
      this.timerHandle = undefined;
    }
  }
}

const DEFAULT_C_FN = 3.0;
const DEFAULT_C_FA = 1.0;

const defaultInsightGenerator: InsightGeneratorFn = (persona, input, options) => {
  return Promise.resolve(generateInsightCandidates(persona, input, options));
};

function scanCrossDomain(persona: PersonaTree): Opportunity[] {
  const userDomains = Object.keys(persona.domains);
  if (userDomains.length === 0) return [];

  const connections = findCrossDomainConnections(userDomains);
  const pAccept = computeBaselinePAccept(persona);

  return connections.slice(0, 3).map((conn) => {
    const fromDomain = persona.domains[conn.from];
    const depthFactor = fromDomain ? Math.min(fromDomain.depth / 5, 1) : 0.3;
    const pNeed = 0.5 * depthFactor + 0.3;

    return {
      type: "cross_domain" as const,
      targetDomains: [conn.from],
      sourceDomains: [conn.to],
      pNeed,
      pAccept,
      pAct: pNeed * pAccept,
      metadata: { bridge: conn.bridge, distance: conn.distance },
    };
  });
}

function scanPendingQuestions(persona: PersonaTree): Opportunity[] {
  if (persona.pendingQuestions.length === 0) return [];

  const pAccept = computeBaselinePAccept(persona);
  const domains = Object.keys(persona.domains);

  return persona.pendingQuestions.slice(0, 3).map((question) => {
    const relevantDomain = domains.find(
      (name) => question.includes(name.split("/")[0]) || question.includes(name),
    );
    const pNeed = relevantDomain ? 0.8 : 0.5;

    return {
      type: "pending_question" as const,
      targetDomains: relevantDomain ? [relevantDomain] : domains.slice(0, 1),
      sourceDomains: [],
      pNeed,
      pAccept,
      pAct: pNeed * pAccept,
      metadata: { question },
    };
  });
}

function scanDomainDepth(persona: PersonaTree): Opportunity[] {
  const pAccept = computeBaselinePAccept(persona);
  const now = Date.now();

  return Object.entries(persona.domains)
    .filter(([, d]) => d.depth >= 3)
    .sort(([, a], [, b]) => {
      const recencyDelta = a.lastMentioned - b.lastMentioned;
      if (Math.abs(recencyDelta) > 24 * 60 * 60 * 1000) return -recencyDelta;
      return b.depth - a.depth;
    })
    .slice(0, 2)
    .map(([domainName, domain]) => {
      const daysSinceMention = (now - domain.lastMentioned) / (24 * 60 * 60 * 1000);
      const recencyBoost = Math.max(0, 1 - daysSinceMention / 7);
      const pNeed = 0.3 + 0.1 * Math.min(domain.depth, 8) + 0.2 * recencyBoost;

      return {
        type: "domain_depth" as const,
        targetDomains: [domainName],
        sourceDomains: [],
        pNeed,
        pAccept,
        pAct: pNeed * pAccept,
      };
    });
}

function scanPersonaChange(persona: PersonaTree, event: SchedulerEvent): Opportunity[] {
  const pAccept = computeBaselinePAccept(persona);
  const payload = event.payload as { newDomains?: string[]; domainCount?: number } | undefined;
  const newDomains = payload?.newDomains ?? [];

  if (newDomains.length === 0) {
    return Object.keys(persona.domains).slice(0, 1).map((domain) => ({
      type: "cross_domain" as const,
      targetDomains: [domain],
      sourceDomains: [],
      pNeed: 0.7,
      pAccept,
      pAct: 0.7 * pAccept,
    }));
  }

  return newDomains.map((domain) => {
    const existingConnections = Object.keys(persona.domains).filter(
      (existing) => existing !== domain,
    );
    return {
      type: "cross_domain" as const,
      targetDomains: [domain],
      sourceDomains: existingConnections.slice(0, 2),
      pNeed: 0.9,
      pAccept,
      pAct: 0.9 * pAccept,
      metadata: { isNewDomain: true },
    };
  });
}

function scanInfoScan(persona: PersonaTree, _event: SchedulerEvent): Opportunity[] {
  const pAccept = computeBaselinePAccept(persona);
  const domains = Object.keys(persona.domains);

  return domains.slice(0, 2).map((domain) => ({
    type: "info_scan_hit" as const,
    targetDomains: [domain],
    sourceDomains: [],
    pNeed: 0.6,
    pAccept,
    pAct: 0.6 * pAccept,
    metadata: { scanDerived: true },
  }));
}

function computeBaselinePAccept(persona: PersonaTree): number {
  const trustFactor = persona.rapport.trustScore;
  const banditEntries = Object.entries(persona.feedbackProfile.topicBandits);

  let banditFactor = 0.5;
  if (banditEntries.length > 0) {
    const meanPosterior = banditEntries.reduce(
      (sum, [, b]) => sum + b.alpha / (b.alpha + b.beta),
      0,
    ) / banditEntries.length;
    banditFactor = meanPosterior;
  }

  return clamp01(0.5 * trustFactor + 0.5 * banditFactor);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Known universe of domains for exploration slot */
const KNOWN_UNIVERSE = [
  "AI",
  "architecture",
  "programming",
  "product",
  "business",
  "data science",
  "security",
  "cloud",
  "blockchain",
  "quantum computing",
  "digital art",
  "biotech",
  "psychology",
  "philosophy",
  "design thinking",
  "project management",
  "testing",
  "DevSecOps",
] as const;

/** Deterministic 20% exploration slot: picks an unknown domain */
function scanExploration(persona: PersonaTree, event: SchedulerEvent): Opportunity[] {
  if ((event.timestamp % 5) !== 0) return [];

  const userDomainKeys = Object.keys(persona.domains);
  if (userDomainKeys.length === 0) return [];

  const unknownDomains = KNOWN_UNIVERSE.filter(
    (domain) => !userDomainKeys.some((ud) => ud.toLowerCase().includes(domain.toLowerCase())),
  );

  if (unknownDomains.length === 0) return [];

  const index = Math.floor((event.timestamp / 7) % unknownDomains.length);
  const targetDomain = unknownDomains[index];

  const baseline = computeBaselinePAccept(persona);
  const pNeed = 0.5;
  const pAccept = baseline * 0.8;

  return [{
    type: "exploration" as const,
    targetDomains: [targetDomain],
    sourceDomains: [],
    pNeed,
    pAccept,
    pAct: pNeed * pAccept,
  }];
}

export function filterBlacklistedOpportunities(
  opportunities: Opportunity[],
  domainBlacklist: string[] | undefined,
): Opportunity[] {
  if (!domainBlacklist || domainBlacklist.length === 0) return opportunities;
  const blacklistSet = new Set(domainBlacklist);
  return opportunities.filter((opp) => {
    const hasBlacklistedTarget = opp.targetDomains.some((d) => blacklistSet.has(d));
    const hasBlacklistedSource = opp.sourceDomains.some((d) => blacklistSet.has(d));
    return !hasBlacklistedTarget && !hasBlacklistedSource;
  });
}
