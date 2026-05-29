import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveUserIdForSessionFile } from "./consolidation-userid.js";

describe("resolveUserIdForSessionFile", () => {
  let fixtureRoot: string;
  let caseId = 0;

  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "consolidation-userid-test-"));
  });

  afterAll(async () => {
    if (fixtureRoot) {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  async function withSessionDir(
    setup: (dir: string) => Promise<void>,
    run: (dir: string, fileName: string) => Promise<void>,
  ) {
    const dir = path.join(fixtureRoot, `case-${caseId++}`);
    await fs.mkdir(dir, { recursive: true });
    await setup(dir);
    await run(dir, "session-abc123.jsonl");
  }

  it("resolves ou_xxx userId from feishu direct session key", async () => {
    await withSessionDir(
      async (dir) => {
        await fs.writeFile(
          path.join(dir, "sessions.json"),
          JSON.stringify({
            "agent:main:feishu:direct:ou_alice999": { sessionId: "session-abc123" },
          }),
        );
        await fs.writeFile(path.join(dir, "session-abc123.jsonl"), "");
      },
      async (dir, fileName) => {
        const userId = await resolveUserIdForSessionFile(path.join(dir, fileName));
        expect(userId).toBe("ou_alice999");
      },
    );
  });

  it("resolves ou_xxx userId from feishu group session key with sender", async () => {
    await withSessionDir(
      async (dir) => {
        await fs.writeFile(
          path.join(dir, "sessions.json"),
          JSON.stringify({
            "agent:main:feishu:group:oc_xyz:sender:ou_bob777": { sessionId: "session-abc123" },
          }),
        );
        await fs.writeFile(path.join(dir, "session-abc123.jsonl"), "");
      },
      async (dir, fileName) => {
        const userId = await resolveUserIdForSessionFile(path.join(dir, fileName));
        expect(userId).toBe("ou_bob777");
      },
    );
  });

  it("resolves userId via sessionFile basename match", async () => {
    await withSessionDir(
      async (dir) => {
        await fs.writeFile(
          path.join(dir, "sessions.json"),
          JSON.stringify({
            "agent:main:feishu:direct:ou_charlie": {
              sessionId: "different-id",
              sessionFile: "session-abc123.jsonl",
            },
          }),
        );
        await fs.writeFile(path.join(dir, "session-abc123.jsonl"), "");
      },
      async (dir, fileName) => {
        const userId = await resolveUserIdForSessionFile(path.join(dir, fileName));
        expect(userId).toBe("ou_charlie");
      },
    );
  });

  it("handles .reset. suffix in filename", async () => {
    const dir = path.join(fixtureRoot, `case-${caseId++}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "sessions.json"),
      JSON.stringify({
        "agent:main:feishu:direct:ou_resetuser": { sessionId: "session-reset999" },
      }),
    );
    const resetFileName = "session-reset999.jsonl.reset.2026-05-01T00:00:00.000Z";
    await fs.writeFile(path.join(dir, resetFileName), "");
    const userId = await resolveUserIdForSessionFile(path.join(dir, resetFileName));
    expect(userId).toBe("ou_resetuser");
  });

  it("returns null when sessions.json does not exist", async () => {
    const dir = path.join(fixtureRoot, `case-${caseId++}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "session-orphan.jsonl"), "");
    const userId = await resolveUserIdForSessionFile(path.join(dir, "session-orphan.jsonl"));
    expect(userId).toBeNull();
  });

  it("returns null when sessionId not found in store", async () => {
    await withSessionDir(
      async (dir) => {
        await fs.writeFile(
          path.join(dir, "sessions.json"),
          JSON.stringify({
            "agent:main:feishu:direct:ou_other": { sessionId: "session-different" },
          }),
        );
        await fs.writeFile(path.join(dir, "session-abc123.jsonl"), "");
      },
      async (dir, fileName) => {
        const userId = await resolveUserIdForSessionFile(path.join(dir, fileName));
        expect(userId).toBeNull();
      },
    );
  });

  it("returns null when session key has no extractable userId", async () => {
    await withSessionDir(
      async (dir) => {
        await fs.writeFile(
          path.join(dir, "sessions.json"),
          JSON.stringify({
            "agent:main:feishu:group:oc_xxx": { sessionId: "session-abc123" },
          }),
        );
        await fs.writeFile(path.join(dir, "session-abc123.jsonl"), "");
      },
      async (dir, fileName) => {
        const userId = await resolveUserIdForSessionFile(path.join(dir, fileName));
        expect(userId).toBeNull();
      },
    );
  });

  it("returns null when sessions.json is corrupt", async () => {
    await withSessionDir(
      async (dir) => {
        await fs.writeFile(path.join(dir, "sessions.json"), "not valid json {{{");
        await fs.writeFile(path.join(dir, "session-abc123.jsonl"), "");
      },
      async (dir, fileName) => {
        const userId = await resolveUserIdForSessionFile(path.join(dir, fileName));
        expect(userId).toBeNull();
      },
    );
  });

  it("returns null when sessions.json is an array instead of object", async () => {
    await withSessionDir(
      async (dir) => {
        await fs.writeFile(path.join(dir, "sessions.json"), JSON.stringify([{ bad: true }]));
        await fs.writeFile(path.join(dir, "session-abc123.jsonl"), "");
      },
      async (dir, fileName) => {
        const userId = await resolveUserIdForSessionFile(path.join(dir, fileName));
        expect(userId).toBeNull();
      },
    );
  });

  it("uses cached store on second call within TTL", async () => {
    await withSessionDir(
      async (dir) => {
        await fs.writeFile(
          path.join(dir, "sessions.json"),
          JSON.stringify({
            "agent:main:feishu:direct:ou_cached": { sessionId: "session-abc123" },
          }),
        );
        await fs.writeFile(path.join(dir, "session-abc123.jsonl"), "");
      },
      async (dir, fileName) => {
        const filePath = path.join(dir, fileName);
        const userId1 = await resolveUserIdForSessionFile(filePath);
        expect(userId1).toBe("ou_cached");

        const userId2 = await resolveUserIdForSessionFile(filePath);
        expect(userId2).toBe("ou_cached");
      },
    );
  });

  it("returns null for empty filename", async () => {
    const dir = path.join(fixtureRoot, `case-${caseId++}`);
    await fs.mkdir(dir, { recursive: true });
    const userId = await resolveUserIdForSessionFile(path.join(dir, ""));
    expect(userId).toBeNull();
  });
});
