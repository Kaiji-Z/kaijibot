import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { clearMemoryPluginState, registerMemoryPromptSection } from "../../plugins/memory-state.js";
import {
  applySystemPromptOverrideToSession,
  buildEmbeddedSystemPrompt,
  createSystemPromptOverride,
} from "./system-prompt.js";

type PromptOptions = { forceSystemPrompt?: string };

type MockAgent = {
  _baseSystemPromptOptions?: PromptOptions;
  _runSystemPromptOptions?: PromptOptions;
};

type MockSession = {
  agent: MockAgent;
};

function createMockSession(): { session: MockSession } {
  const session: MockSession = {
    agent: { _baseSystemPromptOptions: {}, _runSystemPromptOptions: {} },
  };
  return { session };
}

function applyAndGetMutableSession(
  prompt: Parameters<typeof applySystemPromptOverrideToSession>[1],
) {
  const { session } = createMockSession();
  applySystemPromptOverrideToSession(session as unknown as AgentSession, prompt);
  return {
    mutable: session,
  };
}

describe("applySystemPromptOverrideToSession", () => {
  it("forces the string override on both base and run prompt options", () => {
    const prompt = "You are a helpful assistant with custom context.";
    const { mutable } = applyAndGetMutableSession(prompt);

    expect(mutable.agent._baseSystemPromptOptions?.forceSystemPrompt).toBe(prompt);
    expect(mutable.agent._runSystemPromptOptions?.forceSystemPrompt).toBe(prompt);
  });

  it("trims whitespace from string overrides", () => {
    const { mutable } = applyAndGetMutableSession("  padded prompt  ");

    expect(mutable.agent._baseSystemPromptOptions?.forceSystemPrompt).toBe("padded prompt");
  });

  it("applies a function override to the session system prompt", () => {
    const override = createSystemPromptOverride("function-based prompt");
    const { mutable } = applyAndGetMutableSession(override);

    expect(mutable.agent._baseSystemPromptOptions?.forceSystemPrompt).toBe("function-based prompt");
  });

  it("tolerates sessions without prompt options (nothing to patch)", () => {
    const session: MockSession = { agent: {} };
    expect(() =>
      applySystemPromptOverrideToSession(session as unknown as AgentSession, "noop prompt"),
    ).not.toThrow();
  });
});

describe("buildEmbeddedSystemPrompt", () => {
  afterEach(() => {
    clearMemoryPluginState();
  });

  it("forwards provider prompt contributions into the embedded prompt", () => {
    const prompt = buildEmbeddedSystemPrompt({
      workspaceDir: "/tmp/kaijibot",
      reasoningTagHint: false,
      runtimeInfo: {
        host: "local",
        os: "darwin",
        arch: "arm64",
        node: process.version,
        model: "gpt-5.4",
        provider: "openai",
      },
      tools: [],
      modelAliasLines: [],
      userTimezone: "UTC",
      promptContribution: {
        stablePrefix: "## Embedded Stable\n\nStable provider guidance.",
      },
    });

    expect(prompt).toContain("## Embedded Stable\n\nStable provider guidance.");
  });

  it("can omit base memory guidance for non-legacy context engines", () => {
    registerMemoryPromptSection(() => ["## Memory Recall", "Use memory carefully.", ""]);

    const prompt = buildEmbeddedSystemPrompt({
      workspaceDir: "/tmp/kaijibot",
      reasoningTagHint: false,
      runtimeInfo: {
        host: "local",
        os: "darwin",
        arch: "arm64",
        node: process.version,
        model: "gpt-5.4",
        provider: "openai",
      },
      tools: [],
      modelAliasLines: [],
      userTimezone: "UTC",
      includeMemorySection: false,
    });

    expect(prompt).not.toContain("## Memory Recall");
  });
});
