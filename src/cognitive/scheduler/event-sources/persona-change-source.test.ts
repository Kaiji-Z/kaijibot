import { describe, it, expect } from "vitest";
import type { SchedulerEvent } from "../types.js";
import { PersonaChangeSource, dispatchSchedulerEvent } from "./persona-change-source.js";

describe("PersonaChangeSource", () => {
  it("first call establishes baseline without firing", () => {
    const source = new PersonaChangeSource();
    const events: unknown[] = [];
    source.onEvent((e) => events.push(e));
    source.checkPersonaUpdate("user1", ["AI", "ML", "Rust"]);
    expect(events.length).toBe(0);
  });

  it("does not fire when domains unchanged — no feedback loop", () => {
    const source = new PersonaChangeSource();
    const events: unknown[] = [];
    source.onEvent((e) => events.push(e));
    source.checkPersonaUpdate("user1", ["AI", "ML"]);
    source.checkPersonaUpdate("user1", ["AI", "ML"]);
    source.checkPersonaUpdate("user1", ["AI", "ML"]);
    expect(events.length).toBe(0);
  });

  it("does not fire for single new domain", () => {
    const source = new PersonaChangeSource();
    const events: unknown[] = [];
    source.onEvent((e) => events.push(e));
    source.checkPersonaUpdate("user1", ["AI"]);
    source.checkPersonaUpdate("user1", ["AI", "ML"]);
    expect(events.length).toBe(0);
  });

  it("fires when 2+ truly new domains discovered", () => {
    const source = new PersonaChangeSource();
    const events: Array<{ payload?: unknown }> = [];
    source.onEvent((e) => events.push(e));
    source.checkPersonaUpdate("user1", ["AI"]);
    source.checkPersonaUpdate("user1", ["AI", "ML", "Rust"]);
    expect(events.length).toBe(1);
    const payload = events[0]!.payload as { newDomains?: string[] };
    expect(payload.newDomains).toEqual(["ML", "Rust"]);
  });

  it("fires when 2+ domains removed", () => {
    const source = new PersonaChangeSource();
    const events: unknown[] = [];
    source.onEvent((e) => events.push(e));
    source.checkPersonaUpdate("user1", ["AI", "ML", "Rust"]);
    source.checkPersonaUpdate("user1", ["AI"]);
    expect(events.length).toBe(1);
  });

  it("tracks users independently", () => {
    const source = new PersonaChangeSource();
    const events: unknown[] = [];
    source.onEvent((e) => events.push(e));
    source.checkPersonaUpdate("user1", ["AI"]);
    source.checkPersonaUpdate("user2", ["ML", "Rust", "Go"]);
    source.checkPersonaUpdate("user1", ["AI", "ML", "Rust"]);
    source.checkPersonaUpdate("user2", ["ML", "Rust", "Go", "Python", "JS"]);
    expect(events.length).toBe(2);
  });

  it("debounce: does not fire twice within 5 minutes", () => {
    const source = new PersonaChangeSource();
    const events: unknown[] = [];
    source.onEvent((e) => events.push(e));
    source.checkPersonaUpdate("user1", ["AI"]);
    source.checkPersonaUpdate("user1", ["AI", "ML", "Rust"]);
    source.checkPersonaUpdate("user1", ["AI", "ML", "Rust", "Go", "Python"]);
    expect(events.length).toBe(1);
  });

  it("payload names the user and includes only truly new domains", () => {
    const source = new PersonaChangeSource();
    const events: Array<{ payload?: unknown }> = [];
    source.onEvent((e) => events.push(e));
    source.checkPersonaUpdate("user1", ["AI", "ML"]);
    source.checkPersonaUpdate("user1", ["AI", "ML", "Rust", "Go"]);
    const payload = events[0]!.payload as {
      userId?: string;
      newDomains?: string[];
      domainCount?: number;
    };
    expect(payload).toEqual({
      userId: "user1",
      newDomains: ["Rust", "Go"],
      domainCount: 4,
    });
  });
});

describe("dispatchSchedulerEvent", () => {
  const entries = [
    { agentId: "main", userId: "alice" },
    { agentId: "main", userId: "bob" },
    { agentId: "second", userId: "alice" },
  ];

  async function collect(event: SchedulerEvent) {
    const processed: string[] = [];
    await dispatchSchedulerEvent(event, entries, async (entry) => {
      processed.push(`${entry.agentId}/${entry.userId}`);
    });
    return processed;
  }

  it("routes a persona change to the user it concerns only", async () => {
    const source = new PersonaChangeSource();
    const events: SchedulerEvent[] = [];
    source.onEvent((e) => events.push(e));
    source.checkPersonaUpdate("bob", ["AI"]);
    source.checkPersonaUpdate("bob", ["AI", "ML", "Rust"]);

    // The event's new domains become insight targets: alice never mentioned them.
    expect(await collect(events[0]!)).toEqual(["main/bob"]);
  });

  it("broadcasts events that are not persona changes to every entry", async () => {
    const event: SchedulerEvent = { type: "info_scan", timestamp: Date.now() };

    expect(await collect(event)).toEqual(["main/alice", "main/bob", "second/alice"]);
  });

  it("drops a persona change that names no user", async () => {
    const event: SchedulerEvent = {
      type: "persona_change",
      timestamp: Date.now(),
      payload: { newDomains: ["ML", "Rust"], domainCount: 3 },
    };

    expect(await collect(event)).toEqual([]);
  });
});
