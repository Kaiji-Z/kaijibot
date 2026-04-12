import { describe, expect, it } from "vitest";
import {
  shouldEagerRegisterSubcommands,
  shouldRegisterPrimaryCommandOnly,
  shouldRegisterPrimarySubcommandOnly,
  shouldSkipPluginCommandRegistration,
} from "./command-registration-policy.js";

describe("command-registration-policy", () => {
  it("matches primary command registration policy", () => {
    expect(shouldRegisterPrimaryCommandOnly(["node", "kaijibot", "status"])).toBe(true);
    expect(shouldRegisterPrimaryCommandOnly(["node", "kaijibot", "status", "--help"])).toBe(true);
    expect(shouldRegisterPrimaryCommandOnly(["node", "kaijibot", "-V"])).toBe(false);
    expect(shouldRegisterPrimaryCommandOnly(["node", "kaijibot", "acp", "-v"])).toBe(true);
  });

  it("matches plugin registration skip policy", () => {
    expect(
      shouldSkipPluginCommandRegistration({
        argv: ["node", "kaijibot", "--help"],
        primary: null,
        hasBuiltinPrimary: false,
      }),
    ).toBe(true);
    expect(
      shouldSkipPluginCommandRegistration({
        argv: ["node", "kaijibot", "config", "--help"],
        primary: "config",
        hasBuiltinPrimary: true,
      }),
    ).toBe(true);
    expect(
      shouldSkipPluginCommandRegistration({
        argv: ["node", "kaijibot", "voicecall", "--help"],
        primary: "voicecall",
        hasBuiltinPrimary: false,
      }),
    ).toBe(false);
  });

  it("matches lazy subcommand registration policy", () => {
    expect(shouldEagerRegisterSubcommands({ KAIJIBOT_DISABLE_LAZY_SUBCOMMANDS: "1" })).toBe(true);
    expect(shouldEagerRegisterSubcommands({ KAIJIBOT_DISABLE_LAZY_SUBCOMMANDS: "0" })).toBe(false);
    expect(shouldRegisterPrimarySubcommandOnly(["node", "kaijibot", "acp"], {})).toBe(true);
    expect(shouldRegisterPrimarySubcommandOnly(["node", "kaijibot", "acp", "--help"], {})).toBe(
      true,
    );
    expect(
      shouldRegisterPrimarySubcommandOnly(["node", "kaijibot", "acp"], {
        KAIJIBOT_DISABLE_LAZY_SUBCOMMANDS: "1",
      }),
    ).toBe(false);
  });
});
