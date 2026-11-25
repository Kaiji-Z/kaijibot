import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// runPreparedReply loads the persona and corrections of the current turn itself. That lookup
// has to use the same key as every write path (resolveCognitiveUserId lowercases the id);
// with the raw SenderId, WeChat ids containing uppercase letters were stored under one file
// and read from another. Pinned on the source because driving runPreparedReply needs a full
// agent harness; src/cognitive/identity-store-key.test.ts shows why the key matters.
const source = fs.readFileSync(path.join(import.meta.dirname, "get-reply-run.ts"), "utf8");

describe("per-turn cognitive lookup", () => {
  it("keys the persona and correction lookup by the resolved user id", () => {
    expect(source).toContain("resolveCognitiveUserId(undefined, sessionCtx.SenderId)");
    expect(source).not.toContain("const userId = sessionCtx.SenderId;");
  });
});
