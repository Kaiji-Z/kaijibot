import type { KaijiBotConfig } from "./types.js";

export type RuntimeConfigSnapshotRefreshParams = {
  sourceConfig: KaijiBotConfig;
};

export type RuntimeConfigSnapshotRefreshHandler = {
  refresh: (params: RuntimeConfigSnapshotRefreshParams) => boolean | Promise<boolean>;
  clearOnRefreshFailure?: () => void;
};

export type RuntimeConfigWriteNotification = {
  configPath: string;
  sourceConfig: KaijiBotConfig;
  runtimeConfig: KaijiBotConfig;
  persistedHash: string;
  writtenAtMs: number;
};

let runtimeConfigSnapshot: KaijiBotConfig | null = null;
let runtimeConfigSourceSnapshot: KaijiBotConfig | null = null;
let runtimeConfigSnapshotRefreshHandler: RuntimeConfigSnapshotRefreshHandler | null = null;
const runtimeConfigWriteListeners = new Set<(event: RuntimeConfigWriteNotification) => void>();

export function setRuntimeConfigSnapshot(
  config: KaijiBotConfig,
  sourceConfig?: KaijiBotConfig,
): void {
  runtimeConfigSnapshot = config;
  runtimeConfigSourceSnapshot = sourceConfig ?? null;
}

export function resetConfigRuntimeState(): void {
  runtimeConfigSnapshot = null;
  runtimeConfigSourceSnapshot = null;
}

export function clearRuntimeConfigSnapshot(): void {
  resetConfigRuntimeState();
}

export function getRuntimeConfigSnapshot(): KaijiBotConfig | null {
  return runtimeConfigSnapshot;
}

export function getRuntimeConfigSourceSnapshot(): KaijiBotConfig | null {
  return runtimeConfigSourceSnapshot;
}

export function setRuntimeConfigSnapshotRefreshHandler(
  refreshHandler: RuntimeConfigSnapshotRefreshHandler | null,
): void {
  runtimeConfigSnapshotRefreshHandler = refreshHandler;
}

export function getRuntimeConfigSnapshotRefreshHandler(): RuntimeConfigSnapshotRefreshHandler | null {
  return runtimeConfigSnapshotRefreshHandler;
}

export function registerRuntimeConfigWriteListener(
  listener: (event: RuntimeConfigWriteNotification) => void,
): () => void {
  runtimeConfigWriteListeners.add(listener);
  return () => {
    runtimeConfigWriteListeners.delete(listener);
  };
}

export function notifyRuntimeConfigWriteListeners(event: RuntimeConfigWriteNotification): void {
  for (const listener of runtimeConfigWriteListeners) {
    try {
      listener(event);
    } catch {
      // Best-effort observer path only; successful writes must still complete.
    }
  }
}

export function loadPinnedRuntimeConfig(loadFresh: () => KaijiBotConfig): KaijiBotConfig {
  if (runtimeConfigSnapshot) {
    return runtimeConfigSnapshot;
  }
  const config = loadFresh();
  setRuntimeConfigSnapshot(config);
  return getRuntimeConfigSnapshot() ?? config;
}

export async function finalizeRuntimeSnapshotWrite(params: {
  nextSourceConfig: KaijiBotConfig;
  hadRuntimeSnapshot: boolean;
  hadBothSnapshots: boolean;
  loadFreshConfig: () => KaijiBotConfig;
  notifyCommittedWrite: () => void;
  createRefreshError: (detail: string, cause: unknown) => Error;
  formatRefreshError: (error: unknown) => string;
}): Promise<void> {
  const refreshHandler = getRuntimeConfigSnapshotRefreshHandler();
  if (refreshHandler) {
    try {
      const refreshed = await refreshHandler.refresh({ sourceConfig: params.nextSourceConfig });
      if (refreshed) {
        params.notifyCommittedWrite();
        return;
      }
    } catch (error) {
      try {
        refreshHandler.clearOnRefreshFailure?.();
      } catch {
        // Keep the original refresh failure as the surfaced error.
      }
      throw params.createRefreshError(params.formatRefreshError(error), error);
    }
  }

  if (params.hadBothSnapshots) {
    const fresh = params.loadFreshConfig();
    setRuntimeConfigSnapshot(fresh, params.nextSourceConfig);
    params.notifyCommittedWrite();
    return;
  }

  if (params.hadRuntimeSnapshot) {
    const fresh = params.loadFreshConfig();
    setRuntimeConfigSnapshot(fresh);
    params.notifyCommittedWrite();
    return;
  }

  setRuntimeConfigSnapshot(params.loadFreshConfig());
  params.notifyCommittedWrite();
}
