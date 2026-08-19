import { describe, expect, it } from "vitest";
import {
  collectOpenPolicyAllowFromWarnings,
  maybeRepairOpenPolicyAllowFrom,
} from "./open-policy-allowfrom.js";

describe("doctor open-policy allowFrom repair", () => {
  it('adds top-level wildcard when dmPolicy="open" has no allowFrom', () => {
    const result = maybeRepairOpenPolicyAllowFrom({
      channels: {
        signal: {
          dmPolicy: "open",
        },
      },
    });

    expect(result.changes).toEqual([
      '- channels.signal.allowFrom: set to ["*"] (required by dmPolicy="open")',
    ]);
    expect(result.config.channels?.signal?.allowFrom).toEqual(["*"]);
  });

  // googlechat/matrix/discord ship no bundled plugin here, so their nested dm
  // policy canonicalizes to dmPolicy + top-level allowFrom (topOnly mode).
  it("canonicalizes nested-only googlechat dm policy to top-level allowFrom", () => {
    const result = maybeRepairOpenPolicyAllowFrom({
      channels: {
        googlechat: {
          dm: {
            policy: "open",
          },
        },
      },
    });

    expect(result.changes).toEqual([
      '- channels.googlechat.dmPolicy: set to "open" (migrated from channels.googlechat.dm.policy)',
      '- channels.googlechat.allowFrom: set to ["*"] (required by dmPolicy="open")',
    ]);
    expect(result.config.channels?.googlechat?.dmPolicy).toBe("open");
    expect(result.config.channels?.googlechat?.dm).toBeUndefined();
    expect(result.config.channels?.googlechat?.allowFrom).toEqual(["*"]);
  });

  it("canonicalizes nested-only matrix dm policy to top-level allowFrom", () => {
    const result = maybeRepairOpenPolicyAllowFrom({
      channels: {
        matrix: {
          dm: {
            policy: "open",
          },
        },
      },
    });

    expect(result.changes).toEqual([
      '- channels.matrix.dmPolicy: set to "open" (migrated from channels.matrix.dm.policy)',
      '- channels.matrix.allowFrom: set to ["*"] (required by dmPolicy="open")',
    ]);
    expect(result.config.channels?.matrix?.dmPolicy).toBe("open");
    expect(result.config.channels?.matrix?.dm).toBeUndefined();
    expect(result.config.channels?.matrix?.allowFrom).toEqual(["*"]);
  });

  it("sets top-level wildcard for discord when nested dm allowFrom has no wildcard", () => {
    const result = maybeRepairOpenPolicyAllowFrom({
      channels: {
        discord: {
          dm: {
            policy: "open",
            allowFrom: ["123"],
          },
        },
      },
    });

    expect(result.changes).toEqual([
      '- channels.discord.dmPolicy: set to "open" (migrated from channels.discord.dm.policy)',
      '- channels.discord.allowFrom: set to ["*"] (required by dmPolicy="open")',
    ]);
    expect(result.config.channels?.discord?.dmPolicy).toBe("open");
    expect(result.config.channels?.discord?.allowFrom).toEqual(["*"]);
    expect(result.config.channels?.discord?.dm?.allowFrom).toEqual(["123"]);
  });

  it("formats open-policy wildcard warnings", () => {
    const warnings = collectOpenPolicyAllowFromWarnings({
      changes: ['- channels.signal.allowFrom: set to ["*"] (required by dmPolicy="open")'],
      doctorFixCommand: "kaijibot doctor --fix",
    });

    expect(warnings).toEqual([
      expect.stringContaining('channels.signal.allowFrom: set to ["*"]'),
      expect.stringContaining('Run "kaijibot doctor --fix"'),
    ]);
  });
});
