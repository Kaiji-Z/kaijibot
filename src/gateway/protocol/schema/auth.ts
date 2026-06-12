import { Type, type Static } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const PROVIDER_ID_PATTERN = "^[a-z][a-z0-9_-]{0,63}$";

export const AuthStoreApiKeyParamsSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1, pattern: PROVIDER_ID_PATTERN }),
    apiKey: NonEmptyString,
    profileId: Type.Optional(NonEmptyString),
    endpoint: Type.Optional(NonEmptyString),
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

export const ProviderAuthOptionSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  hint: Type.Optional(Type.String()),
  kind: Type.String(),
  endpoint: Type.Optional(Type.String()),
});

export const ProviderAuthInfoSchema = Type.Object({
  providerId: Type.String(),
  providerLabel: Type.String(),
  configured: Type.Boolean(),
  authOptions: Type.Array(ProviderAuthOptionSchema),
});

export const AuthListProviderAuthOptionsParamsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export type AuthListProviderAuthOptionsParams = Static<
  typeof AuthListProviderAuthOptionsParamsSchema
>;

export const AuthListProviderAuthOptionsResultSchema = Type.Object(
  {
    providers: Type.Array(ProviderAuthInfoSchema),
  },
  { additionalProperties: false },
);

export type AuthListProviderAuthOptionsResult = Static<
  typeof AuthListProviderAuthOptionsResultSchema
>;
