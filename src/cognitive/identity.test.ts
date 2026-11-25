import { describe, it, expect } from "vitest";
import {
  OPERATOR_USER_ID,
  resolveCognitiveUserId,
  resolveOperatorSenderId,
  stripCognitiveThreadScope,
} from "./identity.js";

describe("resolveOperatorSenderId", () => {
  it("maps Control UI client id to operator", () => {
    expect(resolveOperatorSenderId("kaijibot-control-ui")).toBe(OPERATOR_USER_ID);
  });

  it("maps TUI client id to operator", () => {
    expect(resolveOperatorSenderId("kaijibot-tui")).toBe(OPERATOR_USER_ID);
  });

  it("maps macOS app client id to operator", () => {
    expect(resolveOperatorSenderId("kaijibot-macos")).toBe(OPERATOR_USER_ID);
  });

  it("maps iOS app client id to operator", () => {
    expect(resolveOperatorSenderId("kaijibot-ios")).toBe(OPERATOR_USER_ID);
  });

  it("maps Android app client id to operator", () => {
    expect(resolveOperatorSenderId("kaijibot-android")).toBe(OPERATOR_USER_ID);
  });

  it("returns undefined for feishu user id", () => {
    expect(resolveOperatorSenderId("ou_abc123")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(resolveOperatorSenderId(undefined)).toBeUndefined();
  });

  it("returns undefined for null input", () => {
    expect(resolveOperatorSenderId(null)).toBeUndefined();
  });

  it("returns undefined for 'main'", () => {
    expect(resolveOperatorSenderId("main")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(resolveOperatorSenderId("")).toBeUndefined();
  });

  it("exports OPERATOR_USER_ID as 'operator'", () => {
    expect(OPERATOR_USER_ID).toBe("operator");
  });
});

describe("resolveCognitiveUserId", () => {
  it("resolves operator from main session key (S1)", () => {
    expect(resolveCognitiveUserId("agent:main:main")).toBe("operator");
  });

  it("resolves operator from multi-agent main session key", () => {
    expect(resolveCognitiveUserId("agent:beta:main")).toBe("operator");
  });

  it("resolves ou_xxx from feishu DM session key (S2)", () => {
    expect(resolveCognitiveUserId("agent:main:feishu:direct:ou_alice")).toBe("ou_alice");
  });

  it("resolves wx_xxx from wechat DM session key — channel-agnostic (S3)", () => {
    expect(resolveCognitiveUserId("agent:main:wechat:direct:wx_bob")).toBe("wx_bob");
  });

  it("returns null for group session without sender (S4)", () => {
    expect(resolveCognitiveUserId("agent:main:feishu:group:oc_xyz")).toBeNull();
  });

  it("resolves sender from group session with :sender: suffix (S5)", () => {
    expect(resolveCognitiveUserId("agent:main:feishu:group:oc_xyz:sender:ou_bob777")).toBe(
      "ou_bob777",
    );
  });

  it("maps operator clientId via senderId (S6)", () => {
    expect(resolveCognitiveUserId(undefined, "kaijibot-control-ui")).toBe("operator");
  });

  it("passes through non-operator senderId (S7)", () => {
    expect(resolveCognitiveUserId(undefined, "ou_abc")).toBe("ou_abc");
  });

  it("senderId takes priority over sessionKey", () => {
    expect(resolveCognitiveUserId("agent:main:main", "ou_feishu_user")).toBe("ou_feishu_user");
  });

  it("returns null for both undefined", () => {
    expect(resolveCognitiveUserId()).toBeNull();
  });

  it("returns null for empty sessionKey", () => {
    expect(resolveCognitiveUserId("")).toBeNull();
  });

  it("resolves per-peer DM without channel prefix", () => {
    expect(resolveCognitiveUserId("agent:main:direct:ou_perpeer")).toBe("ou_perpeer");
  });

  it("returns null for cron session key", () => {
    expect(
      resolveCognitiveUserId("agent:main:cron:0ca024e4-7440-4e71-a499-86b69fa6c0fb"),
    ).toBeNull();
  });

  it("returns null for heartbeat session key", () => {
    expect(resolveCognitiveUserId("agent:main:feishu:direct:ou_xxx:heartbeat")).toBeNull();
  });

  it("returns null for subagent session key", () => {
    expect(resolveCognitiveUserId("agent:main:subagent:task-123")).toBeNull();
  });

  it("resolves the person, not the topic, from a DM topic session key", () => {
    expect(resolveCognitiveUserId("agent:main:feishu:direct:ou_alice:topic:omt_topic1")).toBe(
      "ou_alice",
    );
  });

  it("resolves the person from a DM session key with a thread suffix", () => {
    expect(resolveCognitiveUserId("agent:main:feishu:direct:ou_alice:thread:omt_topic1")).toBe(
      "ou_alice",
    );
  });

  it("prefers the :sender: segment over a thread scope that follows it", () => {
    expect(
      resolveCognitiveUserId(
        "agent:main:feishu:direct:ou_alice:sender:ou_bob777:thread:omt_topic1",
      ),
    ).toBe("ou_bob777");
  });

  it("resolves the sender from a group topic session", () => {
    expect(
      resolveCognitiveUserId("agent:main:feishu:group:oc_xyz:topic:omt_topic1:sender:ou_bob777"),
    ).toBe("ou_bob777");
  });

  it("returns null for a group topic session without a sender", () => {
    expect(resolveCognitiveUserId("agent:main:feishu:group:oc_xyz:topic:omt_topic1")).toBeNull();
  });
});

describe("stripCognitiveThreadScope", () => {
  it("drops a topic or thread scope and everything after it", () => {
    expect(stripCognitiveThreadScope("agent:main:feishu:direct:ou_alice:topic:omt_topic1")).toBe(
      "agent:main:feishu:direct:ou_alice",
    );
    expect(
      stripCognitiveThreadScope("agent:main:feishu:group:oc_xyz:topic:omt_topic1:sender:ou_bob777"),
    ).toBe("agent:main:feishu:group:oc_xyz");
  });

  it("returns a key without a thread scope unchanged", () => {
    expect(stripCognitiveThreadScope("agent:main:feishu:group:oc_xyz:sender:ou_bob777")).toBe(
      "agent:main:feishu:group:oc_xyz:sender:ou_bob777",
    );
    expect(stripCognitiveThreadScope("agent:topic:main")).toBe("agent:topic:main");
  });
});
