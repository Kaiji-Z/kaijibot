import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

type RunPlan = {
  config: string;
  forwardedArgs: string[];
  includePatterns: string[] | null;
  watchMode: boolean;
};

const {
  FULL_SUITE_CONFIG_WEIGHT,
  buildVitestArgs,
  buildVitestRunPlans,
  createVitestRunSpecs,
  listFullSuiteShardConfigs,
  listRoutedVitestConfigs,
  parseTestProjectsArgs,
} = (await import("../../scripts/test-projects.test-support.mjs")) as unknown as {
  FULL_SUITE_CONFIG_WEIGHT: Map<string, number>;
  buildVitestArgs: (args: string[], cwd?: string) => string[];
  buildVitestRunPlans: (args: string[], cwd?: string) => RunPlan[];
  createVitestRunSpecs: (
    args: string[],
    params?: {
      baseEnv?: NodeJS.ProcessEnv;
      cwd?: string;
      tempDir?: string;
    },
  ) => Array<{
    config: string;
    env: NodeJS.ProcessEnv;
    includeFilePath: string | null;
    includePatterns: string[] | null;
    pnpmArgs: string[];
    watchMode: boolean;
  }>;
  listFullSuiteShardConfigs: () => string[];
  listRoutedVitestConfigs: () => string[];
  parseTestProjectsArgs: (
    args: string[],
    cwd?: string,
  ) => {
    forwardedArgs: string[];
    targetArgs: string[];
    watchMode: boolean;
  };
};

