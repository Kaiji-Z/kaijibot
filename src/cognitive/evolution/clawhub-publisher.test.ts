import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClawHubPublisher } from "./clawhub-publisher.js";
import type { SkillDraft } from "./types.js";

let tempDir: string;
let publisher: ClawHubPublisher;

function makeDraft(overrides: Partial<SkillDraft> = {}): SkillDraft {
  return {
    name: "test-skill",
    description: "A test skill",
    triggerPhrases: ["test"],
    bodyMarkdown: "# Test Skill\n\nBody content.",
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

function mockFetch(responses: Record<string, { ok: boolean; status: number; json?: unknown; text?: string }>) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
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

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kaijibot-clawhub-pub-test-"));
  mkdirSync(join(tempDir, "credentials"), { recursive: true });
  publisher = new ClawHubPublisher("https://clawhub.test", tempDir);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("ClawHubPublisher", () => {
  it("publishSkill returns ok:true with valid draft", async () => {
    writeFileSync(join(tempDir, "credentials", "clawhub-token"), "test-token");

    mockFetch({
      "/api/v1/skills": {
        ok: true,
        status: 200,
        json: { slug: "test-skill", version: "1.0.0" },
      },
    });

    const result = await publisher.publishSkill(makeDraft(), "user-1");
    expect(result).toEqual({ ok: true, slug: "test-skill", version: "1.0.0" });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("publishSkill sends correct request body and auth header", async () => {
    writeFileSync(join(tempDir, "credentials", "clawhub-token"), "my-secret-token");

    const bodies: RequestInit[] = [];
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(init ?? {});
      return new Response(JSON.stringify({ slug: "test-skill", version: "1.0.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;

    await publisher.publishSkill(makeDraft(), "user-42", "2.1.0");

    expect(bodies).toHaveLength(1);
    const body = JSON.parse(bodies[0].body as string);
    expect(body).toEqual({
      slug: "test-skill",
      name: "test-skill",
      description: "A test skill",
      version: "2.1.0",
      content: "# Test Skill\n\nBody content.",
      authorId: "user-42",
    });
    expect((bodies[0].headers as Record<string, string>)["Authorization"]).toBe("Bearer my-secret-token");
  });

  it("publishSkill throws on path traversal name", async () => {
    await expect(publisher.publishSkill(makeDraft({ name: "../etc/passwd" }), "user-1")).rejects.toThrow(
      "Invalid skill name",
    );
  });

  it("publishSkill throws on absolute path name", async () => {
    await expect(publisher.publishSkill(makeDraft({ name: "/tmp/evil" }), "user-1")).rejects.toThrow(
      "Invalid skill name",
    );
  });

  it("publishSkill throws on backslash name", async () => {
    await expect(publisher.publishSkill(makeDraft({ name: "foo\\bar" }), "user-1")).rejects.toThrow(
      "Invalid skill name",
    );
  });

  it("publishSkill returns ok:false when token missing", async () => {
    const result = await publisher.publishSkill(makeDraft(), "user-1");
    expect(result).toEqual({ ok: false, error: "ClawHub auth token not found" });
  });

  it("publishSkill returns ok:false on HTTP error", async () => {
    writeFileSync(join(tempDir, "credentials", "clawhub-token"), "test-token");

    mockFetch({
      "/api/v1/skills": { ok: false, status: 422, text: "Validation failed" },
    });

    const result = await publisher.publishSkill(makeDraft(), "user-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("422");
      expect(result.error).toContain("Validation failed");
    }
  });

  it("publishSkill returns ok:false on network error", async () => {
    writeFileSync(join(tempDir, "credentials", "clawhub-token"), "test-token");

    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;

    const result = await publisher.publishSkill(makeDraft(), "user-1");
    expect(result).toEqual({ ok: false, error: "ECONNREFUSED" });
  });

  it("unpublishSkill succeeds on 200", async () => {
    writeFileSync(join(tempDir, "credentials", "clawhub-token"), "test-token");

    mockFetch({
      "/api/v1/skills/test-skill": { ok: true, status: 200 },
    });

    await expect(publisher.unpublishSkill("test-skill")).resolves.toBeUndefined();
  });

  it("unpublishSkill throws on HTTP error", async () => {
    writeFileSync(join(tempDir, "credentials", "clawhub-token"), "test-token");

    mockFetch({
      "/api/v1/skills/test-skill": { ok: false, status: 403, text: "Forbidden" },
    });

    await expect(publisher.unpublishSkill("test-skill")).rejects.toThrow("403");
  });

  it("unpublishSkill throws on invalid name", async () => {
    await expect(publisher.unpublishSkill("../evil")).rejects.toThrow("Invalid skill name");
  });

  it("readToken returns null when token file missing", async () => {
    const token = await publisher.readToken();
    expect(token).toBeNull();
  });

  it("readToken returns trimmed token value", async () => {
    writeFileSync(join(tempDir, "credentials", "clawhub-token"), "  my-token  \n");
    const token = await publisher.readToken();
    expect(token).toBe("my-token");
  });
});
