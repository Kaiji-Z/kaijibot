import { complete, type Api, type Model } from "@mariozechner/pi-ai";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import { prepareSimpleCompletionModel } from "../../agents/simple-completion-runtime.js";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import type { BlindSpotCandidate, QualityAssessment } from "./fragment-types.js";
import { QUALITY_PILLAR_WEIGHTS, computeComposite, computeQualityVerdict } from "./fragment-types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/quality-gate");

// ─── Deps ───

export type QualityGateDeps = {
  complete: typeof complete;
  prepareModel: (cfg: KaijiBotConfig, modelRef?: string) => Promise<{ model: Model<Api>; auth: ResolvedProviderAuth } | { error: string }>;
};

export function createDefaultQualityGateDeps(): QualityGateDeps {
  return {
    complete,
    prepareModel: async (cfg, modelRef) => {
      const extractionModel = cfg.cognitive?.persona?.extractionModel;
      const modelRefToUse = modelRef ?? extractionModel ?? "zai/glm-5-turbo";
      const [provider, ...modelParts] = modelRefToUse.split("/");
      const modelId = modelParts.join("/") || "glm-5-turbo";
      return prepareSimpleCompletionModel({ cfg, provider, modelId });
    },
  };
}

// ─── LLM: novelty + actionability ───

function buildNoveltyActionablePrompt(candidate: BlindSpotCandidate, persona: PersonaTree): string {
  const domainInsights = Object.entries(persona.domains)
    .filter(([domain]) => candidate.domains.includes(domain))
    .slice(0, 5)
    .map(([domain, node]) => `${domain}: ${node.keyInsights.slice(0, 3).join("; ")}`)
    .join("\n");

  return `Evaluate whether this insight is genuinely novel and actionable for THIS specific user.

User's existing knowledge in relevant domains:
${domainInsights || "(no domain context available)"}

Insight: ${candidate.blindSpot}
Domains: ${candidate.domains.join(", ")}
Impact type: ${candidate.potentialImpact}

Reason step by step:
1. Would this user already know this? (consider their domain expertise)
2. Could they act on this insight? (is it concrete or abstract?)
3. Does it connect to their actual interests in a non-obvious way?

Then answer in EXACTLY this format:
VERDICT: YES
SCORE: 0.85`;
}

async function computeNoveltyAndActionability(
  candidate: BlindSpotCandidate,
  persona: PersonaTree,
  config: KaijiBotConfig,
  deps: QualityGateDeps,
): Promise<{ score: number; verdict: "yes" | "no" }> {
  try {
    const modelRef = config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);
    if ("error" in prepared) {
      log.warn("noveltyActionable model preparation failed, returning neutral", { error: prepared.error });
      return { score: 0.5, verdict: "yes" };
    }

    const prompt = buildNoveltyActionablePrompt(candidate, persona);
    const messages: Array<{ role: "user"; content: string; timestamp: number }> = [
      { role: "user", content: prompt, timestamp: Date.now() },
    ];

    const result = await deps.complete(
      prepared.model,
      { messages },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: 200,
        temperature: 0.4,
        signal: AbortSignal.timeout(10_000),
      },
    );

    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    const verdictMatch = text.match(/VERDICT:\s*(YES|NO)/i);
    const scoreMatch = text.match(/SCORE:\s*([\d.]+)/);

    const verdict = verdictMatch?.[1]?.toUpperCase() === "NO" ? "no" as const : "yes" as const;
    const parsedScore = scoreMatch?.[1] ? parseFloat(scoreMatch[1]) : NaN;
    const score = Number.isNaN(parsedScore) ? 0.5 : Math.max(0, Math.min(parsedScore, 1));

    return { score, verdict };
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    log.warn(`noveltyActionable ${isTimeout ? "timed out" : "failed"}: ${String(err)}, returning neutral`);
    return { score: 0.5, verdict: "yes" };
  }
}

// ─── Heuristic: emotionalReadiness ───

const STAGE_MODIFIERS: Record<string, number> = {
  new: 0.1,
  active: 0.3,
  dormant: 0.1,
  lapsed: 0.05,
};

