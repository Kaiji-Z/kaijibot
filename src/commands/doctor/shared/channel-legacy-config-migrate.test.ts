import { describe, expect, it } from "vitest";
import { applyChannelDoctorCompatibilityMigrations } from "./channel-legacy-config-migrate.js";

describe("bundled channel legacy config migrations", () => {
  // The mattermost private-network alias normalization used to ship with the
  // mattermost channel plugin, which is not bundled in this repo; the channel
  // doctor compatibility pass leaves unknown channels untouched.
  it("leaves legacy private-network aliases in place without a bundled channel contract", () => {
    const raw = {
      channels: {
        mattermost: {
          allowPrivateNetwork: true,
          accounts: {
            work: {
              allowPrivateNetwork: false,
            },
          },
        },
      },
    };
    const result = applyChannelDoctorCompatibilityMigrations(raw);

    expect(result.next).toEqual(raw);
    expect(result.changes).toEqual([]);
  });
});
