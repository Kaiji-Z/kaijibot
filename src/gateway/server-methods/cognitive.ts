import {
  ErrorCodes,
  errorShape,
  validateTasksGetParams,
  validateTasksListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

export async function loadCognitiveStatsSummary(configDir: string): Promise<{
  enabled: boolean;
  users: number;
  domains: number;
  avgTrust: number | null;
  insights: number;
  corrections: number;
  skills: number;
  agentSkills: number;
  lastProactiveAt: number | null;
}> {
  const { PersonaStore } = await import("../../cognitive/persona/store.js");
  const { InsightStore } = await import("../../cognitive/insight/store.js");
  const { CorrectionStore } = await import("../../cognitive/correction/store.js");
  const { SkillLifecycleManager } = await import("../../cognitive/evolution/skill-lifecycle.js");
  const { SkillPersistenceWriter } = await import("../../cognitive/evolution/skill-writer.js");
  const { readConfigFileSnapshot } = await import("../../config/io.js");

  const personaStore = new PersonaStore(configDir);
  const insightStore = new InsightStore(configDir);
  const correctionStore = new CorrectionStore(configDir);
  const writer = new SkillPersistenceWriter(configDir);
  const skillLifecycle = new SkillLifecycleManager(writer);

  // Aggregate data across all agents/users
  const agentIds = await personaStore.listAgentIds();

  let totalUsers = 0;
  let totalDomains = 0;
  let totalInsights = 0;
  let totalCorrections = 0;
  let trustSum = 0;
  let trustCount = 0;
  let lastProactiveAt: number | null = null;

  for (const agentId of agentIds) {
    const userIds = await personaStore.listUserIds(agentId);
    totalUsers += userIds.length;

    for (const userId of userIds) {
      // Persona data
      const persona = await personaStore.load(agentId, userId);
      if (persona) {
        totalDomains += Object.keys(persona.domains ?? {}).length;
        if (persona.rapport?.trustScore != null) {
          trustSum += persona.rapport.trustScore;
          trustCount++;
        }
        if (persona.feedbackProfile?.lastProactiveAt) {
          if (!lastProactiveAt || persona.feedbackProfile.lastProactiveAt > lastProactiveAt) {
            lastProactiveAt = persona.feedbackProfile.lastProactiveAt;
          }
        }
      }

      // Insight count (active)
      const insights = await insightStore.listActive(agentId, userId);
      totalInsights += insights.length;

      // Active corrections
      const corrections = await correctionStore.listActive(agentId, userId);
      totalCorrections += corrections.length;
    }
  }

  // Skills
  const skills = await skillLifecycle.listSkills();
  const agentSkills = skills.filter((s) => s.provenance === "agent").length;

  // Check if cognitive is enabled from config
  let enabled = true;
  try {
    const snapshot = await readConfigFileSnapshot();
    enabled =
      (snapshot.parsed as Record<string, unknown>)?.cognitive !== undefined
        ? ((snapshot.parsed as Record<string, unknown>).cognitive as Record<string, unknown>)
            ?.enabled !== false
        : true;
  } catch {
    // Config may not exist yet
  }

  return {
    enabled,
    users: totalUsers,
    domains: totalDomains,
    avgTrust: trustCount > 0 ? Math.round((trustSum / trustCount) * 100) / 100 : null,
    insights: totalInsights,
    corrections: totalCorrections,
    skills: skills.length,
    agentSkills,
    lastProactiveAt,
  };
}

type CognitiveStoreTarget = { agentId?: string; userId?: string };

/**
 * Pick the `agentId` / `userId` pair that names a cognitive store file. Both
 * become path segments under the store directories, so a value carrying a
 * separator or a traversal segment would let a read-scoped client list or
 * quarantine files outside the config dir. Optional keys may be absent or
 * `undefined`; every present value must be a single safe path segment.
 */
function parseCognitiveStoreTarget(
  params: Record<string, unknown>,
  required: ReadonlyArray<keyof CognitiveStoreTarget>,
): CognitiveStoreTarget | { error: string } {
  const target: CognitiveStoreTarget = {};
  for (const key of ["agentId", "userId"] as const) {
    const value = params[key];
    if (value === undefined) {
      if (required.includes(key)) {
        return { error: `${key} is required` };
      }
      continue;
    }
    // Same rules as resolveMediaBufferPath: separators, NUL and the bare
    // traversal segments are never part of a real id; dots inside an id (an
    // email-like WeChat id, for example) stay allowed.
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.includes("/") ||
      value.includes("\\") ||
      value.includes("\0") ||
      value === "." ||
      value === ".."
    ) {
      return { error: `${key} must be a single path segment` };
    }
    target[key] = value;
  }
  return target;
}

