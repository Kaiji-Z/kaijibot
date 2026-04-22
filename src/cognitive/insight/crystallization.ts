import { complete, type Api, type Model } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import { prepareSimpleCompletionModel } from "../../agents/simple-completion-runtime.js";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import type { Fragment, FragmentCluster, BlindSpotCandidate } from "./fragment-types.js";
import type { FragmentStore } from "./fragment-store.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/crystallization");

const MAX_LLM_CALLS_PER_RUN = 3;
const DOMAIN_OVERLAP_THRESHOLD = 0.7;

// ─── Deps ───

export type CrystallizationDeps = {
  complete: typeof complete;
  prepareModel: (
    cfg: KaijiBotConfig,
    modelRef?: string,
  ) => Promise<
    | { model: Model<Api>; auth: ResolvedProviderAuth }
    | { error: string }
  >;
  loadFragments: (userId: string) => Promise<Fragment[]>;
  saveFragments: (userId: string, fragments: Fragment[]) => Promise<void>;
  findClusters: (userId: string) => Promise<FragmentCluster[]>;
  touchFragments: (userId: string, fragmentIds: string[]) => Promise<void>;
};

export function createCrystallizationDepsFromStore(
  fragmentStore: FragmentStore,
): CrystallizationDeps {
  return {
    complete,
    prepareModel: async (cfg, modelRef) => {
      const extractionModel = cfg.cognitive?.persona?.extractionModel;
      const modelRefToUse = modelRef ?? extractionModel ?? "zai/glm-5-turbo";
      const [provider, ...modelParts] = modelRefToUse.split("/");
      const modelId = modelParts.join("/") || "glm-5-turbo";
      return prepareSimpleCompletionModel({ cfg, provider, modelId });
    },
    loadFragments: (userId) => fragmentStore.load(userId),
    saveFragments: (userId, fragments) => fragmentStore.save(userId, fragments),
    findClusters: (userId) => fragmentStore.findClusters(userId),
    touchFragments: async (userId, ids) => {
      for (const id of ids) {
        await fragmentStore.touchFragment(userId, id);
      }
    },
  };
}

// ─── Mode ───

export type CrystallizationMode = "signal" | "deep_scan";

// ─── Main ───

/**
 * Synthesize FragmentClusters into BlindSpotCandidates via LLM.
 *
 * This function **never throws** — all errors are caught and result in
 * an empty (or partial) array being returned.
 */
export async function crystallize(
  userId: string,
  persona: PersonaTree,
  config: KaijiBotConfig,
  deps: CrystallizationDeps,
  mode: CrystallizationMode = "signal",
): Promise<BlindSpotCandidate[]> {
  try {
    const allClusters = await deps.findClusters(userId);
    if (allClusters.length === 0) return [];

    const targetClusters =
      mode === "deep_scan"
        ? allClusters
        : filterNewlyRipeClusters(allClusters, persona);

    if (targetClusters.length === 0) return [];

    const allFragments = await deps.loadFragments(userId);
    const fragmentMap = new Map<string, Fragment>(
      allFragments.map((f) => [f.id, f]),
    );

    const candidates: BlindSpotCandidate[] = [];
    const limit = Math.min(targetClusters.length, MAX_LLM_CALLS_PER_RUN);

    for (let i = 0; i < limit; i++) {
      const cluster = targetClusters[i];
      const clusterFragments = cluster.fragmentIds
        .map((id) => fragmentMap.get(id))
        .filter((f): f is Fragment => f !== undefined);

      if (clusterFragments.length < 3) continue;

      const result = await synthesizeBlindSpot(
        cluster,
        clusterFragments,
        persona,
        config,
        deps,
      );

      if (result) {
        candidates.push(result);
        await deps.touchFragments(userId, cluster.fragmentIds).catch((err) => {
          log.warn("touchFragments failed", { error: String(err) });
        });
      }
    }

    if (candidates.length > 0) {
      log.info("crystallized blind spots", { userId, count: candidates.length, mode });
    }

    return candidates;
  } catch (err) {
    log.warn("crystallize failed", { error: String(err) });
    return [];
  }
}

// ─── Domain overlap dedup ───

