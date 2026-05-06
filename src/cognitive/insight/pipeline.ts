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
  loadFragments: (userId: string) => Promise<Fragment[]>;
  addFragment: (userId: string, fragment: Fragment) => Promise<Fragment[]>;
  findClusters: (userId: string) => Promise<FragmentCluster[]>;
};

// ─── Factory ───

export function createPipelineDeps(configDir: string, externalStore?: FragmentStore): PipelineDeps {
  const store = externalStore ?? new FragmentStore(configDir);
  return {
    collector: createDefaultFragmentCollectorDeps(),
    loadFragments: (userId) => store.load(userId),
    addFragment: (userId, fragment) => store.addFragment(userId, fragment),
    findClusters: (userId) => store.findClusters(userId),
  };
}
