// Lightweight runtime surface for plugin-owned agent harnesses.
// Keep heavyweight tool construction out of this module so harness imports can
// register quickly inside gateway startup and Docker e2e runs.
//
// NOTE: Some upstream exports have been omitted because the corresponding
// modules have not yet been ported to KaijiBot. They are marked with comments
// below. As modules are ported, re-add the exports.

import {
  abortEmbeddedPiRun,
  clearActiveEmbeddedRun,
  resolveActiveEmbeddedRunSessionId,
  setActiveEmbeddedRun,
} from "../agents/pi-embedded-runner/runs.js";
import { formatToolDetail, resolveToolDisplay } from "../agents/tool-display.js";
import { redactToolDetail } from "../logging/redact.js";
import { truncateUtf16Safe } from "../utils.js";

export const TOOL_PROGRESS_OUTPUT_MAX_CHARS = 8_000;

export type { AgentMessage } from "@earendil-works/pi-agent-core";
// -- Types from existing KaijiBot modules --

export type {
  EmbeddedRunAttemptParams,
  EmbeddedRunAttemptResult,
} from "../agents/pi-embedded-runner/run/types.js";
export type { ContextEngine as HarnessContextEngine } from "../context-engine/types.js";
export type { CompactEmbeddedPiSessionParams } from "../agents/pi-embedded-runner/compact.js";
export type { EmbeddedPiCompactResult } from "../agents/pi-embedded-runner/types.js";
export type { AnyAgentTool } from "../agents/tools/common.js";
export type { NormalizedUsage } from "../agents/usage.js";
export type { EmbeddedContextFile } from "../agents/pi-embedded-helpers/types.js";
export type { NodeListNode } from "../agents/tools/nodes-utils.js";

// -- Types not yet ported (declared locally for compilation compat) --

// agents/harness/types.ts - not yet ported
export type AgentHarness = unknown;
export type AgentHarnessAttemptParams = unknown;
export type AgentHarnessAttemptResult = unknown;
export type AgentHarnessCompactParams = unknown;
export type AgentHarnessCompactResult = unknown;
export type AgentHarnessDeliveryDefaults = unknown;
export type AgentHarnessResultClassification = string;
export type AgentHarnessSideQuestionParams = unknown;
export type AgentHarnessSideQuestionResult = unknown;
export type AgentHarnessResetParams = unknown;
export type AgentHarnessSupport = unknown;
export type AgentHarnessSupportContext = unknown;

// agents/pi-embedded-messaging.types.ts - not yet ported
export type MessagingToolSend = unknown;
export type MessagingToolSourceReplyPayload = unknown;

// auto-reply/heartbeat-tool-response.ts - not yet ported
export type HeartbeatToolResponse = unknown;

// infra/agent-events.ts - exists
export type { AgentApprovalEventData, AgentEventPayload } from "../infra/agent-events.js";

// infra/exec-approvals.ts - exists
export type { ExecApprovalDecision } from "../infra/exec-approvals.js";

// plugins/agent-tool-result-middleware-types.ts - not yet ported
export type AgentToolResultMiddleware = unknown;
export type AgentToolResultMiddlewareContext = unknown;
export type AgentToolResultMiddlewareEvent = unknown;
export type AgentToolResultMiddlewareHarness = unknown;
export type AgentToolResultMiddlewareOptions = unknown;
export type AgentToolResultMiddlewareResult = unknown;
export type AgentToolResultMiddlewareRuntime = unknown;
export type KaijiBotAgentToolResult = unknown;

// plugins/codex-app-server-extension-types.ts - not yet ported
export type CodexAppServerExtensionContext = unknown;
export type CodexAppServerExtensionFactory = unknown;
export type CodexAppServerExtensionRuntime = unknown;
export type CodexAppServerToolResultEvent = unknown;
export type CodexAppServerToolResultHandlerResult = unknown;

// agents/harness/native-hook-relay.ts - not yet ported
export type NativeHookRelayEvent = unknown;
export type NativeHookRelayProcessResponse = unknown;
export type NativeHookRelayProvider = unknown;
export type NativeHookRelayRegistrationHandle = unknown;

// agents/codex-mcp-config.types.ts - not yet ported
export type CodexBundleMcpThreadConfig = unknown;
export type LoadCodexBundleMcpThreadConfigParams = unknown;

// -- Exports from existing modules --

