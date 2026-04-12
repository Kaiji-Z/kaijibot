import type { PersonaTree } from "../types.js";
import type { SchedulerEvent, SchedulerConfig, GateContext, Opportunity } from "./types.js";
import { computeGradedGate } from "./gate.js";
import type { InsightCandidate, InsightEngineInput } from "../insight/types.js";
import { generateInsightCandidates } from "../insight/engine.js";
import { findCrossDomainConnections } from "../insight/cross-domain-mapper.js";

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

    return opportunities;
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
    const recentInsightIds: string[] = [];
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
    if (!gateResult.decision) return undefined;

    const opportunities = this.search(persona, event);
    const selected = this.identify(opportunities);
    if (!selected) return undefined;

    const insight = await this.resolve(persona, selected);
    if (!insight) return undefined;

    await this.callbacks.onInsightReady(userId, insight);

    persona.feedbackProfile.lastProactiveAt = event.timestamp;
    await this.callbacks.savePersona(userId, persona);

    return insight;
  }

  start(userId: string, intervalMs?: number): void {
    const interval =
      intervalMs ?? this.config.minIntervalHours * 60 * 60 * 1000;

    const tick = async (): Promise<void> => {
      await this.processEvent(userId, {
        type: "timer",
        timestamp: Date.now(),
      });

      this.timerHandle = setTimeout(tick, interval);
      this.timerHandle?.unref?.();
    };

    this.timerHandle = setTimeout(tick, interval);
    this.timerHandle?.unref?.();
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

  return Object.entries(persona.domains)
    .filter(([, d]) => d.depth >= 4)
    .slice(0, 2)
    .map(([domainName, domain]) => {
      const pNeed = 0.4 + 0.1 * Math.min(domain.depth, 8);

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
