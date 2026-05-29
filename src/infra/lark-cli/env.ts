export interface LarkCliEnv {
  LARKSUITE_CLI_BRAND?: string;
  LARKSUITE_CLI_STRICT_MODE?: string;
  LARKSUITE_CLI_DEFAULT_AS?: string;
}

/**
 * Build non-credential lark-cli env vars.
 * Credentials are managed exclusively via profiles — never set LARKSUITE_CLI_APP_ID/SECRET
 * because they override --profile and break auth.
 */
export function buildLarkCliEnv(config: { domain?: string }): LarkCliEnv {
  const env: LarkCliEnv = {};

  if (config.domain) {
    env.LARKSUITE_CLI_BRAND = config.domain.includes("feishu") ? "feishu" : "lark";
  }

  env.LARKSUITE_CLI_STRICT_MODE = "bot";
  env.LARKSUITE_CLI_DEFAULT_AS = "bot";

  return env;
}
