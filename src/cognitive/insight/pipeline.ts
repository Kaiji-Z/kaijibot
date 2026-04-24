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
import { computeTrigramSimilarity, isDuplicateBySemanticOverlap } from "./content-similarity.js";
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

    const fragments = await this.deps.loadFragments(userId);
    if (fragments.length < COLD_START_THRESHOLD) {
      log.info("v2 pipeline: cold start", { userId, fragmentCount: fragments.length, fallback: "v1" });
      const v1Candidates = await this.v1Fallback(persona, input);
      return { deliverable: v1Candidates, parked: [] };
    }

    const blindSpots = await crystallize(
      userId,
      persona,
      config,
      this.deps.crystallization,
      "signal" as CrystallizationMode,
    );
    log.info("v2 pipeline: crystallized", { userId, blindSpotCount: blindSpots.length });
    if (blindSpots.length === 0) return { deliverable: [], parked: [] };

    const deliverable: InsightCandidate[] = [];
    const parked: PipelineResult["parked"] = [];

    for (const bs of blindSpots) {
      try {
        const assessment = await assessQuality(bs, persona, config, this.deps.qualityGate);

        log.info("v2 pipeline: quality gate", {
          verdict: assessment.verdict,
          composite: assessment.composite,
          blindSpot: bs.blindSpot.slice(0, 60),
        });

        if (assessment.verdict === "discard") continue;

        if (assessment.verdict === "park") {
          parked.push({ candidate: bs, assessment });
          continue;
        }

        const insight = await composeInsight(bs, persona, config, this.deps.composer);
        if (insight) {
          insight.source = "v2";
          deliverable.push(insight);
          log.info("v2 pipeline: insight composed", { contentPreview: insight.content.slice(0, 80) });
        }
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

    const v1Candidates = v1Result.status === "fulfilled" ? v1Result.value : [];
    const v2Candidates = v2Result.status === "fulfilled" ? v2Result.value : [];

    if (v1Result.status === "rejected") log.warn(`v1 generator failed: ${String(v1Result.reason)}`);
    if (v2Result.status === "rejected") log.warn(`v2 generator failed: ${String(v2Result.reason)}`);

    for (const c of v1Candidates) c.source = "v1";
    for (const c of v2Candidates) c.source = "v2";

    const candidates = [...v1Candidates, ...v2Candidates];

    const deduped: InsightCandidate[] = [];
    for (const candidate of candidates) {
      const isDup = deduped.some(
        (existing) => isDuplicateBySemanticOverlap(candidate.content, [existing.content], { trigramThreshold: 0.6 }),
      );
      if (!isDup) deduped.push(candidate);
    }

    log.info("dual pipeline: merged", {
      v1: v1Candidates.length,
      v2: v2Candidates.length,
      total: candidates.length,
      deduped: deduped.length,
    });

    deduped.sort((a, b) => b.compositeScore - a.compositeScore);
    return deduped.slice(0, 3);
  };
}
