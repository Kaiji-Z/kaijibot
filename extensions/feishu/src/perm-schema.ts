import { stringEnum } from "kaijibot/plugin-sdk/core";
import { Type, type Static } from "typebox";

const TOKEN_TYPES = [
  "doc",
  "docx",
  "sheet",
  "bitable",
  "folder",
  "file",
  "wiki",
  "mindnote",
] as const;
const MEMBER_TYPES = [
  "email",
  "openid",
  "userid",
  "unionid",
  "openchat",
  "opendepartmentid",
] as const;
const PERMISSIONS = ["view", "edit", "full_access"] as const;

export const FeishuPermSchema = Type.Object({
  action: stringEnum(["list", "add", "remove"] as const, {
    description: "Permission action: 'list' current members, 'add' permission, 'remove' member.",
  }),
  token: Type.String({ description: "File token" }),
  type: stringEnum(TOKEN_TYPES, { description: "File type" }),
  member_type: Type.Optional(
    stringEnum(MEMBER_TYPES, {
      description: "Member type (action: 'add', 'remove')",
    }),
  ),
  member_id: Type.Optional(
    Type.String({ description: "Member ID (email, open_id, user_id, etc.)" }),
  ),
  perm: Type.Optional(
    stringEnum(PERMISSIONS, {
      description: "Permission level (action: 'add'): view, edit, full_access",
    }),
  ),
});

export type FeishuPermParams = Static<typeof FeishuPermSchema>;
