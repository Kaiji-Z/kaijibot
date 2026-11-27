import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAuthStorePath } from "../agents/auth-profiles/paths.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  saveAuthProfileStore,
} from "../agents/auth-profiles/store.js";
import type { AuthProfileStore } from "../agents/auth-profiles/types.js";
import { markAuthProfileUsed } from "../agents/auth-profiles/usage.js";
import {
  MODELS_JSON_STATE,
  resetModelsJsonReadyCacheForTest,
} from "../agents/models-config-state.js";
import { ensureKaijiBotModelsJson } from "../agents/models-config.js";

// Provider discovery is what a re-plan costs; loading the provider plugins to
// run it is not what these tests measure, so it is kept out of the plan.
vi.mock("../agents/models-config.providers.implicit.js", () => ({
  resolveImplicitProviders: async () => undefined,
}));

// Lives in the gateway shard because `src/agents` tests are not part of the CI
// full suite, and this is what made every gateway turn slow: usage bookkeeping
// saves the auth-profile store after each turn, and a save that rewrites
// unchanged credentials moved the mtime the models.json fingerprint reads, so
// the plan (and with it local provider discovery) ran again on every turn.

const PROFILE_ID = "anthropic:default";

function makeStore(): AuthProfileStore {
  return {
    version: 1,
    profiles: {
      [PROFILE_ID]: { type: "api_key", provider: "anthropic", key: "sk-ant-test" },
    },
  };
}

describe("models.json plan cache across auth usage bookkeeping", () => {
  afterEach(async () => {
    resetModelsJsonReadyCacheForTest();
    clearRuntimeAuthProfileStoreSnapshots();
  });

  it("stays cached when a turn records profile usage", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-models-json-usage-"));
    try {
      saveAuthProfileStore(makeStore(), agentDir);
      const targetPath = path.join(agentDir, "models.json");

      const first = await ensureKaijiBotModelsJson({}, agentDir);
      const planned = MODELS_JSON_STATE.readyCache.get(targetPath);
      expect(planned).toBeDefined();

      await markAuthProfileUsed({ store: makeStore(), profileId: PROFILE_ID, agentDir });

      const second = await ensureKaijiBotModelsJson({}, agentDir);
      // A cache hit returns the result of the very promise the first call stored.
      expect(MODELS_JSON_STATE.readyCache.get(targetPath)).toBe(planned);
      expect(second).toBe(first);
    } finally {
      resetModelsJsonReadyCacheForTest();
      clearRuntimeAuthProfileStoreSnapshots();
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("is dropped when a credential changes", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-models-json-rotate-"));
    try {
      const store = makeStore();
      saveAuthProfileStore(store, agentDir);
      const targetPath = path.join(agentDir, "models.json");

      await ensureKaijiBotModelsJson({}, agentDir);
      const planned = MODELS_JSON_STATE.readyCache.get(targetPath);
      expect(planned).toBeDefined();

      saveAuthProfileStore(
        {
          ...store,
          profiles: {
            [PROFILE_ID]: { type: "api_key", provider: "anthropic", key: "sk-ant-rotated" },
          },
        },
        agentDir,
      );

      await ensureKaijiBotModelsJson({}, agentDir);
      expect(MODELS_JSON_STATE.readyCache.get(targetPath)).not.toBe(planned);
      expect(JSON.parse(await fs.readFile(resolveAuthStorePath(agentDir), "utf8"))).toMatchObject({
        profiles: { [PROFILE_ID]: { key: "sk-ant-rotated" } },
      });
    } finally {
      resetModelsJsonReadyCacheForTest();
      clearRuntimeAuthProfileStoreSnapshots();
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });
});
