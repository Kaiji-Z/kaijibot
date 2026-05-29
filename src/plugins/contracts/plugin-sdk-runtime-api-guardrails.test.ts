import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPluginManifestRegistry } from "../manifest-registry.js";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bundledPluginRoots = new Map(
  loadPluginManifestRegistry({ cache: true, config: {} })
    .plugins.filter((plugin) => plugin.origin === "bundled")
    .map((plugin) => [plugin.id, plugin.rootDir] as const),
);

function collectRuntimeApiFiles(): string[] {
  return [...bundledPluginRoots.values()]
    .map((rootDir) => resolve(rootDir, "runtime-api.ts"))
    .filter((path) => existsSync(path))
    .map((path) => relative(resolve(ROOT_DIR, ".."), path).replaceAll("\\", "/"));
}

describe("runtime api guardrails", () => {
  it("keeps runtime api surfaces on an explicit export allowlist", () => {
    const runtimeApiFiles = collectRuntimeApiFiles();

    for (const file of runtimeApiFiles) {
      expect(file, "runtime-api file should belong to a living extension").not.toMatch(
        /\/(discord|slack|telegram|irc|matrix|googlechat|zalouser|line|signal|whatsapp|nextcloud-talk|imessage|mattermost|bluebubbles|nostr|twitch|tlon|msteams|zalo)\//,
      );
    }
  });
});
