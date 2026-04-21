import { normalizeOptionalLowercaseString } from "../shared/string-coerce.js";

export type ToolErrorSummary = {
  toolName: string;
  meta?: string;
  error?: string;
  timedOut?: boolean;
  mutatingAction?: boolean;
  actionFingerprint?: string;
};

const EXEC_LIKE_TOOL_NAMES = new Set(["exec", "bash"]);

export function isExecLikeToolName(toolName: string): boolean {
  return EXEC_LIKE_TOOL_NAMES.has(normalizeOptionalLowercaseString(toolName) ?? "");
}

// ---------------------------------------------------------------------------
// Error accumulator bridge for evolution module
// ---------------------------------------------------------------------------

type MutableErrorProfile = {
  errorCount: number;
  failedToolNames: Set<string>;
  hasMutatingErrors: boolean;
};

const errorAccumulatorMap = new Map<string, MutableErrorProfile>();

export function accumulateToolError(
  sessionKey: string,
  details: { toolName: string; mutatingAction?: boolean },
): void {
  let profile = errorAccumulatorMap.get(sessionKey);
  if (!profile) {
    profile = { errorCount: 0, failedToolNames: new Set(), hasMutatingErrors: false };
    errorAccumulatorMap.set(sessionKey, profile);
  }
  profile.errorCount += 1;
  profile.failedToolNames.add(details.toolName);
  if (details.mutatingAction) {
    profile.hasMutatingErrors = true;
  }
}

export type ConsumedErrorProfile = {
  errorCount: number;
  failedToolNames: string[];
  hasMutatingErrors: boolean;
};

export function consumeToolErrorProfile(sessionKey: string): ConsumedErrorProfile | undefined {
  const profile = errorAccumulatorMap.get(sessionKey);
  if (!profile) return undefined;
  errorAccumulatorMap.delete(sessionKey);
  return {
    errorCount: profile.errorCount,
    failedToolNames: [...profile.failedToolNames],
    hasMutatingErrors: profile.hasMutatingErrors,
  };
}

export function resetToolErrorAccumulator(sessionKey?: string): void {
  if (sessionKey) {
    errorAccumulatorMap.delete(sessionKey);
  } else {
    errorAccumulatorMap.clear();
  }
}
