import type { ClawHubSearchResult, ClawHubSkillDetail } from "./types.js";

export class ClawHubCatalog {
  private readonly registryUrl: string;

  constructor(registryUrl: string) {
    this.registryUrl = registryUrl.replace(/\/+$/, "");
  }

  async search(query: string, limit = 10): Promise<ClawHubSearchResult[]> {
    const url = `${this.registryUrl}/api/v1/skills/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return [];
      return (await response.json()) as ClawHubSearchResult[];
    } catch {
      return [];
    }
  }

  async getSkill(slug: string): Promise<ClawHubSkillDetail | null> {
    const url = `${this.registryUrl}/api/v1/skills/${encodeURIComponent(slug)}`;
    try {
      const response = await fetch(url);
      if (response.status === 404) return null;
      if (!response.ok) return null;
      return (await response.json()) as ClawHubSkillDetail;
    } catch {
      return null;
    }
  }

  async listPopular(limit = 10): Promise<ClawHubSearchResult[]> {
    const url = `${this.registryUrl}/api/v1/skills/popular?limit=${limit}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return [];
      return (await response.json()) as ClawHubSearchResult[];
    } catch {
      return [];
    }
  }
}
