import { describe, expect, it } from "vitest";
import { formatBackupCreateSummary, type BackupCreateResult } from "./backup-create.js";

function makeResult(overrides: Partial<BackupCreateResult> = {}): BackupCreateResult {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    archiveRoot: "kaijibot-backup-2026-01-01",
    archivePath: "/tmp/kaijibot-backup.tar.gz",
    dryRun: false,
    includeWorkspace: true,
    onlyConfig: false,
    verified: false,
    assets: [],
    skipped: [],
    ...overrides,
  };
}

describe("formatBackupCreateSummary", () => {
  const backupArchiveLine = "Backup archive: /tmp/kaijibot-backup.tar.gz";

  it.each([
    {
      name: "formats created archives with included and skipped paths",
      result: makeResult({
        verified: true,
        assets: [
          {
            kind: "state",
            sourcePath: "/state",
            archivePath: "archive/state",
            displayPath: "~/.kaijibot",
          },
        ],
        skipped: [
          {
            kind: "workspace",
            sourcePath: "/workspace",
            displayPath: "~/Projects/kaijibot",
            reason: "covered",
            coveredBy: "~/.kaijibot",
          },
        ],
      }),
      expected: [
        backupArchiveLine,
        "Included 1 path:",
        "- state: ~/.kaijibot",
        "Skipped 1 path:",
        "- workspace: ~/Projects/kaijibot (covered by ~/.kaijibot)",
        "Created /tmp/kaijibot-backup.tar.gz",
        "Archive verification: passed",
      ],
    },
    {
      name: "formats dry runs and pluralized counts",
      result: makeResult({
        dryRun: true,
        assets: [
          {
            kind: "config",
            sourcePath: "/config",
            archivePath: "archive/config",
            displayPath: "~/.kaijibot/config.json",
          },
          {
            kind: "credentials",
            sourcePath: "/oauth",
            archivePath: "archive/oauth",
            displayPath: "~/.kaijibot/oauth",
          },
        ],
      }),
      expected: [
        backupArchiveLine,
        "Included 2 paths:",
        "- config: ~/.kaijibot/config.json",
        "- credentials: ~/.kaijibot/oauth",
        "Dry run only; archive was not written.",
      ],
    },
  ])("$name", ({ result, expected }) => {
    expect(formatBackupCreateSummary(result)).toEqual(expected);
  });
});
