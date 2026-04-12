import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  projectConfigOntoRuntimeSourceSnapshot,
  resetConfigRuntimeState,
  setRuntimeConfigSnapshotRefreshHandler,
  setRuntimeConfigSnapshot,
} from "./io.js";
import type { KaijiBotConfig } from "./types.js";

function createSourceConfig(): KaijiBotConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
          models: [],
        },
      },
    },
  };
}

function createRuntimeConfig(): KaijiBotConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-runtime-resolved", // pragma: allowlist secret
          models: [],
        },
      },
    },
  };
}

function resetRuntimeConfigState(): void {
  setRuntimeConfigSnapshotRefreshHandler(null);
  resetConfigRuntimeState();
}

describe("runtime config snapshot writes", () => {
  beforeEach(() => {
    resetRuntimeConfigState();
  });

  afterEach(() => {
    resetRuntimeConfigState();
  });

  it("skips source projection for non-runtime-derived configs", () => {
    const sourceConfig: KaijiBotConfig = {
      ...createSourceConfig(),
      gateway: {
        auth: {
          mode: "token",
        },
      },
    };
    const runtimeConfig: KaijiBotConfig = {
      ...createRuntimeConfig(),
      gateway: {
        auth: {
          mode: "token",
        },
      },
    };
    const independentConfig: KaijiBotConfig = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-independent-config", // pragma: allowlist secret
            models: [],
          },
        },
      },
    };

    setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
    const projected = projectConfigOntoRuntimeSourceSnapshot(independentConfig);
    expect(projected).toBe(independentConfig);
  });
});
