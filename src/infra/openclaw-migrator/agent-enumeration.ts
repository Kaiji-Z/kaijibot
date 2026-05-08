import fs from "node:fs/promises";
import path from "node:path";
import type { AgentInfo, MigrationSource, WorkspaceStats } from "./types.js";

export async function enumerateSourceAgents(source: MigrationSource): Promise<AgentInfo[]> {
  const agents: AgentInfo[] = [];

  let config: Record<string, unknown> | null = null;
  try {
    const raw = await fs.readFile(source.configPath, "utf-8");
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Unreadable config — fall through to single default agent.
  }

  const agentsSection = config?.agents as Record<string, unknown> | undefined;
  const agentList = agentsSection?.list as Array<Record<string, unknown>> | undefined;

  if (agentList && Array.isArray(agentList)) {
    for (const entry of agentList) {
      const id = typeof entry.id === "string" ? entry.id : "";
      if (!id) {
        continue;
      }

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

async function walkDir(dir: string): Promise<{ fileCount: number; totalSize: number }> {
  let fileCount = 0;
  let totalSize = 0;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await walkDir(full);
      fileCount += sub.fileCount;
      totalSize += sub.totalSize;
    } else if (entry.isFile()) {
      const stat = await fs.stat(full);
      fileCount += 1;
      totalSize += stat.size;
    }
  }

  return { fileCount, totalSize };
}

export async function computeWorkspaceStats(workspaceDir: string): Promise<WorkspaceStats> {
  const result: WorkspaceStats = {
    fileCount: 0,
    totalSize: 0,
    hasMemory: false,
    hasSessions: false,
  };

  let dirExists = false;
  try {
    const stat = await fs.stat(workspaceDir);
    dirExists = stat.isDirectory();
  } catch {
    return result;
  }

  if (!dirExists) {
    return result;
  }

  try {
    const walked = await walkDir(workspaceDir);
    result.fileCount = walked.fileCount;
    result.totalSize = walked.totalSize;
  } catch {
    // Permission errors during walk — return partial stats.
  }

  try {
    const memStat = await fs.stat(path.join(workspaceDir, "memory"));
    result.hasMemory = memStat.isDirectory();
  } catch {
    // No memory directory.
  }

  const sessionCandidates = [
    path.join(workspaceDir, "..", "state", "sessions"),
    path.join(workspaceDir, "..", "sessions"),
  ];

  for (const candidate of sessionCandidates) {
    try {
      const sStat = await fs.stat(candidate);
      if (sStat.isDirectory()) {
        result.hasSessions = true;
        break;
      }
    } catch {
      // Candidate doesn't exist — try next.
    }
  }

  return result;
}

export async function enumerateSourceSkills(source: MigrationSource): Promise<string[]> {
  const skillsDir = path.join(source.dir, "skills");
  const names: string[] = [];

  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
      try {
        await fs.access(skillMd);
        names.push(entry.name);
      } catch {
        // No SKILL.md — skip.
      }
    }
  } catch {
    // Skills directory doesn't exist.
  }

  return names.toSorted();
}
