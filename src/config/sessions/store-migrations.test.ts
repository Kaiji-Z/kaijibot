import { describe, it, expect } from "vitest";
import { applySessionStoreMigrations } from "./store-migrations.js";
import type { SessionEntry } from "./types.js";

describe("applySessionStoreMigrations", () => {
  it("moves agent:main:main with feishu deliveryContext to per-user key", () => {
    const entry: SessionEntry = {
      sessionId: "legacy",
      updatedAt: Date.now(),
      lastChannel: "feishu",
      lastTo: "user:ou_abc123",
      deliveryContext: { channel: "feishu", to: "user:ou_abc123" },
    };
    const store: Record<string, SessionEntry> = { "agent:main:main": entry };
    applySessionStoreMigrations(store);
    expect(store["agent:main:main"]).toBeUndefined();
    expect(store["agent:main:feishu:direct:ou_abc123"]).toBe(entry);
  });

  it("moves agent:main:main with feishu lastChannel without deliveryContext", () => {
    const entry: SessionEntry = {
      sessionId: "legacy",
      updatedAt: Date.now(),
      lastChannel: "feishu",
      lastTo: "user:ou_def456",
    };
    const store: Record<string, SessionEntry> = { "agent:main:main": entry };
    applySessionStoreMigrations(store);
    expect(store["agent:main:main"]).toBeUndefined();
    expect(store["agent:main:feishu:direct:ou_def456"]).toBe(entry);
  });

  it("does not migrate agent:main:main with non-feishu channel", () => {
    const entry: SessionEntry = {
      sessionId: "legacy",
      updatedAt: Date.now(),
      lastChannel: "telegram",
      lastTo: "12345",
    };
    const store: Record<string, SessionEntry> = { "agent:main:main": entry };
    applySessionStoreMigrations(store);
    expect(store["agent:main:main"]).toBe(entry);
  });

  it("does not migrate agent:main:main with feishu but no open ID in lastTo", () => {
    const entry: SessionEntry = {
      sessionId: "legacy",
      updatedAt: Date.now(),
      lastChannel: "feishu",
      lastTo: "group:12345",
    };
    const store: Record<string, SessionEntry> = { "agent:main:main": entry };
    applySessionStoreMigrations(store);
    expect(store["agent:main:main"]).toBe(entry);
  });

  it("does not overwrite existing per-user key", () => {
    const legacyEntry: SessionEntry = {
      sessionId: "legacy",
      updatedAt: 1000,
      lastChannel: "feishu",
      lastTo: "user:ou_abc123",
    };
    const existingEntry: SessionEntry = {
      sessionId: "existing",
      updatedAt: 2000,
      lastChannel: "feishu",
      lastTo: "user:ou_abc123",
    };
    const store: Record<string, SessionEntry> = {
      "agent:main:main": legacyEntry,
      "agent:main:feishu:direct:ou_abc123": existingEntry,
    };
    applySessionStoreMigrations(store);
    expect(store["agent:main:main"]).toBeUndefined();
    expect(store["agent:main:feishu:direct:ou_abc123"]).toBe(existingEntry);
  });

  it("does nothing when no agent:main:main exists", () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:feishu:direct:ou_xyz": {
        sessionId: "s1",
        updatedAt: Date.now(),
      },
    };
    applySessionStoreMigrations(store);
    expect(Object.keys(store)).toHaveLength(1);
  });

  it("migrates using deliveryContext.to when lastTo is absent", () => {
    const entry: SessionEntry = {
      sessionId: "legacy",
      updatedAt: Date.now(),
      channel: "feishu",
      deliveryContext: { channel: "feishu", to: "user:ou_from_dc" },
    };
    const store: Record<string, SessionEntry> = { "agent:main:main": entry };
    applySessionStoreMigrations(store);
    expect(store["agent:main:main"]).toBeUndefined();
    expect(store["agent:main:feishu:direct:ou_from_dc"]).toBe(entry);
  });
});
