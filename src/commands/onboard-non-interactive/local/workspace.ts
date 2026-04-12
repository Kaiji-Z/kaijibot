import type { KaijiBotConfig } from "../../../config/config.js";
import { resolveUserPath } from "../../../utils.js";
import type { OnboardOptions } from "../../onboard-types.js";

export function resolveNonInteractiveWorkspaceDir(params: {
  opts: OnboardOptions;
  baseConfig: KaijiBotConfig;
  defaultWorkspaceDir: string;
}) {
  const raw = (
    params.opts.workspace ??
    params.baseConfig.agents?.defaults?.workspace ??
    params.defaultWorkspaceDir
  ).trim();
  return resolveUserPath(raw);
}
