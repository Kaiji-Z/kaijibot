export interface FeishuConfig {
  appId?: string;
  appSecret?: string;
  /** "feishu.cn" or "larksuite.com" */
  domain?: string;
}

export interface LarkCliEnv {
  LARKSUITE_CLI_APP_ID?: string;
  LARKSUITE_CLI_APP_SECRET?: string;
  LARKSUITE_CLI_BRAND?: string;
  LARKSUITE_CLI_STRICT_MODE?: string;
  LARKSUITE_CLI_DEFAULT_AS?: string;
}

/**
 * Build lark-cli environment variables from KaijiBot's feishu config.
 * These env vars let lark-cli bypass config file/keychain entirely.
 */
export function buildLarkCliEnv(config: FeishuConfig): LarkCliEnv {
  const env: LarkCliEnv = {};

  if (config.appId) {
    env.LARKSUITE_CLI_APP_ID = config.appId;
  }

  if (config.appSecret) {
    env.LARKSUITE_CLI_APP_SECRET = config.appSecret;
  }

  if (config.domain) {
    env.LARKSUITE_CLI_BRAND = config.domain.includes("feishu") ? "feishu" : "lark";
  }

  // KaijiBot runs as bot — set defaults so lark-cli doesn't prompt interactively
  env.LARKSUITE_CLI_STRICT_MODE = "bot";
  env.LARKSUITE_CLI_DEFAULT_AS = "bot";

  return env;
}
