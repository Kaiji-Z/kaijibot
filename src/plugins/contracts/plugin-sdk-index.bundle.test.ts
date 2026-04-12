import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { buildPluginSdkEntrySources, pluginSdkEntrypoints } from "../../plugin-sdk/entrypoints.js";
import { createSuiteTempRootTracker } from "../test-helpers/fs-fixtures.js";

const require = createRequire(import.meta.url);
const tsdownModuleUrl = pathToFileURL(require.resolve("tsdown")).href;
const bundledRepresentativeEntrypoints = ["core"] as const;
const bundleTempRootTracker = createSuiteTempRootTracker(
  "kaijibot-plugin-sdk-build",
  path.join(process.cwd(), "node_modules", ".cache"),
);

async function listBuiltJsFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return await listBuiltJsFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith(".js") ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

describe("plugin-sdk bundled exports", () => {
  afterAll(() => {
    bundleTempRootTracker.cleanup();
  });

  it("emits importable bundled subpath entries", { timeout: 120_000 }, async () => {
    const bundleTempRoot = bundleTempRootTracker.ensureSuiteTempRoot();
    const outDir = path.join(bundleTempRoot, "bundle");
    await fs.rm(outDir, { recursive: true, force: true });
    await fs.mkdir(outDir, { recursive: true });

    const { build } = await import(tsdownModuleUrl);
    await build({
      clean: false,
      config: false,
      dts: false,
      deps: {
        neverBundle: ["@lancedb/lancedb"],
      },
      entry: buildPluginSdkEntrySources(bundledRepresentativeEntrypoints),
      env: { NODE_ENV: "production" },
      fixedExtension: false,
      logLevel: "error",
      outDir,
      platform: "node",
    });

    expect(pluginSdkEntrypoints.length).toBeGreaterThan(bundledRepresentativeEntrypoints.length);
    await Promise.all(
      bundledRepresentativeEntrypoints.map(async (entry) => {
        await expect(fs.stat(path.join(outDir, `${entry}.js`))).resolves.toBeTruthy();
      }),
    );

    const importResults = await Promise.all(
      bundledRepresentativeEntrypoints.map(async (entry) => [
        entry,
        typeof (await import(pathToFileURL(path.join(outDir, `${entry}.js`)).href)),
      ]),
    );
    expect(Object.fromEntries(importResults)).toEqual(
      Object.fromEntries(bundledRepresentativeEntrypoints.map((entry) => [entry, "object"])),
    );
  });
});
