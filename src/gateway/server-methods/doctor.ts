import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { getActiveMemorySearchManager } from "../../plugins/memory-runtime.js";
import { formatError } from "../server-utils.js";
import { removeGroundedShortTermCandidates } from "./doctor.memory-core-runtime.js";
import { asRecord, normalizeTrimmedString } from "./record-shared.js";
import type { GatewayRequestHandlers } from "./types.js";

const SHORT_TERM_STORE_RELATIVE_PATH = path.join("memory", ".dreams", "short-term-recall.json");
const MANAGED_DEEP_SLEEP_CRON_NAME = "Memory Promotion";
const MANAGED_DEEP_SLEEP_CRON_TAG = "[managed-by=memory-core.short-term-promotion]";
const DEEP_SLEEP_SYSTEM_EVENT_TEXT = "__kaijibot_memory_core_short_term_promotion_dream__";

export type DoctorMemoryStatusPayload = {
  agentId: string;
  provider?: string;
  embedding: {
    ok: boolean;
    error?: string;
  };
};

export type DoctorMemoryDreamActionPayload = {
  agentId: string;
  action: "resetGroundedShortTerm";
  removedShortTermEntries?: number;
};

export const doctorHandlers: GatewayRequestHandlers = {
  "doctor.memory.status": async ({ respond, context }) => {
    const cfg = loadConfig();
    const agentId = resolveDefaultAgentId(cfg);
    const { manager, error } = await getActiveMemorySearchManager({
      cfg,
      agentId,
      purpose: "status",
    });
    if (!manager) {
      const payload: DoctorMemoryStatusPayload = {
        agentId,
        embedding: {
          ok: false,
          error: error ?? "memory search unavailable",
        },
      };
      respond(true, payload, undefined);
      return;
    }

    try {
      const status = manager.status();
      let embedding = await manager.probeEmbeddingAvailability();
      if (!embedding.ok && !embedding.error) {
        embedding = { ok: false, error: "memory embeddings unavailable" };
      }
      const payload: DoctorMemoryStatusPayload = {
        agentId,
        provider: status.provider,
        embedding,
      };
      respond(true, payload, undefined);
    } catch (err) {
      const payload: DoctorMemoryStatusPayload = {
        agentId,
        embedding: {
          ok: false,
          error: `gateway memory probe failed: ${formatError(err)}`,
        },
      };
      respond(true, payload, undefined);
    } finally {
      await manager.close?.().catch(() => {});
    }
  },
  "doctor.memory.resetGroundedShortTerm": async ({ respond }) => {
    const cfg = loadConfig();
    const agentId = resolveDefaultAgentId(cfg);
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const removed = await removeGroundedShortTermCandidates({ workspaceDir });
    const payload: DoctorMemoryDreamActionPayload = {
      agentId,
      action: "resetGroundedShortTerm",
      removedShortTermEntries: removed.removed,
    };
    respond(true, payload, undefined);
  },
};
