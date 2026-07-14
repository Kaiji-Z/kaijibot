import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

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
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { PersonaStore } = await import("../../cognitive/persona/store.js");

      const store = new PersonaStore(configDir);
      const targetAgentId = params.agentId as string | undefined;
      const agentIds = targetAgentId ? [targetAgentId] : await store.listAgentIds();

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
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { PersonaStore } = await import("../../cognitive/persona/store.js");

      const agentId = params.agentId as string;
      const userId = params.userId as string;
      const store = new PersonaStore(configDir);
      const persona = await store.load(agentId, userId);

      respond(true, persona ?? null);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "cognitive.insights.list": async ({ respond, params }) => {
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { InsightStore } = await import("../../cognitive/insight/store.js");

      const agentId = params.agentId as string;
      const userId = params.userId as string;
      const limit = params.limit as number | undefined;
      const store = new InsightStore(configDir);
      const insights = await store.listRecent(agentId, userId, limit);

      respond(true, { insights });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "cognitive.insights.feedback": async ({ respond, params }) => {
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { InsightStore } = await import("../../cognitive/insight/store.js");

      const agentId = params.agentId as string;
      const userId = params.userId as string;
      const id = params.id as string;
      const feedback = params.feedback as string;
      const userResponse = params.userResponse as string | undefined;
      const store = new InsightStore(configDir);
      await store.updateFeedback(
        agentId,
        userId,
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
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { EvolutionStore } = await import("../../cognitive/evolution/store.js");

      const agentId = params.agentId as string;
      const userId = params.userId as string;
      const store = new EvolutionStore(configDir);
      const records = await store.list(agentId, userId);

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
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { CorrectionStore } = await import("../../cognitive/correction/store.js");

      const agentId = params.agentId as string;
      const userId = params.userId as string;
      const store = new CorrectionStore(configDir);
      const corrections = await store.listActive(agentId, userId);

      respond(true, { corrections });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "cognitive.corrections.users": async ({ respond, params }) => {
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();
      const { CorrectionStore } = await import("../../cognitive/correction/store.js");

      const agentId = params.agentId as string;
      const store = new CorrectionStore(configDir);
      const userIds = await store.listUserIds(agentId);

      respond(true, { userIds });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
