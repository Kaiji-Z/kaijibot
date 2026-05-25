import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  appendMemoryHostEvent,
  readMemoryHostEvents,
  resolveMemoryHostEventLogPath,
} from "./memory-host-events.js";
import { createPluginSdkTestHarness } from "./test-helpers.js";

const { createTempDir } = createPluginSdkTestHarness();

describe("memory host event journal helpers", () => {
  it("appends and reads typed workspace events", async () => {
    const workspaceDir = await createTempDir("memory-host-events-");

    await appendMemoryHostEvent(workspaceDir, {
      type: "memory.recall.recorded",
      timestamp: "2026-04-05T12:00:00.000Z",
      query: "glacier backup",
      resultCount: 1,
      results: [
        {
          path: "memory/2026-04-05.md",
          startLine: 1,
          endLine: 3,
          score: 0.9,
        },
      ],
    });
    await appendMemoryHostEvent(workspaceDir, {
      type: "memory.promotion.applied",
      timestamp: "2026-04-05T14:00:00.000Z",
      memoryPath: "MEMORY.md",
      applied: 2,
      candidates: [
        {
          key: "glacier-backup",
          path: "memory/2026-04-05.md",
          startLine: 1,
          endLine: 3,
          score: 0.9,
          recallCount: 3,
        },
      ],
    });

    const eventLogPath = resolveMemoryHostEventLogPath(workspaceDir);
    await expect(fs.readFile(eventLogPath, "utf8")).resolves.toContain(
      '"type":"memory.recall.recorded"',
    );

    const events = await readMemoryHostEvents({ workspaceDir });
    const tail = await readMemoryHostEvents({ workspaceDir, limit: 1 });

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("memory.recall.recorded");
    expect(events[1]?.type).toBe("memory.promotion.applied");
    expect(tail).toHaveLength(1);
    expect(tail[0]?.type).toBe("memory.promotion.applied");
  });
});
