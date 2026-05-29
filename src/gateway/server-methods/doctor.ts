import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { getActiveMemorySearchManager } from "../../plugins/memory-runtime.js";
import { formatError } from "../server-utils.js";
import { removeGroundedShortTermCandidates } from "./doctor.memory-core-runtime.js";
import type { GatewayRequestHandlers } from "./types.js";

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
  "doctor.memory.status": async ({ respond }) => {
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
