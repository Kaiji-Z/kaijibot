import type { SkillDraft, ClawHubPublishResult } from "./types.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_CREDENTIALS_DIR = "credentials";
const TOKEN_FILE = "clawhub-token";

type PublishBody = {
  slug: string;
  name: string;
  description: string;
  version: string;
  content: string;
  authorId: string;
};

function isValidSkillName(name: string): boolean {
  if (name.includes("..") || name.startsWith("/") || name.includes("\\")) {
    return false;
  }
  return true;
}

function sanitizeContent(content: string): string {
  return content.replace(/\0/g, "");
}

export class ClawHubPublisher {
  private readonly registryUrl: string;
  private readonly configDir: string;

  constructor(registryUrl: string, configDir?: string) {
    this.registryUrl = registryUrl.replace(/\/+$/, "");
    this.configDir = configDir ?? join(homedir(), ".kaijibot");
  }

  private tokenPath(): string {
    return join(this.configDir, DEFAULT_CREDENTIALS_DIR, TOKEN_FILE);
  }

  async readToken(): Promise<string | null> {
    try {
      const token = await readFile(this.tokenPath(), "utf-8");
      return token.trim() || null;
    } catch {
      return null;
    }
  }

  async publishSkill(
    draft: SkillDraft,
    authorId: string,
    version = "1.0.0",
  ): Promise<ClawHubPublishResult> {
    if (!isValidSkillName(draft.name)) {
      throw new Error(`Invalid skill name: ${draft.name}`);
    }

    const token = await this.readToken();
    if (!token) {
      return { ok: false, error: "ClawHub auth token not found" };
    }

    const body: PublishBody = {
      slug: draft.name,
      name: draft.name,
      description: draft.description,
      version,
      content: sanitizeContent(draft.bodyMarkdown),
      authorId,
    };

    try {
      const response = await fetch(`${this.registryUrl}/api/v1/skills`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "Unknown error");
        return { ok: false, error: `HTTP ${response.status}: ${text}` };
      }

      const result = (await response.json()) as { slug: string; version: string };
      return { ok: true, slug: result.slug, version: result.version };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      return { ok: false, error: message };
    }
  }

  async unpublishSkill(name: string): Promise<void> {
    if (!isValidSkillName(name)) {
      throw new Error(`Invalid skill name: ${name}`);
    }

    const token = await this.readToken();
    if (!token) {
      throw new Error("ClawHub auth token not found");
    }

    const response = await fetch(`${this.registryUrl}/api/v1/skills/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
  }
}
