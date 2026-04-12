import type { KaijiBotConfig } from "../config/config.js";
import type { RegisteredMemorySearchManager } from "../plugins/memory-state.js";

type ActiveMemorySearchPurpose = "default" | "status";

export type ActiveMemorySearchManagerResult = {
  manager: RegisteredMemorySearchManager | null;
  error?: string;
};

type MemoryHostSearchRuntimeModule = typeof import("./memory-host-search.runtime.js");

async function loadMemoryHostSearchRuntime(): Promise<MemoryHostSearchRuntimeModule> {
  return await import("./memory-host-search.runtime.js");
}

export async function getActiveMemorySearchManager(params: {
  cfg: KaijiBotConfig;
  agentId: string;
  purpose?: ActiveMemorySearchPurpose;
}): Promise<ActiveMemorySearchManagerResult> {
  const runtime = await loadMemoryHostSearchRuntime();
  return await runtime.getActiveMemorySearchManager(params);
}

export async function closeActiveMemorySearchManagers(cfg?: KaijiBotConfig): Promise<void> {
  const runtime = await loadMemoryHostSearchRuntime();
  await runtime.closeActiveMemorySearchManagers(cfg);
}
