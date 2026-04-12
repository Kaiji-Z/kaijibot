import { beforeEach, describe, expect, it, vi } from "vitest";
import { bundledPluginRootAt } from "../../test/helpers/bundled-plugin-paths.js";
import {
  findBundledPluginSource,
  findBundledPluginSourceInMap,
  resolveBundledPluginSources,
} from "./bundled-sources.js";

const APP_ROOT = "/app";

function appBundledPluginRoot(pluginId: string): string {
  return bundledPluginRootAt(APP_ROOT, pluginId);
}

const discoverKaijiBotPluginsMock = vi.fn();
const loadPluginManifestMock = vi.fn();

vi.mock("./discovery.js", () => ({
  discoverKaijiBotPlugins: (...args: unknown[]) => discoverKaijiBotPluginsMock(...args),
}));

vi.mock("./manifest.js", () => ({
  loadPluginManifest: (...args: unknown[]) => loadPluginManifestMock(...args),
}));

function createBundledCandidate(params: {
  rootDir: string;
  packageName: string;
  npmSpec?: string;
  origin?: "bundled" | "global";
}) {
  return {
    origin: params.origin ?? "bundled",
    rootDir: params.rootDir,
    packageName: params.packageName,
    packageManifest: {
      install: {
        npmSpec: params.npmSpec ?? params.packageName,
      },
    },
  };
}

function setBundledDiscoveryCandidates(candidates: unknown[]) {
  discoverKaijiBotPluginsMock.mockReturnValue({
    candidates,
    diagnostics: [],
  });
}

function setBundledManifestIdsByRoot(manifestIds: Record<string, string>) {
  loadPluginManifestMock.mockImplementation((rootDir: string) =>
    rootDir in manifestIds
      ? { ok: true, manifest: { id: manifestIds[rootDir] } }
      : {
          ok: false,
          error: "invalid manifest",
          manifestPath: `${rootDir}/kaijibot.plugin.json`,
        },
  );
}

function setBundledLookupFixture() {
  setBundledDiscoveryCandidates([
    createBundledCandidate({
      rootDir: appBundledPluginRoot("feishu"),
      packageName: "@kaijibot/feishu",
    }),
    createBundledCandidate({
      rootDir: appBundledPluginRoot("diffs"),
      packageName: "@kaijibot/diffs",
    }),
  ]);
  setBundledManifestIdsByRoot({
    [appBundledPluginRoot("feishu")]: "feishu",
    [appBundledPluginRoot("diffs")]: "diffs",
  });
}

function createResolvedBundledSource(params: {
  pluginId: string;
  localPath: string;
  npmSpec?: string;
}) {
  return {
    pluginId: params.pluginId,
    localPath: params.localPath,
    npmSpec: params.npmSpec ?? `@kaijibot/${params.pluginId}`,
  };
}

function expectBundledSourceLookup(
  lookup: Parameters<typeof findBundledPluginSource>[0]["lookup"],
  expected:
    | {
        pluginId: string;
        localPath: string;
      }
    | undefined,
) {
  const resolved = findBundledPluginSource({ lookup });
  if (!expected) {
    expect(resolved).toBeUndefined();
    return;
  }
  expect(resolved?.pluginId).toBe(expected.pluginId);
  expect(resolved?.localPath).toBe(expected.localPath);
}

function expectBundledSourceLookupCase(params: {
  lookup: Parameters<typeof findBundledPluginSource>[0]["lookup"];
  expected:
    | {
        pluginId: string;
        localPath: string;
      }
    | undefined;
}) {
  setBundledLookupFixture();
  expectBundledSourceLookup(params.lookup, params.expected);
}

describe("bundled plugin sources", () => {
  beforeEach(() => {
    discoverKaijiBotPluginsMock.mockReset();
    loadPluginManifestMock.mockReset();
  });

  it("resolves bundled sources keyed by plugin id", () => {
    setBundledDiscoveryCandidates([
      createBundledCandidate({
        origin: "global",
        rootDir: "/global/feishu",
        packageName: "@kaijibot/feishu",
      }),
      createBundledCandidate({
        rootDir: appBundledPluginRoot("feishu"),
        packageName: "@kaijibot/feishu",
      }),
      createBundledCandidate({
        rootDir: appBundledPluginRoot("feishu-dup"),
        packageName: "@kaijibot/feishu",
      }),
      createBundledCandidate({
        rootDir: appBundledPluginRoot("msteams"),
        packageName: "@kaijibot/msteams",
      }),
    ]);
    setBundledManifestIdsByRoot({
      [appBundledPluginRoot("feishu")]: "feishu",
      [appBundledPluginRoot("msteams")]: "msteams",
    });

    const map = resolveBundledPluginSources({});

    expect(Array.from(map.keys())).toEqual(["feishu", "msteams"]);
    expect(map.get("feishu")).toEqual(
      createResolvedBundledSource({
        pluginId: "feishu",
        localPath: appBundledPluginRoot("feishu"),
      }),
    );
  });

  it.each([
    [
      "finds bundled source by npm spec",
      { kind: "npmSpec", value: "@kaijibot/feishu" } as const,
      { pluginId: "feishu", localPath: appBundledPluginRoot("feishu") },
    ],
    [
      "returns undefined for missing npm spec",
      { kind: "npmSpec", value: "@kaijibot/not-found" } as const,
      undefined,
    ],
    [
      "finds bundled source by plugin id",
      { kind: "pluginId", value: "diffs" } as const,
      { pluginId: "diffs", localPath: appBundledPluginRoot("diffs") },
    ],
    [
      "returns undefined for missing plugin id",
      { kind: "pluginId", value: "not-found" } as const,
      undefined,
    ],
  ] as const)("%s", (_name, lookup, expected) => {
    expectBundledSourceLookupCase({ lookup, expected });
  });

  it("forwards an explicit env to bundled discovery helpers", () => {
    setBundledDiscoveryCandidates([]);

    const env = { HOME: "/tmp/kaijibot-home" } as NodeJS.ProcessEnv;

    resolveBundledPluginSources({
      workspaceDir: "/workspace",
      env,
    });
    findBundledPluginSource({
      lookup: { kind: "pluginId", value: "feishu" },
      workspaceDir: "/workspace",
      env,
    });

    expect(discoverKaijiBotPluginsMock).toHaveBeenNthCalledWith(1, {
      workspaceDir: "/workspace",
      env,
    });
    expect(discoverKaijiBotPluginsMock).toHaveBeenNthCalledWith(2, {
      workspaceDir: "/workspace",
      env,
    });
  });

  it("reuses a pre-resolved bundled map for repeated lookups", () => {
    const bundled = new Map([
      [
        "feishu",
        createResolvedBundledSource({
          pluginId: "feishu",
          localPath: appBundledPluginRoot("feishu"),
        }),
      ],
    ]);

    expect(
      findBundledPluginSourceInMap({
        bundled,
        lookup: { kind: "pluginId", value: "feishu" },
      }),
    ).toEqual(
      createResolvedBundledSource({
        pluginId: "feishu",
        localPath: appBundledPluginRoot("feishu"),
      }),
    );
    expect(
      findBundledPluginSourceInMap({
        bundled,
        lookup: { kind: "npmSpec", value: "@kaijibot/feishu" },
      })?.pluginId,
    ).toBe("feishu");
  });
});
