import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { validateJsonSchemaValue } from "../../src/plugins/schema-validator.js";
import { memoryConfigSchema } from "./config.js";

const manifest = JSON.parse(
  fs.readFileSync(new URL("./kaijibot.plugin.json", import.meta.url), "utf-8"),
) as { configSchema: Record<string, unknown> };

describe("memory-lancedb config", () => {
  it("accepts embedding config in the manifest schema and parses it at runtime", () => {
    const manifestResult = validateJsonSchemaValue({
      schema: manifest.configSchema,
      cacheKey: "memory-lancedb.manifest.embedding",
      value: {
        embedding: {
          apiKey: "sk-test",
        },
      },
    });

    const parsed = memoryConfigSchema.parse({
      embedding: {
        apiKey: "sk-test",
      },
    });

    expect(manifestResult.ok).toBe(true);
    expect(parsed.embedding.apiKey).toBe("sk-test");
  });

  it("rejects unrelated unknown top-level config keys", () => {
    expect(() => {
      memoryConfigSchema.parse({
        embedding: {
          apiKey: "sk-test",
        },
        unexpected: true,
      });
    }).toThrow("memory config has unknown keys: unexpected");
  });
});
