import { z } from "zod";
import {
  hasConfiguredSecretInput,
  isSecretRef,
  normalizeResolvedSecretInputString,
  normalizeSecretInputString,
} from "../config/types.secrets.js";
import { resolveSecretInputString } from "../secrets/resolve-secret-input-string.js";
import { normalizeSecretInput } from "../utils/normalize-secret-input.js";
import { buildSecretInputSchema } from "./secret-input-schema.js";

export type { SecretInput } from "../config/types.secrets.js";
export {
  buildSecretInputSchema,
  hasConfiguredSecretInput,
  isSecretRef,
  normalizeResolvedSecretInputString,
  normalizeSecretInput,
  normalizeSecretInputString,
  resolveSecretInputString,
};

/** Optional version of the shared secret-input schema. */
export function buildOptionalSecretInputSchema() {
  return buildSecretInputSchema().optional();
}

/** Array version of the shared secret-input schema. */
export function buildSecretInputArraySchema() {
  return z.array(buildSecretInputSchema());
}
