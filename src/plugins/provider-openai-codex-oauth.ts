import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

/**
 * pi-ai 1.6 removed the public `loginOpenAICodex` API, so the interactive Codex
 * OAuth device flow is unavailable in this build. The function keeps its shape
 * so the provider onboarding wiring stays intact and fails with a clear error.
 */
export async function loginOpenAICodexOAuth(params: {
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
  isRemote: boolean;
  openUrl: (url: string) => Promise<void>;
  localBrowserMessage?: string;
}): Promise<OAuthCredentials | null> {
  void params;
  throw new Error(
    "OpenAI Codex OAuth login is unavailable: pi-ai 1.6 removed the public loginOpenAICodex API. Authenticate by pasting credentials from an existing Codex CLI login instead.",
  );
}