export { VERSION as KAIJIBOT_VERSION } from "../version.js";
export { formatErrorMessage } from "../infra/errors.js";
export { emitAgentEvent, onAgentEvent, resetAgentEventsForTest } from "../infra/agent-events.js";
export { log as embeddedAgentLog } from "../agents/pi-embedded-runner/logger.js";
export { resolveUserPath } from "../utils.js";
export { callGatewayTool } from "../agents/tools/gateway.js";
export {
  listNodes,
  resolveNodeIdFromList,
  selectDefaultNodeFromList,
} from "../agents/tools/nodes-utils.js";
export { formatToolAggregate } from "../auto-reply/tool-meta.js";
export { isMessagingTool, isMessagingToolSendAction } from "../agents/pi-embedded-messaging.js";
export {
  extractToolResultMediaArtifact,
  filterToolResultMediaUrls,
} from "../agents/pi-embedded-subscribe.tools.js";
export { normalizeUsage } from "../agents/usage.js";
export { resolveAgentDir, resolveSessionAgentIds } from "../agents/agent-scope.js";
export { resolveModelAuthMode } from "../agents/model-auth.js";
export { supportsModelTools } from "../agents/model-tool-support.js";
export { resolveAttemptSpawnWorkspaceDir } from "../agents/pi-embedded-runner/run/attempt.thread-helpers.js";
export { buildEmbeddedAttemptToolRunContext } from "../agents/pi-embedded-runner/run/attempt.tool-run-context.js";
export {
  abortEmbeddedPiRun as abortAgentHarnessRun,
  clearActiveEmbeddedRun,
  resolveActiveEmbeddedRunSessionId,
  setActiveEmbeddedRun,
};

export function queueAgentHarnessMessage(sessionId: string, _text: string): boolean {
  return abortEmbeddedPiRun(sessionId) && false;
}

export { normalizeProviderToolSchemas } from "../agents/pi-embedded-runner/tool-schema-runtime.js";

export async function loadCodexBundleMcpThreadConfig(
  _params: LoadCodexBundleMcpThreadConfigParams,
): Promise<CodexBundleMcpThreadConfig> {
  throw new Error("loadCodexBundleMcpThreadConfig: codex-mcp-config not yet ported to KaijiBot");
}

export { resolveSandboxContext } from "../agents/sandbox.js";
export { resolveBootstrapContextForRun } from "../agents/bootstrap-files.js";
export { isSubagentSessionKey } from "../routing/session-key.js";
export { emitSessionTranscriptUpdate } from "../sessions/transcript-events.js";
export {
  isToolWrappedWithBeforeToolCallHook,
  runBeforeToolCallHook,
  wrapToolWithBeforeToolCallHook,
} from "../agents/pi-tools.before-tool-call.js";
export { resolveCompactionTimeoutMs } from "../agents/pi-embedded-runner/compaction-safety-timeout.js";
export {
  PREEMPTIVE_OVERFLOW_ERROR_TEXT,
  shouldPreemptivelyCompactBeforePrompt,
} from "../agents/pi-embedded-runner/run/preemptive-compaction.js";
export type { PreemptiveCompactionRoute } from "../agents/pi-embedded-runner/run/preemptive-compaction.js";
/** @deprecated Use `PreemptiveCompactionRoute`. */
export type PreemptiveCompactionDecision =
  import("../agents/pi-embedded-runner/run/preemptive-compaction.js").PreemptiveCompactionRoute;

/**
 * Derive the same compact user-facing tool detail that Pi uses for progress logs.
 */
export type ToolProgressDetailMode = "explain" | "raw";

export function inferToolMetaFromArgs(
  toolName: string,
  args: unknown,
  _options?: { detailMode?: ToolProgressDetailMode },
): string | undefined {
  const display = resolveToolDisplay({ name: toolName, args });
  return formatToolDetail(display);
}

/**
 * Prepare verbose tool output for user-facing progress messages.
 */
export function formatToolProgressOutput(
  output: string,
  options?: { maxChars?: number },
): string | undefined {
  const trimmed = output.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!trimmed) {
    return undefined;
  }
  const redacted = redactToolDetail(trimmed);
  const maxChars = options?.maxChars ?? TOOL_PROGRESS_OUTPUT_MAX_CHARS;
  if (redacted.length <= maxChars) {
    return redacted;
  }
  return `${truncateUtf16Safe(redacted, maxChars)}\n...(truncated)...`;
}

export type AgentHarnessTerminalOutcomeInput = {
  assistantTexts: readonly string[];
  reasoningText?: string | null;
  planText?: string | null;
  promptError?: unknown;
  turnCompleted: boolean;
};

export type AgentHarnessTerminalOutcomeClassification =
  | "planning-only"
  | "reasoning-only"
  | "empty";

/**
 * Classify terminal harness turns that completed without assistant output that
 * should advance fallback. Deliberate silent replies such as NO_REPLY count as
 * intentional output, while whitespace-only text remains fallback-eligible.
 * This is intentionally SDK-level so plugin harness adapters such as Codex
 * preserve the same KaijiBot-owned fallback signals as the built-in PI path
 * without re-implementing terminal-result policy.
 */
export function classifyAgentHarnessTerminalOutcome(
  params: AgentHarnessTerminalOutcomeInput,
): AgentHarnessTerminalOutcomeClassification | undefined {
  if (
    !params.turnCompleted ||
    (params.promptError !== undefined && params.promptError !== null) ||
    hasVisibleAssistantText(params.assistantTexts)
  ) {
    return undefined;
  }
  if (params.planText?.trim()) {
    return "planning-only";
  }
  if (params.reasoningText?.trim()) {
    return "reasoning-only";
  }
  return "empty";
}

function hasVisibleAssistantText(assistantTexts: readonly string[]): boolean {
  return assistantTexts.some((text) => text.trim().length > 0);
}
