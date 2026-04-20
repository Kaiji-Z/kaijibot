import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ClawHubCatalog } from "./clawhub-catalog.js";
import type { ClawHubSearchResult, ClawHubSkillDetail } from "./types.js";

let catalog: ClawHubCatalog;

const originalFetch = globalThis.fetch;

const sampleResults: ClawHubSearchResult[] = [
  { slug: "weather-check", name: "Weather Check", description: "Checks the weather", version: "1.2.0", downloads: 150, author: "alice" },
  { slug: "pdf-summarizer", name: "PDF Summarizer", description: "Summarizes PDFs", version: "2.0.0", downloads: 300, author: "bob" },
];

const sampleDetail: ClawHubSkillDetail = {
  slug: "weather-check",
  name: "Weather Check",
  description: "Checks the weather",
  version: "1.2.0",
  downloads: 150,
  author: "alice",
  content: "# Weather Check\n\n## Usage\nAsk about weather.",
  changelog: "v1.2.0: Added forecast",
};

beforeEach(() => {
  catalog = new ClawHubCatalog("https://clawhub.test");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(responses: Record<string, { ok: boolean; status: number; json?: unknown; text?: string }>) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const key = Object.keys(responses).find((k) => urlStr.includes(k));
    if (!key) return new Response("Not found", { status: 404 });

    const config = responses[key];
    const body = config.json ? JSON.stringify(config.json) : (config.text ?? "");
    const resp = new Response(body, {
      status: config.status,
      headers: { "Content-Type": "application/json" },
    });
    Object.defineProperty(resp, "ok", { value: config.ok });
    return resp;
  }) as unknown as typeof globalThis.fetch;
}

describe("ClawHubCatalog", () => {
  it("search returns matching results", async () => {
    mockFetch({
      "/api/v1/skills/search": { ok: true, status: 200, json: sampleResults },
    });

    const results = await catalog.search("weather");
    expect(results).toHaveLength(2);
    expect(results[0].slug).toBe("weather-check");
    expect(results[1].slug).toBe("pdf-summarizer");
  });

  it("search passes limit parameter", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      calls.push(typeof url === "string" ? url : url.toString());
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof globalThis.fetch;

    await catalog.search("test", 5);
    expect(calls[0]).toContain("limit=5");
  });

  it("search returns empty array on network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;

    const results = await catalog.search("weather");
    expect(results).toEqual([]);
  });

  it("search returns empty array on HTTP error", async () => {
    mockFetch({
      "/api/v1/skills/search": { ok: false, status: 500, text: "Internal Server Error" },
    });

    const results = await catalog.search("weather");
    expect(results).toEqual([]);
  });

  it("getSkill returns skill detail for valid slug", async () => {
    mockFetch({
      "/api/v1/skills/weather-check": { ok: true, status: 200, json: sampleDetail },
    });

    const skill = await catalog.getSkill("weather-check");
    expect(skill).not.toBeNull();
    expect(skill!.slug).toBe("weather-check");
    expect(skill!.content).toContain("Weather Check");
    expect(skill!.changelog).toBe("v1.2.0: Added forecast");
  });

  it("getSkill returns null for 404", async () => {
    mockFetch({
      "/api/v1/skills/missing-skill": { ok: false, status: 404, text: "Not found" },
    });

    const skill = await catalog.getSkill("missing-skill");
    expect(skill).toBeNull();
  });

  it("getSkill returns null on network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof globalThis.fetch;

    const skill = await catalog.getSkill("weather-check");
    expect(skill).toBeNull();
  });

  it("listPopular returns popular skills", async () => {
    mockFetch({
      "/api/v1/skills/popular": { ok: true, status: 200, json: sampleResults },
    });

    const results = await catalog.listPopular();
    expect(results).toHaveLength(2);
    expect(results[0].downloads).toBe(150);
  });

  it("listPopular passes limit parameter", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      calls.push(typeof url === "string" ? url : url.toString());
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof globalThis.fetch;

    await catalog.listPopular(20);
    expect(calls[0]).toContain("limit=20");
  });

  it("listPopular returns empty array on network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("DNS lookup failed");
    }) as unknown as typeof globalThis.fetch;

    const results = await catalog.listPopular();
    expect(results).toEqual([]);
  });
});
