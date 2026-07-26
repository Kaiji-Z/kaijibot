import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadShellParserParityFixtureCases,
  loadWrapperResolutionParityFixtureCases,
} from "./exec-approvals-test-helpers.js";
import { analyzeShellCommand, resolveCommandResolutionFromArgv } from "./exec-approvals.js";

// Skip on CI: requires upstream-only channels/plugins not bundled in KaijiBot
describe.skipIf(process.env.CI)("exec approvals shell parser parity fixture", () => {
  const fixtures = process.env.CI ? [] : loadShellParserParityFixtureCases();

  it.each(fixtures)("matches fixture: $id", (fixture) => {
    const res = analyzeShellCommand({ command: fixture.command });
    expect(res.ok).toBe(fixture.ok);
    if (fixture.ok) {
      const executables = res.segments.map((segment) =>
        path.basename(segment.argv[0] ?? "").toLowerCase(),
      );
      expect(executables).toEqual(fixture.executables.map((entry) => entry.toLowerCase()));
    } else {
      expect(res.segments).toHaveLength(0);
    }
  });
});

describe.skipIf(process.env.CI)("exec approvals wrapper resolution parity fixture", () => {
  const fixtures = process.env.CI ? [] : loadWrapperResolutionParityFixtureCases();

  it.each(fixtures)("matches wrapper fixture: $id", (fixture) => {
    const resolution = resolveCommandResolutionFromArgv(fixture.argv);
    expect(resolution?.execution.rawExecutable ?? null).toBe(fixture.expectedRawExecutable);
  });
});
