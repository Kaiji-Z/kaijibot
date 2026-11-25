import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultPersona } from "../../cognitive/persona/store.js";
import { cognitiveHandlers, cognitiveTaskHandlers } from "./cognitive.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

type Reply = { ok: boolean; payload?: unknown; error?: { code?: string; message?: string } };
type Handler = (opts: GatewayRequestHandlerOptions) => unknown;

async function call(handler: Handler, method: string, params: Record<string, unknown>) {
  let reply: Reply | undefined;
  const respond = (ok: boolean, payload?: unknown, error?: Reply["error"]) => {
    reply = { ok, payload, error };
  };
  await handler({
    req: { type: "req", id: "req-1", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {} as never,
  } as GatewayRequestHandlerOptions);
  return reply ?? { ok: false, error: { message: "handler did not respond" } };
}

// Every handler that turns agentId / userId into a store path segment.
const traversalCases: Array<[string, Handler, Record<string, unknown>]> = [
  [
    "cognitive.persona.list",
    cognitiveHandlers["cognitive.persona.list"],
    { agentId: "../../outside" },
  ],
  [
    "cognitive.persona.detail",
    cognitiveHandlers["cognitive.persona.detail"],
    { agentId: "main", userId: "../../outside/secret" },
  ],
  [
    "cognitive.insights.list",
    cognitiveHandlers["cognitive.insights.list"],
    { agentId: "../../outside", userId: "secret" },
  ],
  [
    "cognitive.insights.feedback",
    cognitiveHandlers["cognitive.insights.feedback"],
    { agentId: "../../outside", userId: "secret", id: "i1", feedback: "positive" },
  ],
  [
    "cognitive.evolution.list",
    cognitiveHandlers["cognitive.evolution.list"],
    { agentId: "../../outside", userId: "secret" },
  ],
  [
    "cognitive.corrections.list",
    cognitiveHandlers["cognitive.corrections.list"],
    { agentId: "../../outside", userId: "secret" },
  ],
  [
    "cognitive.corrections.users",
    cognitiveHandlers["cognitive.corrections.users"],
    { agentId: "../../outside" },
  ],
  ["tasks.list", cognitiveTaskHandlers["tasks.list"], { agentId: "../../outside" }],
  ["tasks.get", cognitiveTaskHandlers["tasks.get"], { userId: "../outside/secret", taskId: "t1" }],
];

describe("cognitive RPC store targets", () => {
  let root = "";
  let outsideDir = "";
  let configDir = "";
  let previousStateDir: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kaijibot-cognitive-rpc-"));
    configDir = join(root, "cfg");
    outsideDir = join(root, "outside");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, "secret.json"), '{"not":"a persona"}', "utf-8");
    previousStateDir = process.env.KAIJIBOT_STATE_DIR;
    process.env.KAIJIBOT_STATE_DIR = configDir;
  });

  afterEach(() => {
    if (previousStateDir === undefined) {
      delete process.env.KAIJIBOT_STATE_DIR;
    } else {
      process.env.KAIJIBOT_STATE_DIR = previousStateDir;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it.each(traversalCases)(
    "%s rejects agentId/userId that are not single path segments",
    async (_name, handler, params) => {
      const reply = await call(handler, _name, params);

      expect(reply.ok).toBe(false);
      expect(reply.error?.code).toBe("INVALID_REQUEST");
      // tasks.get also answers INVALID_REQUEST for an unknown task; the target must be
      // what was rejected.
      expect(reply.error?.message).toContain("invalid cognitive store target");
    },
  );

  it("does not list or quarantine files outside the cognitive store", async () => {
    const listReply = await call(
      cognitiveHandlers["cognitive.persona.list"],
      "cognitive.persona.list",
      {
        agentId: "../../outside",
      },
    );
    const detailReply = await call(
      cognitiveHandlers["cognitive.persona.detail"],
      "cognitive.persona.detail",
      { agentId: "main", userId: "../../outside/secret" },
    );

    expect(listReply.ok).toBe(false);
    expect(detailReply.ok).toBe(false);
    // An unloadable persona used to be copied to <file>.invalid.bak before responding.
    expect(readdirSync(outsideDir)).toEqual(["secret.json"]);
  });

  it("rejects missing or empty required targets", async () => {
    for (const params of [{}, { agentId: "main" }, { agentId: "main", userId: "" }]) {
      const reply = await call(
        cognitiveHandlers["cognitive.persona.detail"],
        "cognitive.persona.detail",
        params,
      );
      expect(reply.ok).toBe(false);
      expect(reply.error?.code).toBe("INVALID_REQUEST");
    }
  });

  it("still serves ids that are ordinary path segments", async () => {
    const persona = createDefaultPersona();
    persona.identity.displayName = "Kai";
    const personaDir = join(configDir, "cognitive", "persona", "main");
    mkdirSync(personaDir, { recursive: true });
    writeFileSync(join(personaDir, "wxid_a1@example.com.json"), JSON.stringify(persona), "utf-8");

    const listReply = await call(
      cognitiveHandlers["cognitive.persona.list"],
      "cognitive.persona.list",
      { agentId: "main" },
    );
    const detailReply = await call(
      cognitiveHandlers["cognitive.persona.detail"],
      "cognitive.persona.detail",
      { agentId: "main", userId: "wxid_a1@example.com" },
    );

    expect(listReply.ok).toBe(true);
    expect(listReply.payload).toMatchObject({
      agents: [{ agentId: "main", users: [{ userId: "wxid_a1@example.com", displayName: "Kai" }] }],
    });
    expect(detailReply.ok).toBe(true);
    expect(detailReply.payload).toMatchObject({
      identity: { userId: "wxid_a1@example.com", displayName: "Kai" },
    });
  });
});
