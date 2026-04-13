import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PersonaStore, createDefaultPersona } from "./store.js";

describe("PersonaStore", () => {
  let tempDir: string;
  let store: PersonaStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cognitive-test-"));
    store = new PersonaStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns undefined for non-existent persona", async () => {
    const result = await store.load("user-123");
    expect(result).toBeUndefined();
  });

  it("creates and loads a default persona", async () => {
    const persona = await store.loadOrCreate("user-123");
    expect(persona.identity.coreTraits).toEqual({});
    expect(persona.rapport.trustScore).toBe(0.1);
  });

  it("saves and loads persona", async () => {
    const persona = createDefaultPersona();
    persona.identity.coreTraits = {
      技术决策者: {
        value: "是",
        confidence: 0.8,
        evidenceCount: 1,
        lastUpdated: Date.now(),
        source: "explicit",
      },
    };
    await store.save("user-123", persona);
    const loaded = await store.load("user-123");
    expect(loaded?.identity.coreTraits["技术决策者"].value).toBe("是");
  });

  it("round-trips persona data correctly", async () => {
    const persona = createDefaultPersona();
    persona.domains["AI/机器学习"] = {
      depth: 5,
      recurrence: 3,
      lastMentioned: Date.now(),
      keyInsights: ["偏好 Rust 实现"],
      activeQuestions: ["如何优化推理延迟?"],
      connections: ["软件架构"],
    };
    await store.save("user-123", persona);
    const loaded = await store.load("user-123");
    expect(loaded?.domains["AI/机器学习"]).toEqual(persona.domains["AI/机器学习"]);
  });

  it("loadOrCreate returns valid persona from well-formed JSON", async () => {
    const persona = createDefaultPersona();
    persona.identity.coreTraits = {
      架构师: {
        value: "是",
        confidence: 0.9,
        evidenceCount: 5,
        lastUpdated: Date.now(),
        source: "explicit",
      },
    };
    await store.save("user-456", persona);
    const loaded = await store.loadOrCreate("user-456");
    expect(loaded.identity.coreTraits["架构师"].value).toBe("是");
    expect(loaded.rapport.trustScore).toBe(0.1);
  });

  it("loadOrCreate returns default persona from malformed JSON", async () => {
    const dir = join(tempDir, "cognitive", "persona");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "user-corrupt.json"), "{not valid json!!!", "utf-8");

    const loaded = await store.loadOrCreate("user-corrupt");
    expect(loaded.identity.coreTraits).toEqual({});
    expect(loaded.rapport.trustScore).toBe(0.1);
  });

  it("loadOrCreate returns default persona from JSON with missing required fields", async () => {
    const dir = join(tempDir, "cognitive", "persona");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "user-missing.json"), JSON.stringify({
      identity: { coreTraits: {} },
      // missing domains, recentFocus, activeProjects, pendingQuestions, feedbackProfile, rapport
    }), "utf-8");

    const loaded = await store.loadOrCreate("user-missing");
    expect(loaded.identity.coreTraits).toEqual({});
    expect(loaded.rapport.trustScore).toBe(0.1);
  });

  it("round-trip: save then load preserves all PersonaTree fields", async () => {
    const persona = createDefaultPersona();
    persona.identity.communicationStyle = {
      formality: "casual",
      verbosity: "concise",
      technicalLevel: "expert",
      preferredLanguage: "zh",
    };
    persona.identity.timezone = "Asia/Shanghai";
    persona.identity.primaryLanguage = "zh";
    persona.identity.expertDomains = ["TypeScript", "System Design"];
    persona.identity.interestDomains = ["AI Safety"];
    persona.identity.curiosityDomains = ["Quantum Computing"];
    persona.identity.coreTraits = {
      细节导向: { value: "是", confidence: 0.85, evidenceCount: 10, lastUpdated: Date.now(), source: "observed" },
    };
    persona.domains["分布式系统"] = {
      depth: 8,
      recurrence: 15,
      lastMentioned: Date.now(),
      keyInsights: ["偏好 CAP 定理分析"],
      activeQuestions: ["CQRS 在高并发下的瓶颈?"],
      connections: ["微服务", "事件驱动"],
    };
    persona.recentFocus = ["Kubernetes", "eBPF"];
    persona.activeProjects = ["Sidecar Proxy"];
    persona.pendingQuestions = ["如何实现零停机部署?"];
    persona.feedbackProfile = {
      topicBandits: {
        "分布式系统": { alpha: 3, beta: 1 },
      },
      preferredStyle: "question",
      optimalFrequencyHours: 6,
      lastProactiveAt: Date.now(),
      suppressUntil: Date.now() + 86400000,
    };
    persona.rapport = {
      trustScore: 0.7,
      totalExchanges: 42,
      avgResponseLength: 150,
      selfDisclosureLevel: 0.5,
    };

    await store.save("user-full", persona);
    const loaded = await store.load("user-full");

    expect(loaded).toBeDefined();
    expect(loaded!.identity.communicationStyle).toEqual(persona.identity.communicationStyle);
    expect(loaded!.identity.timezone).toBe("Asia/Shanghai");
    expect(loaded!.identity.expertDomains).toEqual(["TypeScript", "System Design"]);
    expect(loaded!.domains["分布式系统"].depth).toBe(8);
    expect(loaded!.recentFocus).toEqual(["Kubernetes", "eBPF"]);
    expect(loaded!.feedbackProfile.topicBandits["分布式系统"]).toEqual({ alpha: 3, beta: 1 });
    expect(loaded!.feedbackProfile.suppressUntil).toBe(persona.feedbackProfile.suppressUntil);
    expect(loaded!.rapport.trustScore).toBe(0.7);
    expect(loaded!.rapport.selfDisclosureLevel).toBe(0.5);
  });

  describe("listUserIds", () => {
    it("returns empty array when persona directory does not exist", async () => {
      const result = await store.listUserIds();
      expect(result).toEqual([]);
    });

    it("returns sorted user IDs from .json filenames", async () => {
      await store.save("charlie", createDefaultPersona());
      await store.save("alice", createDefaultPersona());
      await store.save("bob", createDefaultPersona());

      const result = await store.listUserIds();
      expect(result).toEqual(["alice", "bob", "charlie"]);
    });

    it("ignores non-.json files in persona directory", async () => {
      const dir = join(tempDir, "cognitive", "persona");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "user1.json"), "{}", "utf-8");
      writeFileSync(join(dir, "readme.txt"), "ignore me", "utf-8");
      writeFileSync(join(dir, ".gitkeep"), "", "utf-8");

      const result = await store.listUserIds();
      expect(result).toEqual(["user1"]);
    });

    it("returns empty array when directory is empty", async () => {
      const dir = join(tempDir, "cognitive", "persona");
      mkdirSync(dir, { recursive: true });

      const result = await store.listUserIds();
      expect(result).toEqual([]);
    });
  });
});
