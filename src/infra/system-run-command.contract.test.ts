import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { resolveSystemRunCommandRequest } from "./system-run-command.js";

type ContractFixture = {
  cases: ContractCase[];
};

type ContractCase = {
  name: string;
  command: string[];
  rawCommand?: string;
  expected: {
    valid: boolean;
    displayCommand?: string;
    errorContains?: string;
  };
};

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/system-run-command-contract.json",
);
// CI runners do not ship the contract fixture JSON; the dependent describe below is skipped on CI.
const fixture = process.env.CI
  ? ({ cases: [] } as ContractFixture)
  : (JSON.parse(fs.readFileSync(fixturePath, "utf8")) as ContractFixture);

function expectResolvedCommandCase(entry: ContractCase): void {
  const result = resolveSystemRunCommandRequest({
    command: entry.command,
    rawCommand: entry.rawCommand,
  });

  if (!entry.expected.valid) {
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation failure");
    }
    if (entry.expected.errorContains) {
      expect(result.message).toContain(entry.expected.errorContains);
    }
    return;
  }

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`unexpected validation failure: ${result.message}`);
  }
  expect(result.commandText).toBe(entry.expected.displayCommand);
}

// Skip on CI: requires upstream-only channels/plugins not bundled in KaijiBot
describe.skipIf(process.env.CI)("system-run command contract fixtures", () => {
  test.each(fixture.cases)("$name", (entry) => {
    expectResolvedCommandCase(entry);
  });
});
