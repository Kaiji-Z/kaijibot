import { describe, it, expect } from "vitest";
import { PersonaChangeSource } from "./persona-change-source.js";

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

  it("payload includes only truly new domains", () => {
    const source = new PersonaChangeSource();
    const events: Array<{ payload?: unknown }> = [];
    source.onEvent((e) => events.push(e));
    source.checkPersonaUpdate("user1", ["AI", "ML"]);
    source.checkPersonaUpdate("user1", ["AI", "ML", "Rust", "Go"]);
    const payload = events[0]!.payload as { newDomains?: string[]; domainCount?: number };
    expect(payload).toEqual({
      newDomains: ["Rust", "Go"],
      domainCount: 4,
    });
  });
});