const repoRoot = new URL("../../", import.meta.url);
const extensionIds = readdirSync(new URL("extensions/", repoRoot), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

const extensionsLanePlan = (target: string): RunPlan => ({
  config: "vitest/vitest.extensions.config.ts",
  forwardedArgs: [],
  includePatterns: [target],
  watchMode: false,
});

const VITEST_NODE_PREFIX = [
  "exec",
  "node",
  "--no-maglev",
  expect.stringMatching(/(?:^|[\\/])node_modules[\\/]vitest[\\/]vitest\.mjs$/),
];

describe("test-projects args", () => {
  it("drops a pnpm passthrough separator while preserving targeted filters", () => {
    expect(parseTestProjectsArgs(["--", "src/foo.test.ts", "-t", "target"])).toEqual({
      forwardedArgs: ["src/foo.test.ts", "-t", "target"],
      targetArgs: ["src/foo.test.ts"],
      watchMode: false,
    });
  });

  it("keeps watch mode explicit without leaking the sentinel to Vitest", () => {
    expect(buildVitestArgs(["--watch", "--", "src/foo.test.ts"])).toEqual([
      ...VITEST_NODE_PREFIX,
      "--config",
      "vitest/vitest.unit.config.ts",
      "src/foo.test.ts",
    ]);
  });

  it("uses run mode by default", () => {
    expect(buildVitestArgs(["src/foo.test.ts"])).toEqual([
      ...VITEST_NODE_PREFIX,
      "run",
      "--config",
      "vitest/vitest.unit.config.ts",
      "src/foo.test.ts",
    ]);
  });

  it("routes boundary targets to the boundary config", () => {
    expect(buildVitestRunPlans(["src/infra/kaijibot-root.test.ts"])).toEqual([
      {
        config: "vitest/vitest.boundary.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/infra/kaijibot-root.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes bundled-plugin-dependent unit targets to the bundled config", () => {
    expect(buildVitestRunPlans(["src/plugins/loader.test.ts"])).toEqual([
      {
        config: "vitest/vitest.bundled.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/plugins/loader.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes top-level repo tests to the tooling config", () => {
    expect(buildVitestRunPlans(["test/appcast.test.ts"])).toEqual([
      {
        config: "vitest/vitest.tooling.config.ts",
        forwardedArgs: [],
        includePatterns: ["test/appcast.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes script tests to the tooling config", () => {
    expect(buildVitestRunPlans(["src/scripts/test-projects.test.ts"])).toEqual([
      {
        config: "vitest/vitest.tooling.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/scripts/test-projects.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes contract tests to the contracts config", () => {
    expect(
      buildVitestRunPlans(["src/plugins/contracts/memory-embedding-provider.contract.test.ts"]),
    ).toEqual([
      {
        config: "vitest/vitest.contracts.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/plugins/contracts/memory-embedding-provider.contract.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes config baseline integration tests to the tooling config", () => {
    expect(buildVitestRunPlans(["src/config/doc-baseline.integration.test.ts"])).toEqual([
      {
        config: "vitest/vitest.tooling.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/config/doc-baseline.integration.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes runtime config targets to the runtime-config config", () => {
    expect(buildVitestRunPlans(["src/config/sessions.test.ts"])).toEqual([
      {
        config: "vitest/vitest.runtime-config.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/config/sessions.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes cron targets to the cron config", () => {
    expect(buildVitestRunPlans(["src/cron/isolated-agent.lane.test.ts"])).toEqual([
      {
        config: "vitest/vitest.cron.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/cron/isolated-agent.lane.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes daemon targets to the daemon config", () => {
    expect(buildVitestRunPlans(["src/daemon/inspect.test.ts"])).toEqual([
      {
        config: "vitest/vitest.daemon.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/daemon/inspect.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes media targets to the media config", () => {
    expect(buildVitestRunPlans(["src/media/fetch.test.ts"])).toEqual([
      {
        config: "vitest/vitest.media.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/media/fetch.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes plugin-sdk targets to the plugin-sdk config", () => {
    expect(buildVitestRunPlans(["src/plugin-sdk/anthropic-vertex-auth-presence.test.ts"])).toEqual([
      {
        config: "vitest/vitest.plugin-sdk.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/plugin-sdk/anthropic-vertex-auth-presence.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes plugin-sdk light targets to the plugin-sdk-light config", () => {
    expect(buildVitestRunPlans(["src/plugin-sdk/provider-entry.test.ts"])).toEqual([
      {
        config: "vitest/vitest.plugin-sdk-light.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/plugin-sdk/provider-entry.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes process targets to the process config", () => {
    expect(buildVitestRunPlans(["src/process/exec.test.ts"])).toEqual([
      {
        config: "vitest/vitest.process.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/process/exec.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes secrets targets to the secrets config", () => {
    expect(buildVitestRunPlans(["src/secrets/resolve.test.ts"])).toEqual([
      {
        config: "vitest/vitest.secrets.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/secrets/resolve.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes shared-core targets to the shared-core config", () => {
    expect(buildVitestRunPlans(["src/shared/text-chunking.test.ts"])).toEqual([
      {
        config: "vitest/vitest.shared-core.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/shared/text-chunking.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes tasks targets to the tasks config", () => {
    expect(buildVitestRunPlans(["src/tasks/task-registry.test.ts"])).toEqual([
      {
        config: "vitest/vitest.tasks.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/tasks/task-registry.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes logging targets to the logging config", () => {
    expect(buildVitestRunPlans(["src/logging/console-settings.test.ts"])).toEqual([
      {
        config: "vitest/vitest.logging.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/logging/console-settings.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes wizard targets to the wizard config", () => {
    expect(buildVitestRunPlans(["src/wizard/setup.test.ts"])).toEqual([
      {
        config: "vitest/vitest.wizard.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/wizard/setup.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes control ui targets to the ui config", () => {
    expect(buildVitestRunPlans(["ui/src/ui/views/chat.test.ts"])).toEqual([
      {
        config: "vitest/vitest.ui.config.ts",
        forwardedArgs: [],
        includePatterns: ["ui/src/ui/views/chat.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes control ui i18n targets to the ui config", () => {
    expect(buildVitestRunPlans(["ui/src/i18n/test/translate.test.ts"])).toEqual([
      {
        config: "vitest/vitest.ui.config.ts",
        forwardedArgs: [],
        includePatterns: ["ui/src/i18n/test/translate.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes the ui package root to the ui config", () => {
    expect(buildVitestRunPlans(["ui"])).toEqual([
      {
        config: "vitest/vitest.ui.config.ts",
        forwardedArgs: [],
        includePatterns: ["ui/**/*.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes tui targets to the tui config", () => {
    expect(buildVitestRunPlans(["src/tui/tui.test.ts"])).toEqual([
      {
        config: "vitest/vitest.tui.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/tui/tui.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes media-understanding targets to the media-understanding config", () => {
    expect(buildVitestRunPlans(["src/media-understanding/runtime.test.ts"])).toEqual([
      {
        config: "vitest/vitest.media-understanding.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/media-understanding/runtime.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes command targets to the commands config", () => {
    expect(buildVitestRunPlans(["src/commands/status.summary.test.ts"])).toEqual([
      {
        config: "vitest/vitest.commands.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/commands/status.summary.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes auto-reply targets to the auto-reply config", () => {
    expect(buildVitestRunPlans(["src/auto-reply/reply/get-reply.message-hooks.test.ts"])).toEqual([
      {
        config: "vitest/vitest.auto-reply.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/auto-reply/reply/get-reply.message-hooks.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes agents targets to the agents config", () => {
    expect(buildVitestRunPlans(["src/agents/tools/image-tool.test.ts"])).toEqual([
      {
        config: "vitest/vitest.agents.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/agents/tools/image-tool.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes gateway targets to the gateway config", () => {
    expect(buildVitestRunPlans(["src/gateway/call.test.ts"])).toEqual([
      {
        config: "vitest/vitest.gateway.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/gateway/call.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes hooks targets to the hooks config", () => {
    expect(buildVitestRunPlans(["src/hooks/install.test.ts"])).toEqual([
      {
        config: "vitest/vitest.hooks.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/hooks/install.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes channel targets to the channels config", () => {
    expect(buildVitestRunPlans(["src/channels/session.test.ts"])).toEqual([
      {
        config: "vitest/vitest.channels.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/channels/session.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes infra targets to the infra config", () => {
    expect(buildVitestRunPlans(["src/infra/kaijibot-root.test.ts"])).toEqual([
      {
        config: "vitest/vitest.boundary.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/infra/kaijibot-root.test.ts"],
        watchMode: false,
      },
    ]);

    expect(buildVitestRunPlans(["src/infra/migrations.test.ts"])).toEqual([
      {
        config: "vitest/vitest.infra.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/infra/migrations.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes acp targets to the acp config", () => {
    expect(buildVitestRunPlans(["src/acp/control-plane/manager.test.ts"])).toEqual([
      {
        config: "vitest/vitest.acp.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/acp/control-plane/manager.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes cli targets to the cli config", () => {
    expect(buildVitestRunPlans(["src/cli/test-runtime-capture.test.ts"])).toEqual([
      {
        config: "vitest/vitest.cli.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/cli/test-runtime-capture.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes plugin targets to the plugins config", () => {
    expect(buildVitestRunPlans(["src/plugins/loader.test.ts"])).toEqual([
      {
        config: "vitest/vitest.bundled.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/plugins/loader.test.ts"],
        watchMode: false,
      },
    ]);

    expect(buildVitestRunPlans(["src/plugins/discovery.test.ts"])).toEqual([
      {
        config: "vitest/vitest.plugins.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/plugins/discovery.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("widens non-test helper file targets to sibling tests inside the routed suite", () => {
    expect(buildVitestRunPlans(["src/gateway/gateway-connection.test-mocks.ts"])).toEqual([
      {
        config: "vitest/vitest.gateway.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/gateway/**/*.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("widens extension helper targets to sibling extension tests", () => {
    expect(
      buildVitestRunPlans(["extensions/memory-core/src/memory/test-runtime-mocks.ts"]),
    ).toEqual([
      {
        config: "vitest/vitest.extensions.config.ts",
        forwardedArgs: [],
        includePatterns: ["extensions/memory-core/src/memory/**/*.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes the tests of every bundled extension to the shared extensions config", () => {
    expect(extensionIds).toContain("feishu");
    expect(extensionIds).toContain("wechat");
    for (const extensionId of extensionIds) {
      const target = `extensions/${extensionId}/src/example.test.ts`;
      expect(buildVitestRunPlans([target]), extensionId).toEqual([extensionsLanePlan(target)]);
    }
  });

  it("does not give a channel-shaped extension a lane of its own", () => {
    // Upstream routed messaging extensions to a per-channel config. This fork has
    // one extensions lane, so a channel-like name must not select a config that
    // does not exist.
    const target = "extensions/discord/src/monitor/message-handler.preflight.test.ts";
    expect(buildVitestRunPlans([target])).toEqual([extensionsLanePlan(target)]);
  });

  it("routes ui targets to the ui config", () => {
    expect(buildVitestRunPlans(["ui/src/ui/views/channels.test.ts"])).toEqual([
      {
        config: "vitest/vitest.ui.config.ts",
        forwardedArgs: [],
        includePatterns: ["ui/src/ui/views/channels.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes utils targets to the utils config", () => {
    expect(buildVitestRunPlans(["src/utils/path.test.ts"])).toEqual([
      {
        config: "vitest/vitest.utils.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/utils/path.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("widens top-level test helpers to sibling repo tests under contracts", () => {
    expect(buildVitestRunPlans(["test/helpers/temp-home.ts"])).toEqual([
      {
        config: "vitest/vitest.tooling.config.ts",
        forwardedArgs: [],
        includePatterns: ["test/helpers/**/*.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes e2e targets straight to the e2e config", () => {
    expect(buildVitestRunPlans(["src/commands/models.set.e2e.test.ts"])).toEqual([
      {
        config: "vitest/vitest.e2e.config.ts",
        forwardedArgs: ["src/commands/models.set.e2e.test.ts"],
        includePatterns: null,
        watchMode: false,
      },
    ]);
  });

  it("routes browser extension targets to the extensions config", () => {
    expect(buildVitestRunPlans(["extensions/browser/index.test.ts"])).toEqual([
      extensionsLanePlan("extensions/browser/index.test.ts"),
    ]);
  });

  it("keeps non-provider extension file targets on the shared extensions config", () => {
    expect(buildVitestRunPlans(["extensions/firecrawl/index.test.ts"])).toEqual([
      extensionsLanePlan("extensions/firecrawl/index.test.ts"),
    ]);
  });

  it("splits mixed core and extension targets into separate vitest runs", () => {
    expect(
      buildVitestRunPlans([
        "src/config/config-misc.test.ts",
        "extensions/discord/src/monitor/message-handler.preflight.test.ts",
        "-t",
        "mention",
      ]),
    ).toEqual([
      {
        config: "vitest/vitest.runtime-config.config.ts",
        forwardedArgs: ["-t", "mention"],
        includePatterns: ["src/config/config-misc.test.ts"],
        watchMode: false,
      },
      {
        config: "vitest/vitest.extensions.config.ts",
        forwardedArgs: ["-t", "mention"],
        includePatterns: ["extensions/discord/src/monitor/message-handler.preflight.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("writes scoped include files for routed extension runs", () => {
    const [spec] = createVitestRunSpecs([
      "extensions/discord/src/monitor/message-handler.preflight.test.ts",
    ]);

    expect(spec?.pnpmArgs).toEqual([
      ...VITEST_NODE_PREFIX,
      "run",
      "--config",
      "vitest/vitest.extensions.config.ts",
    ]);
    expect(spec?.includePatterns).toEqual([
      "extensions/discord/src/monitor/message-handler.preflight.test.ts",
    ]);
    expect(spec?.includeFilePath).toContain("kaijibot-vitest-include-");
    expect(spec?.env.KAIJIBOT_VITEST_INCLUDE_FILE).toBe(spec?.includeFilePath);
  });

  it("rejects watch mode when a command spans multiple suites", () => {
    expect(() =>
      buildVitestRunPlans([
        "--watch",
        "src/config/config-misc.test.ts",
        "extensions/discord/src/monitor/message-handler.preflight.test.ts",
      ]),
    ).toThrow("watch mode with mixed test suites is not supported");
  });
});

describe("test-projects lane integrity", () => {
  const laneConfigFor = (target: string) => buildVitestRunPlans([target])[0]?.config;

  // One real file per routed family. Every plan must point at a config that exists on
  // disk: vitest aborts before collecting a single test when --config is missing.
  it.each([
    ["default", "src/cognitive/cognitive-locale.test.ts"],
    ["acp", "src/acp/approval-classifier.test.ts"],
    ["agents", "src/agents/acp-binding-architecture.guardrail.test.ts"],
    ["autoReply", "src/auto-reply/chunk.test.ts"],
    ["boundary", "src/infra/home-dir.test.ts"],
    ["bundled", "src/plugins/loader.test.ts"],
    ["channel", "src/channels/account-snapshot-fields.test.ts"],
    ["cli", "src/cli/acp-cli.option-collisions.test.ts"],
    ["command", "src/commands/agent-via-gateway.test.ts"],
    ["contracts", "src/plugins/contracts/auth-choice.contract.test.ts"],
    ["cron", "src/cron/cron-protocol-conformance.test.ts"],
    ["daemon", "src/daemon/cmd-argv.test.ts"],
    ["gateway", "src/gateway/agent-prompt.test.ts"],
    ["hooks", "src/hooks/fire-and-forget.test.ts"],
    ["infra", "src/infra/abort-pattern.test.ts"],
    ["logging", "src/logging/config.test.ts"],
    ["media", "src/media/audio.test.ts"],
    ["mediaUnderstanding", "src/media-understanding/apply.echo-transcript.test.ts"],
    ["plugin", "src/plugins/bundle-claude-inspect.test.ts"],
    ["pluginSdk", "src/plugin-sdk/acp-runtime.test.ts"],
    ["pluginSdkLight", "src/plugin-sdk/lazy-value.test.ts"],
    ["process", "src/process/command-queue.test.ts"],
    ["runtimeConfig", "src/config/agent-dirs.test.ts"],
    ["secrets", "src/secrets/apply.test.ts"],
    ["sharedCore", "src/shared/assistant-identity-values.test.ts"],
    ["tasks", "src/tasks/task-executor-boundary.test.ts"],
    ["tooling", "src/scripts/canvas-a2ui-copy.test.ts"],
    ["tui", "src/tui/commands.test.ts"],
    ["ui", "ui/src/ui/app-chat.test.ts"],
    ["utils", "src/utils/cjk-chars.test.ts"],
    ["wizard", "src/wizard/clack-prompter.test.ts"],
  ])("routes $kind targets to a lane config that exists on disk", (_kind, target) => {
    const config = laneConfigFor(target);
    if (!config) {
      throw new Error(`no vitest plan was produced for ${target}`);
    }
    expect(existsSync(new URL(config, repoRoot))).toBe(true);
  });

  it.each(["src/tasks", "src/cron", "src/gateway", "src/commands", "src/secrets", "ui"])(
    "routes the directory %s to the same lane as a test file inside it",
    (dir) => {
      const viaFile = laneConfigFor(`${dir}/example.test.ts`);
      if (!viaFile) {
        throw new Error(`no vitest plan was produced for ${dir}/example.test.ts`);
      }
      expect(laneConfigFor(dir)).toBe(viaFile);
      expect(laneConfigFor(`${dir}/`)).toBe(viaFile);
    },
  );

  // Vitest aborts before collecting a single test when --config points at a file
  // that does not exist, so nothing that picks a lane may name a missing config.
  // Upstream's per-extension and light lanes were removed in this fork; these
  // checks keep their names from coming back through a stale table.
  it("names only lane configs that exist on disk", () => {
    const configs = listRoutedVitestConfigs();
    expect(configs.length).toBeGreaterThan(20);
    for (const config of configs) {
      expect(existsSync(new URL(config, repoRoot)), config).toBe(true);
    }
  });

  it("runs a full suite made only of shard configs that exist on disk", () => {
    const shardConfigs = new Set(listFullSuiteShardConfigs());
    expect(shardConfigs.size).toBeGreaterThan(0);
    for (const config of shardConfigs) {
      expect(existsSync(new URL(config, repoRoot)), config).toBe(true);
    }
    for (const [config] of FULL_SUITE_CONFIG_WEIGHT) {
      expect(shardConfigs.has(config), config).toBe(true);
    }
  });
});
