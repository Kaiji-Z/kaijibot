export { MemoryIndexManager } from "./manager.js";
export type {
  MemoryEmbeddingProbeResult,
  MemorySearchManager,
  MemorySearchResult,
} from "kaijibot/plugin-sdk/memory-core-host-engine-storage";
export {
  closeAllMemorySearchManagers,
  getMemorySearchManager,
  type MemorySearchManagerResult,
} from "./search-manager.js";