/** Parse the store target, or answer the request with INVALID_REQUEST and return null. */
function requireCognitiveStoreTarget(
  params: Record<string, unknown>,
  required: ReadonlyArray<keyof CognitiveStoreTarget>,
  respond: RespondFn,
): CognitiveStoreTarget | null {
  const target = parseCognitiveStoreTarget(params, required);
  if ("error" in target) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `invalid cognitive store target: ${target.error}`),
    );
    return null;
  }
  return target;
}

export const cognitiveHandlers: GatewayRequestHandlers = {
  "cognitive.status": async ({ respond }) => {
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const stats = await loadCognitiveStatsSummary(configDir);
      respond(true, stats);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "cognitive.persona.list": async ({ respond, params }) => {
    const target = requireCognitiveStoreTarget(params, [], respond);
    if (!target) {
      return;
    }
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { PersonaStore } = await import("../../cognitive/persona/store.js");

      const store = new PersonaStore(configDir);
      const agentIds = target.agentId ? [target.agentId] : await store.listAgentIds();

      const agents: Array<{
        agentId: string;
        users: Array<{
          userId: string;
          displayName?: string;
          domainCount: number;
          trustScore?: number;
          phase?: string;
          lastActive?: number;
        }>;
      }> = [];

      for (const agentId of agentIds) {
        const userIds = await store.listUserIds(agentId);
        const users: Array<{
          userId: string;
          displayName?: string;
          domainCount: number;
          trustScore?: number;
          phase?: string;
          lastActive?: number;
        }> = [];

        for (const userId of userIds) {
          const persona = await store.load(agentId, userId);
          users.push({
            userId,
            displayName: persona?.identity.displayName,
            domainCount: persona ? Object.keys(persona.domains).length : 0,
            trustScore: persona?.rapport?.trustScore,
            phase: persona?.lifecycle?.stage,
            lastActive: persona?.lifecycle?.lastActiveAt,
          });
        }

        agents.push({ agentId, users });
      }

      respond(true, { agents });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "cognitive.persona.detail": async ({ respond, params }) => {
    const target = requireCognitiveStoreTarget(params, ["agentId", "userId"], respond);
    if (!target?.agentId || !target.userId) {
      return;
    }
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { PersonaStore } = await import("../../cognitive/persona/store.js");

      const store = new PersonaStore(configDir);
      const persona = await store.load(target.agentId, target.userId);

      respond(true, persona ?? null);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "cognitive.insights.list": async ({ respond, params }) => {
    const target = requireCognitiveStoreTarget(params, ["agentId", "userId"], respond);
    if (!target?.agentId || !target.userId) {
      return;
    }
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { InsightStore } = await import("../../cognitive/insight/store.js");

      const limit = params.limit as number | undefined;
      const store = new InsightStore(configDir);
      const insights = await store.listRecent(target.agentId, target.userId, limit);

      respond(true, { insights });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "cognitive.insights.feedback": async ({ respond, params }) => {
    const target = requireCognitiveStoreTarget(params, ["agentId", "userId"], respond);
    if (!target?.agentId || !target.userId) {
      return;
    }
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { InsightStore } = await import("../../cognitive/insight/store.js");

      const id = params.id as string;
      const feedback = params.feedback as string;
      const userResponse = params.userResponse as string | undefined;
      const store = new InsightStore(configDir);
      await store.updateFeedback(
        target.agentId,
        target.userId,
        id,
        feedback as "positive" | "negative" | "neutral" | "engaged",
        userResponse,
      );

      respond(true, { ok: true });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "cognitive.evolution.list": async ({ respond, params }) => {
    const target = requireCognitiveStoreTarget(params, ["agentId", "userId"], respond);
    if (!target?.agentId || !target.userId) {
      return;
    }
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { EvolutionStore } = await import("../../cognitive/evolution/store.js");

      const store = new EvolutionStore(configDir);
      const records = await store.list(target.agentId, target.userId);

      respond(true, { records });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "cognitive.evolution.audit": async ({ respond, params }) => {
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { AuditLog } = await import("../../cognitive/evolution/audit-log.js");

      const log = new AuditLog(configDir);
      const entries = await log.query({
        operation: params.operation as string | undefined,
        actor: params.actor as string | undefined,
        since: params.since as number | undefined,
      });

      respond(true, { entries });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "cognitive.corrections.list": async ({ respond, params }) => {
    const target = requireCognitiveStoreTarget(params, ["agentId", "userId"], respond);
    if (!target?.agentId || !target.userId) {
      return;
    }
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { CorrectionStore } = await import("../../cognitive/correction/store.js");

      const store = new CorrectionStore(configDir);
      const corrections = await store.listActive(target.agentId, target.userId);

      respond(true, { corrections });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "cognitive.corrections.users": async ({ respond, params }) => {
    const target = requireCognitiveStoreTarget(params, ["agentId"], respond);
    if (!target?.agentId) {
      return;
    }
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { CorrectionStore } = await import("../../cognitive/correction/store.js");

      const store = new CorrectionStore(configDir);
      const userIds = await store.listUserIds(target.agentId);

      respond(true, { userIds });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};

/**
 * Cognitive task audit RPCs (M4): the Control UI task panel lists active
 * tasks and inspects one task's full execution trail. Gated at the data
 * level — an empty store returns an empty list regardless of flags; the
 * runner only exists when cognitive.tasks.enabled is on.
 */
export const cognitiveTaskHandlers: GatewayRequestHandlers = {
  "tasks.list": async ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksListParams, "tasks.list", respond)) {
      return;
    }
    const target = requireCognitiveStoreTarget(params, [], respond);
    if (!target) {
      return;
    }
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const { TaskStore } = await import("../../cognitive/tasks/store.js");
      const { isTerminalTaskStatus } = await import("../../cognitive/tasks/types.js");
      const store = new TaskStore(resolveConfigDir());

      const agentIds = target.agentId ? [target.agentId] : await store.listAgentIds();
      const tasks: Array<Record<string, unknown>> = [];
      for (const agentId of agentIds) {
        const userIds = target.userId ? [target.userId] : await store.listUserIds(agentId);
        for (const userId of userIds) {
          for (const task of await store.list(agentId, userId)) {
            if (!params.includeFinished && isTerminalTaskStatus(task.status)) {
              continue;
            }
            tasks.push({
              id: task.id,
              agentId: task.agentId,
              userId: task.userId,
              goal: task.goal,
              status: task.status,
              usedSteps: task.budget.usedSteps,
              maxSteps: task.budget.maxSteps,
              stepCount: task.steps.length,
              createdAt: task.createdAt,
              updatedAt: task.updatedAt,
              ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
              ...(task.parentAgentId ? { parentAgentId: task.parentAgentId } : {}),
            });
          }
        }
      }
      tasks.sort((a, b) => (b.updatedAt as number) - (a.updatedAt as number));
      respond(true, { tasks });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "tasks.get": async ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksGetParams, "tasks.get", respond)) {
      return;
    }
    const target = requireCognitiveStoreTarget(params, ["userId"], respond);
    if (!target?.userId) {
      return;
    }
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const { TaskStore } = await import("../../cognitive/tasks/store.js");
      const store = new TaskStore(resolveConfigDir());

      const found = await store.findTaskAcrossAgents(target.userId, params.taskId);
      if (!found) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `task ${params.taskId} not found for user ${target.userId}`,
          ),
        );
        return;
      }
      respond(true, { task: found.task });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
