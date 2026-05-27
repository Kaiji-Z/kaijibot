import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const cognitiveHandlers: GatewayRequestHandlers = {
  "cognitive.status": async ({ respond }) => {
    try {
      const { resolveConfigDir } = await import("../../utils.js");
      const configDir = resolveConfigDir();

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

          // Insight count (recent)
          const insights = await insightStore.listRecent(agentId, userId, 100);
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
        enabled = (snapshot.parsed as Record<string, unknown>)?.cognitive !== undefined
          ? ((snapshot.parsed as Record<string, unknown>).cognitive as Record<string, unknown>)
              ?.enabled !== false
          : true;
      } catch {
        // Config may not exist yet
      }

      respond(true, {
        enabled,
        users: totalUsers,
        domains: totalDomains,
        avgTrust: trustCount > 0 ? Math.round((trustSum / trustCount) * 100) / 100 : null,
        insights: totalInsights,
        corrections: totalCorrections,
        skills: skills.length,
        agentSkills,
        lastProactiveAt,
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
