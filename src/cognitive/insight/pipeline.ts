import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import type { InsightCandidate, InsightEngineInput } from "./types.js";
import type { Fragment, FragmentCluster, BlindSpotCandidate, QualityAssessment } from "./fragment-types.js";
import { FragmentStore } from "./fragment-store.js";
import {
  collectFragments,
  createDefaultFragmentCollectorDeps,
  type FragmentCollectorDeps,
} from "./fragment-collector.js";
import {
  crystallize,
  createCrystallizationDepsFromStore,
  type CrystallizationDeps,
  type CrystallizationMode,
} from "./crystallization.js";
import {
  assessQuality,
  createDefaultQualityGateDeps,
  type QualityGateDeps,
} from "./quality-gate.js";
import {
  composeInsight,
  createDefaultComposerDeps,
  type ComposerDeps,
} from "./composer.js";
import { computeTrigramSimilarity } from "./content-similarity.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/pipeline");

const COLD_START_THRESHOLD = 5;

// ─── Aggregated deps ───

export type PipelineDeps = {
  collector: FragmentCollectorDeps;
  crystallization: CrystallizationDeps;
  qualityGate: QualityGateDeps;
  composer: ComposerDeps;
  loadFragments: (userId: string) => Promise<Fragment[]>;
  addFragment: (userId: string, fragment: Fragment) => Promise<Fragment[]>;
  findClusters: (userId: string) => Promise<FragmentCluster[]>;
};

export type PipelineResult = {
  deliverable: InsightCandidate[];
  parked: Array<{ candidate: BlindSpotCandidate; assessment: QualityAssessment }>;
};

// ─── Pipeline class ───

export class InsightV2Pipeline {
  constructor(
    private readonly deps: PipelineDeps,
    private readonly v1Fallback: (
      persona: PersonaTree,
      input: InsightEngineInput,
    ) => Promise<InsightCandidate[]>,
  ) {}

  async generateInsight(
    persona: PersonaTree,
    input: InsightEngineInput,
    config: KaijiBotConfig,
  ): Promise<PipelineResult> {
    const userId = persona.identity?.userId;
    if (!userId) return { deliverable: [], parked: [] };

    // Cold start check
    const fragments = await this.deps.loadFragments(userId);
    if (fragments.length < COLD_START_THRESHOLD) {
      log.debug(`cold start for ${userId}: ${fragments.length} fragments, falling back to v1`);
      const v1Candidates = await this.v1Fallback(persona, input);
      return { deliverable: v1Candidates, parked: [] };
    }

    // Step 1: Crystallize
    const blindSpots = await crystallize(
      userId,
      persona,
      config,
      this.deps.crystallization,
      "signal" as CrystallizationMode,
    );
    if (blindSpots.length === 0) return { deliverable: [], parked: [] };

    // Step 2: Quality gate + compose
    const deliverable: InsightCandidate[] = [];
    const parked: PipelineResult["parked"] = [];

    for (const bs of blindSpots) {
      try {
        const assessment = await assessQuality(bs, persona, config, this.deps.qualityGate);

        if (assessment.verdict === "discard") {
          log.debug(`discarded blind spot: ${bs.blindSpot.slice(0, 50)}`);
          continue;
        }

        if (assessment.verdict === "park") {
          parked.push({ candidate: bs, assessment });
          log.debug(
            `parked blind spot (composite: ${assessment.composite.toFixed(2)}): ${bs.blindSpot.slice(0, 50)}`,
          );
          continue;
        }

        // verdict === "deliver"
        const insight = await composeInsight(bs, persona, config, this.deps.composer);
        if (insight) deliverable.push(insight);
      } catch (err) {
        log.warn(`error processing blind spot: ${String(err)}`);
        continue;
      }
    }

    return { deliverable, parked };
  }
}

// ─── Per-turn helper ───

export async function collectFragmentsForTurn(
  userId: string,
  userText: string,
  assistantText: string,
  persona: PersonaTree,
  config: KaijiBotConfig,
  deps: Pick<PipelineDeps, "collector" | "addFragment">,
): Promise<void> {
  if (!userId) return;
  const newFragments = await collectFragments(
    userText,
    assistantText,
    persona,
    config,
    deps.collector,
  );
  for (const frag of newFragments) {
    frag.userId = userId;
    await deps.addFragment(userId, frag);
  }
}

// ─── Factory ───

export function createPipelineDeps(configDir: string): PipelineDeps {
  const store = new FragmentStore(configDir);
  return {
    collector: createDefaultFragmentCollectorDeps(),
    crystallization: createCrystallizationDepsFromStore(store),
    qualityGate: createDefaultQualityGateDeps(),
    composer: createDefaultComposerDeps(),
    loadFragments: (userId) => store.load(userId),
    addFragment: (userId, fragment) => store.addFragment(userId, fragment),
    findClusters: (userId) => store.findClusters(userId),
  };
}

// ─── Adapter for ProactiveScheduler compatibility ───

export function createV2InsightGenerator(
  pipeline: InsightV2Pipeline,
  config: KaijiBotConfig,
): (persona: PersonaTree, input: InsightEngineInput) => Promise<InsightCandidate[]> {
  return async (persona, input) => {
    const result = await pipeline.generateInsight(persona, input, config);
    return result.deliverable;
  };
}

// ─── Dual pipeline (v1 + v2 in parallel) ───

export function createDualInsightGenerator(
  v1Generator: (persona: PersonaTree, input: InsightEngineInput) => Promise<InsightCandidate[]>,
  v2Generator: (persona: PersonaTree, input: InsightEngineInput) => Promise<InsightCandidate[]>,
): (persona: PersonaTree, input: InsightEngineInput) => Promise<InsightCandidate[]> {
  return async (persona, input) => {
    const [v1Result, v2Result] = await Promise.allSettled([
      v1Generator(persona, input),
      v2Generator(persona, input),
    ]);

    const candidates: InsightCandidate[] = [];

    if (v1Result.status === "fulfilled") {
      candidates.push(...v1Result.value);
    } else {
      log.warn(`v1 generator failed: ${String(v1Result.reason)}`);
    }

    if (v2Result.status === "fulfilled") {
      candidates.push(...v2Result.value);
    } else {
      log.warn(`v2 generator failed: ${String(v2Result.reason)}`);
    }

    // Deduplicate by content similarity
    const deduped: InsightCandidate[] = [];
    for (const candidate of candidates) {
      const isDup = deduped.some(
        (existing) => computeTrigramSimilarity(candidate.content, existing.content) > 0.6,
      );
      if (!isDup) deduped.push(candidate);
    }

    // Sort by compositeScore descending, return top 3
    deduped.sort((a, b) => b.compositeScore - a.compositeScore);
    return deduped.slice(0, 3);
  };
}
