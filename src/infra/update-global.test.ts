import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bundledDistPluginFile } from "../../test/helpers/bundled-plugin-paths.js";
import { BUNDLED_RUNTIME_SIDECAR_PATHS } from "../plugins/runtime-sidecar-paths.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import { captureEnv } from "../test-utils/env.js";
import {
  canResolveRegistryVersionForPackageTarget,
  collectInstalledGlobalPackageErrors,
  cleanupGlobalRenameDirs,
  detectGlobalInstallManagerByPresence,
  detectGlobalInstallManagerForRoot,
  globalInstallArgs,
  globalInstallFallbackArgs,
  isExplicitPackageInstallSpec,
  isMainPackageTarget,
  KAIJIBOT_MAIN_PACKAGE_SPEC,
  resolveGlobalInstallCommand,
  resolveGlobalPackageRoot,
  resolveGlobalInstallTarget,
  resolveGlobalInstallSpec,
  resolveGlobalRoot,
  type CommandRunner,
} from "./update-global.js";

const MATRIX_HELPER_API = bundledDistPluginFile("matrix", "helper-api.js");

describe("update global helpers", () => {
  let envSnapshot: ReturnType<typeof captureEnv> | undefined;

  afterEach(() => {
    envSnapshot?.restore();
    envSnapshot = undefined;
  });

  it("prefers explicit package spec overrides", () => {
    envSnapshot = captureEnv(["KAIJIBOT_UPDATE_PACKAGE_SPEC"]);
    process.env.KAIJIBOT_UPDATE_PACKAGE_SPEC = "file:/tmp/kaijibot.tgz";

    expect(resolveGlobalInstallSpec({ packageName: "kaijibot", tag: "latest" })).toBe(
      "file:/tmp/kaijibot.tgz",
    );
    expect(
      resolveGlobalInstallSpec({
        packageName: "kaijibot",
        tag: "beta",
        env: { KAIJIBOT_UPDATE_PACKAGE_SPEC: "kaijibot@next" },
      }),
    ).toBe("kaijibot@next");
  });

  it("resolves global roots and package roots from runner output", async () => {
    const runCommand: CommandRunner = async (argv) => {
      if (argv[0] === "npm") {
        return { stdout: "/tmp/npm-root\n", stderr: "", code: 0 };
      }
      if (argv[0] === "pnpm") {
        return { stdout: "", stderr: "", code: 1 };
      }
      throw new Error(`unexpected command: ${argv.join(" ")}`);
    };

    await expect(resolveGlobalRoot("npm", runCommand, 1000)).resolves.toBe("/tmp/npm-root");
    await expect(resolveGlobalRoot("pnpm", runCommand, 1000)).resolves.toBeNull();
    await expect(resolveGlobalRoot("bun", runCommand, 1000)).resolves.toContain(
      path.join(".bun", "install", "global", "node_modules"),
    );
    await expect(resolveGlobalPackageRoot("npm", runCommand, 1000)).resolves.toBe(
      path.join("/tmp/npm-root", "kaijibot"),
    );
  });

  it("maps main and explicit install specs for global installs", () => {
    expect(resolveGlobalInstallSpec({ packageName: "kaijibot", tag: "main" })).toBe(
      KAIJIBOT_MAIN_PACKAGE_SPEC,
    );
    expect(
      resolveGlobalInstallSpec({
        packageName: "kaijibot",
        tag: "github:kaijibot/kaijibot#feature/my-branch",
      }),
    ).toBe("github:kaijibot/kaijibot#feature/my-branch");
    expect(
      resolveGlobalInstallSpec({
        packageName: "kaijibot",
        tag: "https://example.com/kaijibot-main.tgz",
      }),
    ).toBe("https://example.com/kaijibot-main.tgz");
  });

  it("classifies main and raw install specs separately from registry selectors", () => {
    expect(isMainPackageTarget("main")).toBe(true);
    expect(isMainPackageTarget(" MAIN ")).toBe(true);
    expect(isMainPackageTarget("beta")).toBe(false);

    expect(isExplicitPackageInstallSpec("github:kaijibot/kaijibot#main")).toBe(true);
    expect(isExplicitPackageInstallSpec("https://example.com/kaijibot-main.tgz")).toBe(true);
    expect(isExplicitPackageInstallSpec("file:/tmp/kaijibot-main.tgz")).toBe(true);
    expect(isExplicitPackageInstallSpec("beta")).toBe(false);

    expect(canResolveRegistryVersionForPackageTarget("latest")).toBe(true);
    expect(canResolveRegistryVersionForPackageTarget("2026.3.22")).toBe(true);
    expect(canResolveRegistryVersionForPackageTarget("main")).toBe(false);
    expect(canResolveRegistryVersionForPackageTarget("github:kaijibot/kaijibot#main")).toBe(false);
  });

  it("detects install managers from resolved roots and on-disk presence", async () => {
    await withTempDir({ prefix: "kaijibot-update-global-" }, async (base) => {
      const npmRoot = path.join(base, "npm-root");
      const pnpmRoot = path.join(base, "pnpm-root");
      const bunRoot = path.join(base, ".bun", "install", "global", "node_modules");
      const pkgRoot = path.join(pnpmRoot, "kaijibot");
      await fs.mkdir(pkgRoot, { recursive: true });
      await fs.mkdir(path.join(npmRoot, "kaijibot"), { recursive: true });
      await fs.mkdir(path.join(bunRoot, "kaijibot"), { recursive: true });

      envSnapshot = captureEnv(["BUN_INSTALL"]);
      process.env.BUN_INSTALL = path.join(base, ".bun");

      const runCommand: CommandRunner = async (argv) => {
        if (argv[0] === "npm") {
          return { stdout: `${npmRoot}\n`, stderr: "", code: 0 };
        }
        if (argv[0] === "pnpm") {
          return { stdout: `${pnpmRoot}\n`, stderr: "", code: 0 };
        }
        throw new Error(`unexpected command: ${argv.join(" ")}`);
      };

      await expect(detectGlobalInstallManagerForRoot(runCommand, pkgRoot, 1000)).resolves.toBe(
        "pnpm",
      );
      await expect(detectGlobalInstallManagerByPresence(runCommand, 1000)).resolves.toBe("npm");

      await fs.rm(path.join(npmRoot, "kaijibot"), { recursive: true, force: true });
      await fs.rm(path.join(pnpmRoot, "kaijibot"), { recursive: true, force: true });
      await expect(detectGlobalInstallManagerByPresence(runCommand, 1000)).resolves.toBe("bun");
    });
  });

  it("prefers the owning npm prefix when PATH npm points at a different global root", async () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    try {
      await withTempDir({ prefix: "kaijibot-update-npm-prefix-" }, async (base) => {
        const brewPrefix = path.join(base, "opt", "homebrew");
        const brewBin = path.join(brewPrefix, "bin");
        const brewRoot = path.join(brewPrefix, "lib", "node_modules");
        const pkgRoot = path.join(brewRoot, "kaijibot");
        const pathNpmRoot = path.join(base, "nvm", "lib", "node_modules");
        const brewNpm = path.join(brewBin, "npm");
        await fs.mkdir(pkgRoot, { recursive: true });
        await fs.mkdir(brewBin, { recursive: true });
        await fs.writeFile(brewNpm, "", "utf8");

        const runCommand: CommandRunner = async (argv) => {
          if (argv[0] === "npm") {
            return { stdout: `${pathNpmRoot}\n`, stderr: "", code: 0 };
          }
          if (argv[0] === brewNpm) {
            return { stdout: `${brewRoot}\n`, stderr: "", code: 0 };
          }
          if (argv[0] === "pnpm") {
            return { stdout: "", stderr: "", code: 1 };
          }
          throw new Error(`unexpected command: ${argv.join(" ")}`);
        };

        await expect(detectGlobalInstallManagerForRoot(runCommand, pkgRoot, 1000)).resolves.toBe(
          "npm",
        );
        await expect(resolveGlobalRoot("npm", runCommand, 1000, pkgRoot)).resolves.toBe(brewRoot);
        await expect(resolveGlobalPackageRoot("npm", runCommand, 1000, pkgRoot)).resolves.toBe(
          pkgRoot,
        );
        await expect(
          resolveGlobalInstallTarget({
            manager: "npm",
            runCommand,
            timeoutMs: 1000,
            pkgRoot,
          }),
        ).resolves.toEqual({
          manager: "npm",
          command: brewNpm,
          globalRoot: brewRoot,
          packageRoot: pkgRoot,
        });
        expect(globalInstallArgs("npm", "kaijibot@latest", pkgRoot)).toEqual([
          brewNpm,
          "i",
          "-g",
          "kaijibot@latest",
          "--no-fund",
          "--no-audit",
          "--loglevel=error",
        ]);
        expect(globalInstallFallbackArgs("npm", "kaijibot@latest", pkgRoot)).toEqual([
          brewNpm,
          "i",
          "-g",
          "kaijibot@latest",
          "--omit=optional",
          "--no-fund",
          "--no-audit",
          "--loglevel=error",
        ]);
      });
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("does not infer npm ownership from path shape alone when the owning npm binary is absent", async () => {
    await withTempDir({ prefix: "kaijibot-update-npm-missing-bin-" }, async (base) => {
      const brewRoot = path.join(base, "opt", "homebrew", "lib", "node_modules");
      const pkgRoot = path.join(brewRoot, "kaijibot");
      const pathNpmRoot = path.join(base, "nvm", "lib", "node_modules");
      await fs.mkdir(pkgRoot, { recursive: true });

      const runCommand: CommandRunner = async (argv) => {
        if (argv[0] === "npm") {
          return { stdout: `${pathNpmRoot}\n`, stderr: "", code: 0 };
        }
        if (argv[0] === "pnpm") {
          return { stdout: "", stderr: "", code: 1 };
        }
        throw new Error(`unexpected command: ${argv.join(" ")}`);
      };

      await expect(
        detectGlobalInstallManagerForRoot(runCommand, pkgRoot, 1000),
      ).resolves.toBeNull();
      expect(globalInstallArgs("npm", "kaijibot@latest", pkgRoot)).toEqual([
        "npm",
        "i",
        "-g",
        "kaijibot@latest",
        "--no-fund",
        "--no-audit",
        "--loglevel=error",
      ]);
    });
  });

  it("prefers npm.cmd for win32-style global npm roots", async () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      await withTempDir({ prefix: "kaijibot-update-win32-npm-prefix-" }, async (base) => {
        const npmPrefix = path.join(base, "Roaming", "npm");
        const npmRoot = path.join(npmPrefix, "node_modules");
        const pkgRoot = path.join(npmRoot, "kaijibot");
        const npmCmd = path.join(npmPrefix, "npm.cmd");
        const pathNpmRoot = path.join(base, "nvm", "node_modules");
        await fs.mkdir(pkgRoot, { recursive: true });
        await fs.writeFile(npmCmd, "", "utf8");

        const runCommand: CommandRunner = async (argv) => {
          if (argv[0] === "npm") {
            return { stdout: `${pathNpmRoot}\n`, stderr: "", code: 0 };
          }
          if (argv[0] === npmCmd) {
            return { stdout: `${npmRoot}\n`, stderr: "", code: 0 };
          }
          if (argv[0] === "pnpm") {
            return { stdout: "", stderr: "", code: 1 };
          }
          throw new Error(`unexpected command: ${argv.join(" ")}`);
        };

        await expect(detectGlobalInstallManagerForRoot(runCommand, pkgRoot, 1000)).resolves.toBe(
          "npm",
        );
        await expect(resolveGlobalRoot("npm", runCommand, 1000, pkgRoot)).resolves.toBe(npmRoot);
        expect(globalInstallArgs("npm", "kaijibot@latest", pkgRoot)).toEqual([
          npmCmd,
          "i",
          "-g",
          "kaijibot@latest",
          "--no-fund",
          "--no-audit",
          "--loglevel=error",
        ]);
      });
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("builds install argv and npm fallback argv", () => {
    expect(resolveGlobalInstallCommand("npm")).toEqual({
      manager: "npm",
      command: "npm",
    });
    expect(globalInstallArgs("npm", "kaijibot@latest")).toEqual([
      "npm",
      "i",
      "-g",
      "kaijibot@latest",
      "--no-fund",
      "--no-audit",
      "--loglevel=error",
    ]);
    expect(globalInstallArgs("pnpm", "kaijibot@latest")).toEqual([
      "pnpm",
      "add",
      "-g",
      "kaijibot@latest",
    ]);
    expect(globalInstallArgs("bun", "kaijibot@latest")).toEqual([
      "bun",
      "add",
      "-g",
      "kaijibot@latest",
    ]);

    expect(globalInstallFallbackArgs("npm", "kaijibot@latest")).toEqual([
      "npm",
      "i",
      "-g",
      "kaijibot@latest",
      "--omit=optional",
      "--no-fund",
      "--no-audit",
      "--loglevel=error",
    ]);
    expect(globalInstallFallbackArgs("pnpm", "kaijibot@latest")).toBeNull();
    expect(
      globalInstallArgs({ manager: "pnpm", command: "/opt/homebrew/bin/pnpm" }, "kaijibot@latest"),
    ).toEqual(["/opt/homebrew/bin/pnpm", "add", "-g", "kaijibot@latest"]);
  });

  it("cleans only renamed package directories", async () => {
    await withTempDir({ prefix: "kaijibot-update-cleanup-" }, async (root) => {
      await fs.mkdir(path.join(root, ".kaijibot-123"), { recursive: true });
      await fs.mkdir(path.join(root, ".kaijibot-456"), { recursive: true });
      await fs.writeFile(path.join(root, ".kaijibot-file"), "nope", "utf8");
      await fs.mkdir(path.join(root, "kaijibot"), { recursive: true });

      await expect(
        cleanupGlobalRenameDirs({
          globalRoot: root,
          packageName: "kaijibot",
        }),
      ).resolves.toEqual({
        removed: [".kaijibot-123", ".kaijibot-456"],
      });
      await expect(fs.stat(path.join(root, "kaijibot"))).resolves.toBeDefined();
      await expect(fs.stat(path.join(root, ".kaijibot-file"))).resolves.toBeDefined();
    });
  });

  it("checks bundled runtime sidecars, including Matrix helper-api", async () => {
    await withTempDir({ prefix: "kaijibot-update-global-pkg-" }, async (packageRoot) => {
      await fs.writeFile(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ name: "kaijibot", version: "1.0.0" }),
        "utf-8",
      );
      for (const relativePath of BUNDLED_RUNTIME_SIDECAR_PATHS) {
        const absolutePath = path.join(packageRoot, relativePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, "export {};\n", "utf-8");
      }

      await expect(collectInstalledGlobalPackageErrors({ packageRoot })).resolves.toEqual([]);

      await fs.rm(path.join(packageRoot, MATRIX_HELPER_API));
      await expect(collectInstalledGlobalPackageErrors({ packageRoot })).resolves.toContain(
        `missing bundled runtime sidecar ${MATRIX_HELPER_API}`,
      );
    });
  });
});
