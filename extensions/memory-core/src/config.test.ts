import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { validateJsonSchemaValue } from "../../../src/plugins/schema-validator.js";

const manifest = JSON.parse(
  fs.readFileSync(new URL("../kaijibot.plugin.json", import.meta.url), "utf-8"),
) as { configSchema: Record<string, unknown> };

describe("memory-core manifest config schema", () => {
  it("accepts consolidation config used by runtime", () => {
    const result = validateJsonSchemaValue({
      schema: manifest.configSchema,
      cacheKey: "memory-core.manifest.consolidation",
      value: {
        consolidation: {
          enabled: true,
          cron: "0 3 * * *",
          timezone: "UTC",
          verboseLogging: false,
          concurrency: 2,
          batchSize: 4000,
          lookbackDays: 30,
        },
      },
    });

    expect(result.ok).toBe(true);
  });
});
