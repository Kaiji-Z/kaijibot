import { describe, expect, it } from "vitest";
import { collectBrowserSecurityAuditFindings } from "./security-audit.js";

function collectFindings(
  config: Parameters<typeof collectBrowserSecurityAuditFindings>[0]["config"],
) {
  return collectBrowserSecurityAuditFindings({
    config,
    sourceConfig: config,
    env: {} as NodeJS.ProcessEnv,
    stateDir: "/tmp/kaijibot-state",
    configPath: "/tmp/kaijibot.json",
  });
}

describe("browser security audit collector", () => {
  it("flags browser control without auth", () => {
    const findings = collectFindings({
      gateway: {
        controlUi: { enabled: false },
        auth: {},
      },
      browser: {
        enabled: true,
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "browser.control_no_auth",
          severity: "critical",
        }),
      ]),
    );
  });

  it("warns on remote http CDP profiles", () => {
    const findings = collectFindings({
      browser: {
        profiles: {
          remote: {
            cdpUrl: "http://example.com:9222",
            color: "#0066CC",
          },
        },
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "browser.remote_cdp_http",
          severity: "warn",
        }),
      ]),
    );
  });

  it("redacts private-host CDP URLs in findings", () => {
    const findings = collectFindings({
      browser: {
        ssrfPolicy: {
          dangerouslyAllowPrivateNetwork: true,
        },
        profiles: {
          remote: {
            cdpUrl:
              "http://169.254.169.254:9222/json/version?token=supersecrettokenvalue1234567890",
            color: "#0066CC",
          },
        },
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "browser.remote_cdp_private_host",
          severity: "warn",
          detail: expect.stringContaining("token=supers…7890"),
        }),
      ]),
    );
  });

  it("warns about persistent agent login profiles when the login proxy is on", () => {
    const findings = collectFindings({
      browser: {
        proxy: { enabled: true },
        profiles: {
          "agent-main": { cdpPort: 18801, color: "#0066CC" },
        },
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "browser.proxy_persistent_login_profiles",
          severity: "warn",
          detail: expect.stringContaining("agent-main"),
        }),
      ]),
    );
  });

  it("does not warn about agent login profiles when the login proxy is off", () => {
    const findings = collectFindings({
      browser: {
        profiles: {
          "agent-main": { cdpPort: 18801, color: "#0066CC" },
        },
      },
    });

    expect(
      findings.find((f) => f.checkId === "browser.proxy_persistent_login_profiles"),
    ).toBeUndefined();
  });

  it("does not warn when the login proxy is on but no agent profiles exist", () => {
    const findings = collectFindings({
      browser: {
        proxy: { enabled: true },
        profiles: {
          kaijibot: { cdpPort: 18800, color: "#FF4500" },
        },
      },
    });

    expect(
      findings.find((f) => f.checkId === "browser.proxy_persistent_login_profiles"),
    ).toBeUndefined();
  });
});
