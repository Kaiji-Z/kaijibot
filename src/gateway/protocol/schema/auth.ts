import { Type, type Static } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const PROVIDER_ID_PATTERN = "^[a-z][a-z0-9_-]{0,63}$";

export const AuthStoreApiKeyParamsSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1, pattern: PROVIDER_ID_PATTERN }),
    apiKey: NonEmptyString,
    profileId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type AuthStoreApiKeyParams = Static<typeof AuthStoreApiKeyParamsSchema>;

export const AuthStoreApiKeyResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type AuthStoreApiKeyResult = Static<typeof AuthStoreApiKeyResultSchema>;

export const AuthListProviderStatusParamsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export type AuthListProviderStatusParams = Static<typeof AuthListProviderStatusParamsSchema>;

export const AuthListProviderStatusResultSchema = Type.Object(
  {
    providers: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export type AuthListProviderStatusResult = Static<typeof AuthListProviderStatusResultSchema>;
