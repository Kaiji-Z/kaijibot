import type { KaijiBotConfig } from "../../config/types.js";

export type DirectoryConfigParams = {
  cfg: KaijiBotConfig;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
};
