import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { withEnvAsync } from "../test-utils/env.js";
import { collectGatewayConfigFindings, collectLoggingFindings } from "./audit.js";

function hasGatewayFinding(
  checkId: "gateway.trusted_proxies_missing" | "gateway.loopback_no_auth",
  severity: "warn" | "critical",
  findings: ReturnType<typeof collectGatewayConfigFindings>,
) {
  return findings.some((finding) => finding.checkId === checkId && finding.severity === severity);
}

function hasLoggingFinding(
  checkId: "logging.redact_off",
  severity: "warn",
  findings: ReturnType<typeof collectLoggingFindings>,
) {
  return findings.some((finding) => finding.checkId === checkId && finding.severity === severity);
}

describe("security audit loopback and logging findings", () => {
  it("evaluates loopback control UI and logging exposure findings", async () => {
    await Promise.all([
      (async () => {
        const cfg: KaijiBotConfig = {
          gateway: {
            bind: "loopback",
            controlUi: { enabled: true },
          },
        };
        expect(
          hasGatewayFinding(
            "gateway.trusted_proxies_missing",
            "warn",
            collectGatewayConfigFindings(cfg, cfg, process.env),
          ),
        ).toBe(true);
      })(),
      withEnvAsync(
        {
          KAIJIBOT_GATEWAY_TOKEN: undefined,
          KAIJIBOT_GATEWAY_PASSWORD: undefined,
        },
        async () => {
          const cfg: KaijiBotConfig = {
            gateway: {
              bind: "loopback",
              controlUi: { enabled: true },
              auth: {},
            },
          };
          expect(
            hasGatewayFinding(
              "gateway.loopback_no_auth",
              "critical",
              collectGatewayConfigFindings(cfg, cfg, process.env),
            ),
          ).toBe(true);
        },
      ),
      (async () => {
        const cfg: KaijiBotConfig = {
          logging: { redactSensitive: "off" },
        };
        expect(hasLoggingFinding("logging.redact_off", "warn", collectLoggingFindings(cfg))).toBe(
          true,
        );
      })(),
    ]);
  });
});
