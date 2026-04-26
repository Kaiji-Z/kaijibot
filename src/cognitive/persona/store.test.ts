import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
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
    const result = await store.load("main", "user-123");
    expect(result).toBeUndefined();
  });

  it("creates and loads a default persona", async () => {
    const persona = await store.loadOrCreate("main", "user-123");
    expect(persona.identity.coreTraits).toEqual({});
    expect(persona.rapport.trustScore).toBe(0.1);
  });

  it("sets userId on loadOrCreate", async () => {
    const persona = await store.loadOrCreate("main", "user-abc");
    expect(persona.identity.userId).toBe("user-abc");
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
    await store.save("main", "user-123", persona);
    const loaded = await store.load("main", "user-123");
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
      negationSignals: 0,
    };
    await store.save("main", "user-123", persona);
    const loaded = await store.load("main", "user-123");
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
    await store.save("main", "user-456", persona);
    const loaded = await store.loadOrCreate("main", "user-456");
    expect(loaded.identity.coreTraits["架构师"].value).toBe("是");
    expect(loaded.rapport.trustScore).toBe(0.1);
  });

  it("loadOrCreate returns default persona from malformed JSON", async () => {
    const dir = join(tempDir, "cognitive", "persona", "main");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "user-corrupt.json"), "{not valid json!!!", "utf-8");

    const loaded = await store.loadOrCreate("main", "user-corrupt");
    expect(loaded.identity.coreTraits).toEqual({});
    expect(loaded.rapport.trustScore).toBe(0.1);
  });

  it("loadOrCreate returns default persona from JSON with missing required fields", async () => {
    const dir = join(tempDir, "cognitive", "persona", "main");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "user-missing.json"), JSON.stringify({
      identity: { coreTraits: {} },
      // missing domains, recentFocus, activeProjects, feedbackProfile, rapport
    }), "utf-8");

    const loaded = await store.loadOrCreate("main", "user-missing");
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
      negationSignals: 0,
    };
    persona.recentFocus = ["Kubernetes", "eBPF"];
    persona.activeProjects = ["Sidecar Proxy"];
    persona.feedbackProfile = {
      topicBandits: {
        "分布式系统": { alpha: 3, beta: 1 },
      },
      preferredStyle: "question",
      optimalFrequencyHours: 6,
      lastProactiveAt: Date.now(),
      suppressUntil: Date.now() + 86400000,
      recentInsightIds: [],
      recentInsightContents: [],
    };
    persona.rapport = {
      trustScore: 0.7,
      totalExchanges: 42,
      avgResponseLength: 150,
      selfDisclosureLevel: 0.5,
    };

    await store.save("main", "user-full", persona);
    const loaded = await store.load("main", "user-full");

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
      const result = await store.listUserIds("main");
      expect(result).toEqual([]);
    });

    it("returns sorted user IDs from .json filenames", async () => {
      await store.save("main", "charlie", createDefaultPersona());
      await store.save("main", "alice", createDefaultPersona());
      await store.save("main", "bob", createDefaultPersona());

      const result = await store.listUserIds("main");
      expect(result).toEqual(["alice", "bob", "charlie"]);
    });

    it("ignores non-.json files in persona directory", async () => {
      const dir = join(tempDir, "cognitive", "persona", "main");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "user1.json"), "{}", "utf-8");
      writeFileSync(join(dir, "readme.txt"), "ignore me", "utf-8");
      writeFileSync(join(dir, ".gitkeep"), "", "utf-8");

      const result = await store.listUserIds("main");
      expect(result).toEqual(["user1"]);
    });

    it("returns empty array when directory is empty", async () => {
      const dir = join(tempDir, "cognitive", "persona", "main");
      mkdirSync(dir, { recursive: true });

      const result = await store.listUserIds("main");
      expect(result).toEqual([]);
    });
  });

  describe("listAgentIds", () => {
    it("returns empty array when persona directory does not exist", async () => {
      const result = await store.listAgentIds();
      expect(result).toEqual([]);
    });

    it("returns sorted agent IDs from subdirectories", async () => {
      await store.save("agent-b", "user1", createDefaultPersona());
      await store.save("agent-a", "user1", createDefaultPersona());
      await store.save("main", "user1", createDefaultPersona());

      const result = await store.listAgentIds();
      expect(result).toEqual(["agent-a", "agent-b", "main"]);
    });
  });

  describe("agentId isolation", () => {
    it("isolates personas across agentIds", async () => {
      const persona1 = createDefaultPersona();
      persona1.identity.expertDomains = ["TypeScript"];
      await store.save("agent-a", "user1", persona1);

      const persona2 = createDefaultPersona();
      persona2.identity.expertDomains = ["Python"];
      await store.save("agent-b", "user1", persona2);

      const loadedA = await store.load("agent-a", "user1");
      const loadedB = await store.load("agent-b", "user1");
      expect(loadedA?.identity.expertDomains).toEqual(["TypeScript"]);
      expect(loadedB?.identity.expertDomains).toEqual(["Python"]);
    });

    it("listUserIds only returns IDs for the specified agentId", async () => {
      await store.save("agent-a", "alice", createDefaultPersona());
      await store.save("agent-a", "bob", createDefaultPersona());
      await store.save("agent-b", "charlie", createDefaultPersona());

      const agentAUsers = await store.listUserIds("agent-a");
      const agentBUsers = await store.listUserIds("agent-b");
      expect(agentAUsers).toEqual(["alice", "bob"]);
      expect(agentBUsers).toEqual(["charlie"]);
    });
  });

  describe("migrateFromFlatLayout", () => {
    it("migrates Feishu open_id persona to main/ subdirectory", async () => {
      const persona = createDefaultPersona();
      persona.domains["AI"] = { depth: 1, recurrence: 1, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 };
      persona.rapport.totalExchanges = 5;

      const flatDir = join(tempDir, "cognitive", "persona");
      mkdirSync(flatDir, { recursive: true });
      writeFileSync(join(flatDir, "ou_abc123.json"), JSON.stringify(persona), "utf-8");

      const result = await store.migrateFromFlatLayout();

      expect(result.migrated).toEqual(["ou_abc123"]);
      expect(existsSync(join(flatDir, "ou_abc123.json"))).toBe(false);
      expect(existsSync(join(flatDir, "main", "ou_abc123.json"))).toBe(true);

      const loaded = await store.load("main", "ou_abc123");
      expect(loaded).toBeDefined();
      expect(loaded!.domains["AI"]).toBeDefined();
    });

    it("skips phantom TUI personas", async () => {
      const flatDir = join(tempDir, "cognitive", "persona");
      mkdirSync(flatDir, { recursive: true });
      writeFileSync(join(flatDir, "main.json"), JSON.stringify(createDefaultPersona()), "utf-8");
      writeFileSync(join(flatDir, "kaijibot-tui.json"), JSON.stringify(createDefaultPersona()), "utf-8");

      const result = await store.migrateFromFlatLayout();

      expect(result.migrated).toEqual([]);
      expect(result.skipped).toContain("main");
      expect(result.skipped).toContain("kaijibot-tui");
    });

    it("is idempotent — no-ops on second call", async () => {
      const persona = createDefaultPersona();
      persona.domains["Rust"] = { depth: 2, recurrence: 1, lastMentioned: Date.now(), keyInsights: [], activeQuestions: [], connections: [], negationSignals: 0 };

      const flatDir = join(tempDir, "cognitive", "persona");
      mkdirSync(flatDir, { recursive: true });
      writeFileSync(join(flatDir, "ou_xyz.json"), JSON.stringify(persona), "utf-8");

      const result1 = await store.migrateFromFlatLayout();
      expect(result1.migrated).toEqual(["ou_xyz"]);

      const result2 = await store.migrateFromFlatLayout();
      expect(result2.migrated).toEqual([]);
    });

    it("returns empty when persona directory does not exist", async () => {
      const result = await store.migrateFromFlatLayout();
      expect(result).toEqual({ migrated: [], skipped: [] });
    });
  });
});