function computeDomainOverlap(
  clusterDomains: string[],
  blindSpotDomains: string[],
): number {
  if (clusterDomains.length === 0 && blindSpotDomains.length === 0) return 0;
  const setA = new Set(clusterDomains);
  const setB = new Set(blindSpotDomains);
  let shared = 0;
  for (const d of setA) {
    if (setB.has(d)) shared++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : shared / union;
}

function filterNewlyRipeClusters(
  clusters: FragmentCluster[],
  persona: PersonaTree,
): FragmentCluster[] {
  const activeBlindSpots = persona.activeBlindSpots ?? [];

  return clusters.filter((cluster) => {
    for (const bs of activeBlindSpots) {
      const overlap = computeDomainOverlap(cluster.domains, bs.domains);
      if (overlap > DOMAIN_OVERLAP_THRESHOLD) {
        return false;
      }
    }
    return true;
  });
}

// ─── LLM synthesis ───

async function synthesizeBlindSpot(
  cluster: FragmentCluster,
  fragments: Fragment[],
  persona: PersonaTree,
  config: KaijiBotConfig,
  deps: CrystallizationDeps,
): Promise<BlindSpotCandidate | null> {
  try {
    const domainNames = Object.keys(persona.domains).slice(0, 10);
    const expertDomains = persona.identity.expertDomains ?? [];
    const unusedDomains = expertDomains.filter(
      (d) => !cluster.domains.includes(d),
    );

    const fragmentSummaries = fragments
      .slice(0, 6)
      .map(
        (f) =>
          `[${f.kind}] "${f.evidence}" (domains: ${f.domains.join(", ")}, strength: ${f.strength.toFixed(2)})`,
      )
      .join("\n");

    const prompt = `You are a cognitive blind-spot detector. Synthesize the following thinking-pattern fragments into a single blind-spot insight.

Cluster pattern: ${cluster.structuralPattern}
Cluster domains: ${cluster.domains.join(", ")}
Average strength: ${cluster.averageStrength.toFixed(2)}

Fragments:
${fragmentSummaries}

User's known domains: ${domainNames.join(", ") || "(not yet established)"}
Unused expert domains: ${unusedDomains.join(", ") || "(none)"}

Identify ONE blind spot — a non-obvious connection, assumption gap, or missed perspective.

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "blindSpot": "one clear sentence describing the blind spot",
  "potentialImpact": "direction_change" | "efficiency_gain" | "risk_avoidance" | "connection_reveal",
  "crystallizationScore": 0.0-1.0
}`;

    const modelRef = config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);

    if ("error" in prepared) {
      log.warn("crystallization model preparation failed, skipping cluster", {
        error: prepared.error,
      });
      return null;
    }

    const result = await deps.complete(
      prepared.model,
      {
        messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: 400,
        temperature: 0.7,
        signal: AbortSignal.timeout(12_000),
      },
    );

    const text = result.content
      .filter(
        (block): block is { type: "text"; text: string } =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) return null;

    return parseBlindSpot(text, fragments, cluster.domains, unusedDomains);
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    log.warn(
      `synthesizeBlindSpot ${isTimeout ? "timed out" : "failed"}: ${String(err)}`,
    );
    return null;
  }
}

// ─── Response parser ───

const VALID_IMPACTS = new Set<string>([
  "direction_change",
  "efficiency_gain",
  "risk_avoidance",
  "connection_reveal",
]);

export function parseBlindSpot(
  text: string,
  fragments: Fragment[],
  domains: string[],
  unusedDomains: string[],
): BlindSpotCandidate | null {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    const jsonStr = cleaned.slice(start, end + 1);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      log.warn("parseBlindSpot: JSON parse failed", {
        raw: jsonStr.slice(0, 200),
      });
      return null;
    }

    if (typeof parsed !== "object" || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;

    const blindSpot = obj.blindSpot;
    if (typeof blindSpot !== "string" || blindSpot.trim().length === 0) {
      return null;
    }

    const rawImpact = obj.potentialImpact;
    const potentialImpact: BlindSpotCandidate["potentialImpact"] =
      typeof rawImpact === "string" && VALID_IMPACTS.has(rawImpact)
        ? (rawImpact as BlindSpotCandidate["potentialImpact"])
        : "connection_reveal";

    const rawScore = obj.crystallizationScore;
    const crystallizationScore =
      typeof rawScore === "number"
        ? Math.max(0, Math.min(1, rawScore))
        : 0.5;

    return {
      id: randomUUID(),
      blindSpot: blindSpot.trim(),
      supportingFragmentIds: fragments.map((f) => f.id),
      potentialImpact,
      domains,
      unusedDomains,
      crystallizationScore,
    };
  } catch (err) {
    log.warn("parseBlindSpot: unexpected error", { error: String(err) });
    return null;
  }
}
