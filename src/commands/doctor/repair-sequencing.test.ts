import { describe, expect, it } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";
import { runDoctorRepairSequence } from "./repair-sequencing.js";

describe("doctor repair sequencing", () => {
  it("applies ordered repairs and sanitizes empty-allowlist warnings", async () => {
    const result = await runDoctorRepairSequence({
      state: {
        cfg: {
          channels: {
            discord: {
              allowFrom: [123],
            },
            tools: {
              exec: {
                toolsBySender: {
                  "bad\u001B[31m-key\u001B[0m\r\nnext": { enabled: true },
                },
              },
            },
            signal: {
              accounts: {
                "ops\u001B[31m-team\u001B[0m\r\nnext": {
                  dmPolicy: "allowlist",
                },
              },
            },
          },
        } as unknown as KaijiBotConfig,
        candidate: {
          channels: {
            discord: {
              allowFrom: [123],
            },
            tools: {
              exec: {
                toolsBySender: {
                  "bad\u001B[31m-key\u001B[0m\r\nnext": { enabled: true },
                },
              },
            },
            signal: {
              accounts: {
                "ops\u001B[31m-team\u001B[0m\r\nnext": {
                  dmPolicy: "allowlist",
                },
              },
            },
          },
        } as unknown as KaijiBotConfig,
        pendingChanges: false,
        fixHints: [],
      },
      doctorFixCommand: "kaijibot doctor --fix",
    });

    expect(result.state.pendingChanges).toBe(true);
    // Discord's numeric allowFrom repair lives in the discord channel doctor
    // adapter, which is not bundled in this fork; the raw value passes through.
    expect(result.state.candidate.channels?.discord?.allowFrom).toEqual([123]);
    expect(result.changeNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "channels.tools.exec.toolsBySender: migrated 1 legacy key to typed id: entries",
        ),
      ]),
    );
    expect(result.changeNotes.join("\n")).toContain("bad-keynext -> id:bad-keynext");
    expect(result.changeNotes.join("\n")).not.toContain("\u001B");
    expect(result.changeNotes.join("\n")).not.toContain("\r");
    expect(result.warningNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("channels.signal.accounts.ops-teamnext.dmPolicy"),
      ]),
    );
    expect(result.warningNotes.join("\n")).not.toContain("\u001B");
    expect(result.warningNotes.join("\n")).not.toContain("\r");
  });

  it("leaves allowFrom untouched and reports nothing when no channel doctor adapter claims it", async () => {
    const result = await runDoctorRepairSequence({
      state: {
        cfg: {
          channels: {
            discord: {
              allowFrom: [106232522769186816],
            },
          },
        } as unknown as KaijiBotConfig,
        candidate: {
          channels: {
            discord: {
              allowFrom: [106232522769186816],
            },
          },
        } as unknown as KaijiBotConfig,
        pendingChanges: false,
        fixHints: [],
      },
      doctorFixCommand: "kaijibot doctor --fix",
    });

    // Discord's unsafe-numeric-id warning lived in the discord channel doctor
    // adapter, which is not bundled in this fork; nothing claims the value.
    expect(result.changeNotes).toEqual([]);
    expect(result.warningNotes).toEqual([]);
    expect(result.state.pendingChanges).toBe(false);
    expect(result.state.candidate.channels?.discord?.allowFrom).toEqual([106232522769186816]);
  });
});
