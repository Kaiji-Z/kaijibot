import { describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../runtime-api.js";
import { resolveWebhooksPluginConfig } from "./config.js";

describe("resolveWebhooksPluginConfig", () => {
  it("resolves default paths and SecretRef-backed secrets", async () => {
    const routes = await resolveWebhooksPluginConfig({
      pluginConfig: {
        routes: {
          zapier: {
            sessionKey: "agent:main:main",
            secret: {
              source: "env",
              provider: "default",
              id: "KAIJIBOT_WEBHOOK_SECRET",
            },
          },
        },
      },
      cfg: {} as KaijiBotConfig,
      env: {
        KAIJIBOT_WEBHOOK_SECRET: "shared-secret",
      },
    });

    expect(routes).toEqual([
      {
        routeId: "zapier",
        path: "/plugins/webhooks/zapier",
        sessionKey: "agent:main:main",
        secret: "shared-secret",
        controllerId: "webhooks/zapier",
      },
    ]);
  });

  it("skips routes whose secret cannot be resolved", async () => {
    const warn = vi.fn();

    const routes = await resolveWebhooksPluginConfig({
      pluginConfig: {
        routes: {
          missing: {
            sessionKey: "agent:main:main",
            secret: {
              source: "env",
              provider: "default",
              id: "MISSING_SECRET",
            },
          },
        },
      },
      cfg: {} as KaijiBotConfig,
      env: {},
      logger: { warn } as never,
    });

    expect(routes).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[webhooks] skipping route missing:"),
    );
  });

  it("rejects duplicate normalized paths", async () => {
    await expect(
      resolveWebhooksPluginConfig({
        pluginConfig: {
          routes: {
            first: {
              path: "/plugins/webhooks/shared",
              sessionKey: "agent:main:main",
              secret: "a",
            },
            second: {
              path: "/plugins/webhooks/shared/",
              sessionKey: "agent:main:other",
              secret: "b",
            },
          },
        },
        cfg: {} as KaijiBotConfig,
        env: {},
      }),
    ).rejects.toThrow(/conflicts with routes\.first\.path/i);
  });
});
