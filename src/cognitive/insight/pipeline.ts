import type { Fragment, FragmentCluster } from "./fragment-types.js";
import { FragmentStore } from "./fragment-store.js";
import {
  createDefaultFragmentCollectorDeps,
  type FragmentCollectorDeps,
} from "./fragment-collector.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/pipeline");

// ─── Aggregated deps ───

export type PipelineDeps = {
  collector: FragmentCollectorDeps;
  loadFragments: (agentId: string, userId: string) => Promise<Fragment[]>;
  addFragment: (agentId: string, userId: string, fragment: Fragment) => Promise<Fragment[]>;
  findClusters: (agentId: string, userId: string) => Promise<FragmentCluster[]>;
};

// ─── Factory ───

export function createPipelineDeps(configDir: string, externalStore?: FragmentStore): PipelineDeps {
  const store = externalStore ?? new FragmentStore(configDir);
  return {
    collector: createDefaultFragmentCollectorDeps(),
    loadFragments: (agentId, userId) => store.load(agentId, userId),
    addFragment: (agentId, userId, fragment) => store.addFragment(agentId, userId, fragment),
    findClusters: (agentId, userId) => store.findClusters(agentId, userId),
  };
}
