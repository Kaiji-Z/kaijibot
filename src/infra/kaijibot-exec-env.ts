export const KAIJIBOT_CLI_ENV_VAR = "KAIJIBOT_CLI";
export const KAIJIBOT_CLI_ENV_VALUE = "1";

export function markKaijiBotExecEnv<T extends Record<string, string | undefined>>(env: T): T {
  return {
    ...env,
    [KAIJIBOT_CLI_ENV_VAR]: KAIJIBOT_CLI_ENV_VALUE,
  };
}

export function ensureKaijiBotExecMarkerOnProcess(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  env[KAIJIBOT_CLI_ENV_VAR] = KAIJIBOT_CLI_ENV_VALUE;
  return env;
}
