import { describe, expect, it } from "vitest";
import { KaijiBotSchema } from "./zod-schema.js";

describe("KaijiBotSchema cron retention and run-log validation", () => {
  it("accepts valid cron.sessionRetention and runLog values", () => {
    expect(() =>
      KaijiBotSchema.parse({
        cron: {
          sessionRetention: "1h30m",
          runLog: {
            maxBytes: "5mb",
            keepLines: 2500,
          },
        },
      }),
    ).not.toThrow();
  });

  it("rejects invalid cron.sessionRetention", () => {
    expect(() =>
      KaijiBotSchema.parse({
        cron: {
          sessionRetention: "abc",
        },
      }),
    ).toThrow(/sessionRetention|duration/i);
  });

  it("rejects invalid cron.runLog.maxBytes", () => {
    expect(() =>
      KaijiBotSchema.parse({
        cron: {
          runLog: {
            maxBytes: "wat",
          },
        },
      }),
    ).toThrow(/runLog|maxBytes|size/i);
  });
});
