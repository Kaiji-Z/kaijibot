import { describe, it, expect } from "vitest";
import { PersonaChangeSource } from "./persona-change-source.js";

describe("PersonaChangeSource", () => {
  it("does not fire for single new domain", () => {
    const source = new PersonaChangeSource();
    const events: unknown[] = [];
    source.onEvent((e) => events.push(e));

    source.checkPersonaUpdate(1, ["AI"]);
    expect(events.length).toBe(0);
  });

  it("fires when 2+ new domains are discovered", () => {
    const source = new PersonaChangeSource();
    const events: unknown[] = [];
    source.onEvent((e) => events.push(e));

    source.checkPersonaUpdate(2, ["AI", "数据科学"]);
    expect(events.length).toBe(1);
  });

  it("fires when domain count changes by 2+", () => {
    const source = new PersonaChangeSource();
    const events: unknown[] = [];
    source.onEvent((e) => events.push(e));

    source.checkPersonaUpdate(0, []);
    source.checkPersonaUpdate(3, []);
    expect(events.length).toBe(1);
  });

  it("does not fire on incremental changes", () => {
    const source = new PersonaChangeSource();
    const events: unknown[] = [];
    source.onEvent((e) => events.push(e));

    source.checkPersonaUpdate(0, []);
    source.checkPersonaUpdate(1, ["AI"]);
    expect(events.length).toBe(0);
  });

  it("includes payload with event", () => {
    const source = new PersonaChangeSource();
    const events: Array<{ payload?: unknown }> = [];
    source.onEvent((e) => events.push(e));

    source.checkPersonaUpdate(2, ["AI", "数据科学"]);
    expect(events[0].payload).toEqual({
      newDomains: ["AI", "数据科学"],
      domainCount: 2,
    });
  });
});
