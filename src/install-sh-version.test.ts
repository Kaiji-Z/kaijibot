import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../test/helpers/temp-dir.js";

const tempRoots: string[] = [];

function withFakeCli(versionOutput: string): { root: string; cliPath: string } {
  const root = makeTempDir(tempRoots, "kaijibot-install-sh-");
  const cliPath = path.join(root, "kaijibot");
  const escapedOutput = versionOutput.replace(/'/g, "'\\''");
  fs.writeFileSync(
    cliPath,
    `#!/usr/bin/env bash
printf '%s\n' '${escapedOutput}'
`,
    "utf-8",
  );
  fs.chmodSync(cliPath, 0o755);
  return { root, cliPath };
}

function resolveVersionFromInstaller(cliPath: string): string {
  const installerPath = path.join(process.cwd(), "scripts", "install.sh");
  const output = execFileSync(
    "bash",
    [
      "-lc",
      `source "${installerPath}" >/dev/null 2>&1
KAIJIBOT_BIN="$FAKE_KAIJIBOT_BIN"
resolve_kaijibot_version`,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: {
        ...process.env,
        FAKE_KAIJIBOT_BIN: cliPath,
        KAIJIBOT_INSTALL_SH_NO_RUN: "1",
      },
    },
  );
  return output.trim();
}

function resolveVersionFromInstallerViaStdin(cliPath: string, cwd: string): string {
  const installerPath = path.join(process.cwd(), "scripts", "install.sh");
  const installerSource = fs.readFileSync(installerPath, "utf-8");
  const output = execFileSync("bash", [], {
    cwd,
    encoding: "utf-8",
    input: `${installerSource}
KAIJIBOT_BIN="$FAKE_KAIJIBOT_BIN"
resolve_kaijibot_version
`,
    env: {
      ...process.env,
      FAKE_KAIJIBOT_BIN: cliPath,
      KAIJIBOT_INSTALL_SH_NO_RUN: "1",
    },
  });
  return output.trim();
}

describe("install.sh version resolution", () => {
  afterEach(() => {
    cleanupTempDirs(tempRoots);
  });

  it.runIf(process.platform !== "win32")(
    "extracts the semantic version from decorated CLI output",
    () => {
      const fixture = withFakeCli("KaijiBot 2026.3.10 (abcdef0)");

      expect(resolveVersionFromInstaller(fixture.cliPath)).toBe("2026.3.10");
    },
  );

  it.runIf(process.platform !== "win32")(
    "falls back to raw output when no semantic version is present",
    () => {
      const fixture = withFakeCli("KaijiBot dev's build");

      expect(resolveVersionFromInstaller(fixture.cliPath)).toBe("KaijiBot dev's build");
    },
  );

  it.runIf(process.platform !== "win32")(
    "does not source version helpers from cwd when installer runs via stdin",
    () => {
      const fixture = withFakeCli("KaijiBot 2026.3.10 (abcdef0)");

      const hostileCwd = makeTempDir(tempRoots, "kaijibot-install-stdin-");
      const hostileHelper = path.join(
        hostileCwd,
        "docker",
        "install-sh-common",
        "version-parse.sh",
      );
      fs.mkdirSync(path.dirname(hostileHelper), { recursive: true });
      fs.writeFileSync(
        hostileHelper,
        `#!/usr/bin/env bash
extract_kaijibot_semver() {
  printf '%s' 'poisoned'
}
`,
        "utf-8",
      );

      expect(resolveVersionFromInstallerViaStdin(fixture.cliPath, hostileCwd)).toBe("2026.3.10");
    },
  );
});
