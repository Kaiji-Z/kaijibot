import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type AuditEntry = {
  id: string;
  timestamp: number;
  operation: string;
  actor: string;
  target: string;
  outcome: "success" | "failure" | "skipped";
  agentId?: string;
  metadata?: Record<string, unknown>;
};

export class AuditLog {
  constructor(private readonly configDir: string) {}

  private filePath(): string {
    return join(this.configDir, "cognitive", "evolution", "audit.jsonl");
  }

  async append(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry> {
    const dir = join(this.configDir, "cognitive", "evolution");
    await mkdir(dir, { recursive: true });

    const full: AuditEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    const line = JSON.stringify(full) + "\n";
    await appendFile(this.filePath(), line, "utf-8");
    return full;
  }

  async query(filter: {
    actor?: string;
    operation?: string;
    since?: number;
  }): Promise<AuditEntry[]> {
    const path = this.filePath();
    if (!existsSync(path)) return [];

    try {
      const raw = await readFile(path, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      const entries: AuditEntry[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as AuditEntry;
          if (filter.actor && entry.actor !== filter.actor) continue;
          if (filter.operation && entry.operation !== filter.operation) continue;
          if (filter.since && entry.timestamp < filter.since) continue;
          entries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }

      return entries;
    } catch {
      return [];
    }
  }
}
