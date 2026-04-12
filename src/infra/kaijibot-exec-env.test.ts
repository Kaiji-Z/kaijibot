import { describe, expect, it } from "vitest";
import {
  ensureKaijiBotExecMarkerOnProcess,
  markKaijiBotExecEnv,
  KAIJIBOT_CLI_ENV_VALUE,
  KAIJIBOT_CLI_ENV_VAR,
} from "./kaijibot-exec-env.js";

describe("markKaijiBotExecEnv", () => {
  it("returns a cloned env object with the exec marker set", () => {
    const env = { PATH: "/usr/bin", KAIJIBOT_CLI: "0" };
    const marked = markKaijiBotExecEnv(env);

    expect(marked).toEqual({
      PATH: "/usr/bin",
      KAIJIBOT_CLI: KAIJIBOT_CLI_ENV_VALUE,
    });
    expect(marked).not.toBe(env);
    expect(env.KAIJIBOT_CLI).toBe("0");
  });
});

describe("ensureKaijiBotExecMarkerOnProcess", () => {
  it.each([
    {
      name: "mutates and returns the provided process env",
      env: { PATH: "/usr/bin" } as NodeJS.ProcessEnv,
    },
    {
      name: "overwrites an existing marker on the provided process env",
      env: { PATH: "/usr/bin", [KAIJIBOT_CLI_ENV_VAR]: "0" } as NodeJS.ProcessEnv,
    },
  ])("$name", ({ env }) => {
    expect(ensureKaijiBotExecMarkerOnProcess(env)).toBe(env);
    expect(env[KAIJIBOT_CLI_ENV_VAR]).toBe(KAIJIBOT_CLI_ENV_VALUE);
  });

  it("defaults to mutating process.env when no env object is provided", () => {
    const previous = process.env[KAIJIBOT_CLI_ENV_VAR];
    delete process.env[KAIJIBOT_CLI_ENV_VAR];

    try {
      expect(ensureKaijiBotExecMarkerOnProcess()).toBe(process.env);
      expect(process.env[KAIJIBOT_CLI_ENV_VAR]).toBe(KAIJIBOT_CLI_ENV_VALUE);
    } finally {
      if (previous === undefined) {
        delete process.env[KAIJIBOT_CLI_ENV_VAR];
      } else {
        process.env[KAIJIBOT_CLI_ENV_VAR] = previous;
      }
    }
  });
});
