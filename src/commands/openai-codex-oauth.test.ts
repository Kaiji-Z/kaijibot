import { describe, expect, it, vi } from "vitest";
import { loginOpenAICodexOAuth } from "../plugins/provider-openai-codex-oauth.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

const UNAVAILABLE_MESSAGE =
  "OpenAI Codex OAuth login is unavailable: pi-ai 1.6 removed the public loginOpenAICodex API. Authenticate by pasting credentials from an existing Codex CLI login instead.";

function createPrompter(): WizardPrompter {
  return {
    note: vi.fn(async () => {}),
    progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
    text: vi.fn(async () => "http://localhost:1455/auth/callback?code=test"),
  } as unknown as WizardPrompter;
}

function createRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    }),
  } as unknown as RuntimeEnv;
}

describe("loginOpenAICodexOAuth (pi-ai 1.6 degradation)", () => {
  it("rejects with the unavailable message in local mode without starting a flow", async () => {
    const prompter = createPrompter();
    const runtime = createRuntime();
    await expect(
      loginOpenAICodexOAuth({ prompter, runtime, isRemote: false, openUrl: async () => {} }),
    ).rejects.toThrow(UNAVAILABLE_MESSAGE);
    expect(prompter.text).not.toHaveBeenCalled();
  });

  it("rejects with the unavailable message in remote mode without prompting for a callback url", async () => {
    const prompter = createPrompter();
    const runtime = createRuntime();
    await expect(
      loginOpenAICodexOAuth({ prompter, runtime, isRemote: true, openUrl: async () => {} }),
    ).rejects.toThrow(UNAVAILABLE_MESSAGE);
    expect(prompter.text).not.toHaveBeenCalled();
  });
});