function computeEmotionalReadiness(persona: PersonaTree): number {
  if (persona.feedbackProfile.suppressUntil != null && persona.feedbackProfile.suppressUntil > Date.now()) {
    return 0.0;
  }

  const trustBase = persona.rapport.trustScore * 0.6;
  const stageModifier = STAGE_MODIFIERS[persona.lifecycle.stage] ?? 0.1;
  const firstInsightBoost = persona.feedbackProfile.recentInsightContents.length === 0 ? 0.1 : 0;

  return Math.max(0, Math.min(trustBase + stageModifier + firstInsightBoost, 1));
}

// ─── LLM: nonObviousness ───

function buildNonObviousnessPrompt(candidate: BlindSpotCandidate, persona: PersonaTree): string {
  const domainInsights = Object.entries(persona.domains)
    .filter(([domain]) => candidate.domains.includes(domain))
    .slice(0, 5)
    .map(([domain, node]) => `${domain}: ${node.keyInsights.slice(0, 3).join("; ")}`)
    .join("\n");

  return `Rate how non-obvious this insight would be to a domain expert (0.0 = completely obvious, 1.0 = genuinely surprising).

Blind spot: ${candidate.blindSpot}

Domains: ${candidate.domains.join(", ")}
Potential impact: ${candidate.potentialImpact}

Expert's existing knowledge in these domains:
${domainInsights || "(no domain context available)"}

Respond with ONLY a single number between 0.0 and 1.0. No explanation.`;
}

async function computeNonObviousness(
  candidate: BlindSpotCandidate,
  persona: PersonaTree,
  config: KaijiBotConfig,
  deps: QualityGateDeps,
): Promise<number> {
  try {
    const modelRef = config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);

    if ("error" in prepared) {
      log.warn("nonObviousness model preparation failed, returning neutral", { error: prepared.error });
      return 0.5;
    }

    const prompt = buildNonObviousnessPrompt(candidate, persona);
    const messages: Array<{ role: "user"; content: string; timestamp: number }> = [
      { role: "user", content: prompt, timestamp: Date.now() },
    ];

    const result = await deps.complete(
      prepared.model,
      { messages },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: 10,
        temperature: 0.3,
        signal: AbortSignal.timeout(8_000),
      },
    );

    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    const parsed = parseFloat(text);
    if (Number.isNaN(parsed)) {
      log.warn("nonObviousness: non-numeric LLM response, returning neutral", { raw: text.slice(0, 100) });
      return 0.5;
    }

    return Math.max(0, Math.min(parsed, 1));
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    log.warn(`nonObviousness ${isTimeout ? "timed out" : "failed"}: ${String(err)}, returning neutral`);
    return 0.5;
  }
}

// ─── Main: assessQuality ───

/**
 * Evaluate a BlindSpotCandidate against quality pillars.
 *
 * This function **never throws** — all errors degrade gracefully.
 */
export async function assessQuality(
  candidate: BlindSpotCandidate,
  persona: PersonaTree,
  config: KaijiBotConfig,
  deps: QualityGateDeps,
): Promise<QualityAssessment> {
  const { score: llmNoveltyActionable, verdict: llmVerdict } = await computeNoveltyAndActionability(candidate, persona, config, deps);
  const emotionalReadiness = computeEmotionalReadiness(persona);
  const nonObviousness = await computeNonObviousness(candidate, persona, config, deps);

  const composite = computeComposite({ llmNoveltyActionable, llmVerdict, emotionalReadiness, nonObviousness });
  const verdict = computeQualityVerdict(composite, llmVerdict);

  log.info("quality gate assessed", {
    verdict,
    composite: composite.toFixed(2),
    llmNoveltyActionable: llmNoveltyActionable.toFixed(2),
    llmVerdict,
    emotionalReadiness: emotionalReadiness.toFixed(2),
    nonObviousness: nonObviousness.toFixed(2),
    blindSpot: candidate.blindSpot.slice(0, 60),
  });

  return { llmNoveltyActionable, llmVerdict, emotionalReadiness, nonObviousness, composite, verdict };
}

export { computeEmotionalReadiness };
