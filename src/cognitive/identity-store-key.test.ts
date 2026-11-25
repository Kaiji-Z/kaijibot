import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CorrectionStore } from "./correction/store.js";
import { resolveCognitiveUserId } from "./identity.js";
import { PersonaStore } from "./persona/store.js";

// Why every cognitive lookup has to go through resolveCognitiveUserId: the stores key files by
// the id exactly as given, and every write path stores under the resolved (lowercased) id.
let configDir = "";

beforeEach(() => {
  configDir = mkdtempSync(path.join(os.tmpdir(), "cognitive-store-key-"));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

// WeChat user ids look like this; Feishu open_ids are lowercase and never hit the problem.
const senderId = "WxAbC123@im.wechat";
const resolvedId = resolveCognitiveUserId(undefined, senderId);
if (!resolvedId) {
  throw new Error("resolveCognitiveUserId returned nothing for a sender id");
}

describe("cognitive stores under a user id that contains uppercase letters", () => {
  it("resolves to a lowercased id", () => {
    expect(resolvedId).toBe("wxabc123@im.wechat");
  });

  it("only finds persona and corrections stored under the resolved id", async () => {
    const personas = new PersonaStore(configDir);
    await personas.update("main", resolvedId, (persona) => ({
      ...persona,
      identity: { ...persona.identity, displayName: "Kai" },
    }));
    const corrections = new CorrectionStore(configDir);
    await corrections.addOrReinforce("main", resolvedId, {
      id: "c1",
      domain: "coding",
      trigger: "t",
      mistake: "m",
      correction: "c",
      provenance: "self",
      reinforcedCount: 1,
      createdAt: Date.now(),
      lastReinforced: Date.now(),
    });

    expect((await personas.load("main", resolvedId))?.identity.displayName).toBe("Kai");
    expect(await corrections.listActive("main", resolvedId)).toHaveLength(1);

    // A lookup with the raw sender id misses both.
    expect(await personas.load("main", senderId)).toBeUndefined();
    expect(await corrections.listActive("main", senderId)).toHaveLength(0);
  });
});
