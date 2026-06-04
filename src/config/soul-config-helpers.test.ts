import { describe, expect, it } from "vitest";
import { removeSoulFromConfig, setSoulInConfig } from "./soul-config-helpers.js";

type Config = Parameters<typeof setSoulInConfig>[0];

describe("setSoulInConfig", () => {
  it("S1: single agent, no list — creates list entry, NOT defaults", () => {
    const config: Config = {};
    setSoulInConfig(config, "main", "intj");

    expect(config.agents?.list).toEqual([{ id: "main", soul: { preset: "intj" } }]);
    expect(config.agents?.defaults?.soul).toBeUndefined();
  });

  it("S2: multi agent, entry exists — updates per-agent soul", () => {
    const config: Config = {
      agents: {
        list: [{ id: "main" }, { id: "researcher" }],
      },
    };
    setSoulInConfig(config, "main", "intj");

    expect(config.agents?.list?.[0].soul?.preset).toBe("intj");
    expect(config.agents?.list?.[1].soul).toBeUndefined();
    expect(config.agents?.defaults?.soul).toBeUndefined();
  });

  it("S3: agent not in list — creates new list entry", () => {
    const config: Config = {
      agents: {
        list: [{ id: "researcher" }],
      },
    };
    setSoulInConfig(config, "main", "intj");

    expect(config.agents?.list).toHaveLength(2);
    const main = config.agents?.list?.find((e) => e.id === "main");
    expect(main?.soul?.preset).toBe("intj");
  });

  it("S4: empty list — creates first entry", () => {
    const config: Config = {
      agents: { list: [] },
    };
    setSoulInConfig(config, "main", "entp");

    expect(config.agents?.list).toEqual([{ id: "main", soul: { preset: "entp" } }]);
  });

  it("S5: case-insensitive agentId match", () => {
    const config: Config = {
      agents: { list: [{ id: "Main" }] },
    };
    setSoulInConfig(config, "main", "intj");

    expect(config.agents?.list?.[0].soul?.preset).toBe("intj");
  });

  it("S6: overwrites existing soul preset", () => {
    const config: Config = {
      agents: { list: [{ id: "main", soul: { preset: "intj" } }] },
    };
    setSoulInConfig(config, "main", "entp");

    expect(config.agents?.list?.[0].soul?.preset).toBe("entp");
  });

  it("S7: NEVER writes to agents.defaults", () => {
    const config: Config = {};
    setSoulInConfig(config, "main", "intj");

    expect(config.agents?.defaults?.soul).toBeUndefined();
  });

  it("S8: NEVER writes to global soul.preset", () => {
    const config: Config = {};
    setSoulInConfig(config, "main", "intj");

    expect(config.soul).toBeUndefined();
  });
});

describe("removeSoulFromConfig", () => {
  it("R1: removes per-agent soul from list entry", () => {
    const config: Config = {
      agents: {
        list: [{ id: "main", soul: { preset: "intj" } }],
      },
    };
    removeSoulFromConfig(config, "main");

    expect(config.agents?.list?.[0].soul).toBeUndefined();
  });

  it("R2: agent not in list — no-op, does not touch defaults", () => {
    const config: Config = {
      agents: {
        defaults: { soul: { preset: "entp" } },
        list: [{ id: "researcher" }],
      },
    };
    removeSoulFromConfig(config, "main");

    expect(config.agents?.defaults?.soul?.preset).toBe("entp");
    expect(config.agents?.list?.[0].soul).toBeUndefined();
  });

  it("R3: no list at all — no-op", () => {
    const config: Config = {
      agents: { defaults: { soul: { preset: "entp" } } },
    };
    removeSoulFromConfig(config, "main");

    expect(config.agents?.defaults?.soul?.preset).toBe("entp");
  });

  it("R4: case-insensitive agentId match", () => {
    const config: Config = {
      agents: { list: [{ id: "Main", soul: { preset: "intj" } }] },
    };
    removeSoulFromConfig(config, "MAIN");

    expect(config.agents?.list?.[0].soul).toBeUndefined();
  });
});
