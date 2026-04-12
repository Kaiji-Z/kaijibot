import { describe, expect, it } from "vitest";
import { normalizePackageTagInput } from "./package-tag.js";

describe("normalizePackageTagInput", () => {
  const packageNames = ["kaijibot", "@kaijibot/plugin"] as const;

  it.each([
    { input: undefined, expected: null },
    { input: "   ", expected: null },
    { input: "kaijibot@beta", expected: "beta" },
    { input: "@kaijibot/plugin@2026.2.24", expected: "2026.2.24" },
    { input: "kaijibot@   ", expected: null },
    { input: "kaijibot", expected: null },
    { input: " @kaijibot/plugin ", expected: null },
    { input: " latest ", expected: "latest" },
    { input: "@other/plugin@beta", expected: "@other/plugin@beta" },
    { input: "kaijiboter@beta", expected: "kaijiboter@beta" },
  ] satisfies ReadonlyArray<{ input: string | undefined; expected: string | null }>)(
    "normalizes %j",
    ({ input, expected }) => {
      expect(normalizePackageTagInput(input, packageNames)).toBe(expected);
    },
  );
});
