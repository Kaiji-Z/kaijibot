import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveExtensionBatchPlan,
  resolveExtensionTestPlan,
} from "../../scripts/lib/extension-test-plan.mjs";

const repoUrl = new URL("../../", import.meta.url);
const repoRoot = fileURLToPath(repoUrl);

// `pnpm test:extension <id>` and `pnpm test:extensions:batch` run what this plan names.
// A config that does not exist aborts vitest before a single test is collected, and
// upstream's per-extension configs were removed in this fork: one shared lane remains.
describe("extension test plan", () => {
  it("routes the two first-class channels to the shared extensions config", () => {
    for (const extensionId of ["feishu", "wechat"]) {
      const plan = resolveExtensionTestPlan({ cwd: repoRoot, targetArg: extensionId });
      expect(plan.config, extensionId).toBe("vitest/vitest.extensions.config.ts");
      expect(plan.extensionId, extensionId).toBe(extensionId);
      expect(plan.hasTests, extensionId).toBe(true);
    }
  });

  it("names only configs that exist on disk for the whole extension batch", () => {
    const batch = resolveExtensionBatchPlan({ cwd: repoRoot });
    expect(batch.extensionIds).toEqual(expect.arrayContaining(["feishu", "wechat"]));
    const configs = [...new Set(batch.planGroups.map((group) => group.config))];
    expect(configs).toEqual(["vitest/vitest.extensions.config.ts"]);
    for (const config of configs) {
      expect(existsSync(new URL(config, repoUrl)), config).toBe(true);
    }
  });
});
