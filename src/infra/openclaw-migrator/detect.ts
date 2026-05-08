import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentInfo, MigrationScenario, MigrationSource } from "./types.js";

type SourceCandidate = {
  dirname: string;
  configFilename: string;
  brand: MigrationSource["brand"];
};

const SOURCE_CANDIDATES: readonly SourceCandidate[] = [
  { dirname: ".openclaw", configFilename: "openclaw.json", brand: "openclaw" },
  { dirname: ".clawdbot", configFilename: "clawdbot.json", brand: "clawdbot" },
  { dirname: ".moltbot", configFilename: "moltbot.json", brand: "moltbot" },
];

export function detectMigrationSource(
  homedir: () => string = os.homedir,
): MigrationSource | null {
  const home = homedir();

  for (const candidate of SOURCE_CANDIDATES) {
    const dir = path.join(home, candidate.dirname);
    const configPath = path.join(dir, candidate.configFilename);

    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory() && fs.existsSync(configPath)) {
        return {
          dir,
          brand: candidate.brand,
          configPath,
          configFilename: candidate.configFilename,
        };
      }
    } catch {
      // FS errors are non-fatal during detection — skip this candidate.
    }
  }

  return null;
}

export function detectScenario(targetDir: string): MigrationScenario {
  const configPath = path.join(targetDir, "kaijibot.json");
  try {
    if (fs.existsSync(configPath)) { return "import"; }
  } catch {
    // FS error means we can't confirm config exists — assume fresh.
  }
  return "fresh";
}

export function listSourceAgents(source: MigrationSource): AgentInfo[] {
  const agents: AgentInfo[] = [];

  let config: Record<string, unknown> | null = null;
  try {
    const raw = fs.readFileSync(source.configPath, "utf-8");
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Unreadable config — fall through to single default agent.
  }

  const agentsSection = config?.agents as Record<string, unknown> | undefined;
  const agentList = agentsSection?.list as Array<Record<string, unknown>> | undefined;

  if (agentList && Array.isArray(agentList)) {
    for (const entry of agentList) {
      const id = typeof entry.id === "string" ? entry.id : "";
      if (!id) { continue; }

      const isDefault = Boolean(entry.default);
      const workspaceOverride = typeof entry.workspace === "string" ? entry.workspace : undefined;
      const workspaceDir = workspaceOverride
        ? path.resolve(source.dir, workspaceOverride)
        : isDefault
          ? path.join(source.dir, "workspace")
          : path.join(source.dir, `workspace-${id}`);

      agents.push({ id, workspaceDir, isDefault });
    }
  }

  if (agents.length === 0) {
    agents.push({
      id: "main",
      workspaceDir: path.join(source.dir, "workspace"),
      isDefault: true,
    });
  }

  return agents;
}
