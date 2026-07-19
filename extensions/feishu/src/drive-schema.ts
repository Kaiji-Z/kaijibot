import { stringEnum } from "kaijibot/plugin-sdk/core";
import { Type, type Static } from "typebox";

const FILE_TYPES = [
  "doc",
  "docx",
  "sheet",
  "bitable",
  "folder",
  "file",
  "mindnote",
  "shortcut",
] as const;
const QUERY_FILE_TYPES = ["doc", "docx", "sheet", "bitable", "file", "slides"] as const;

export const FeishuDriveSchema = Type.Object({
  action: stringEnum(
    [
      "metas_batch_query",
      "view_records",
      "list",
      "info",
      "create_folder",
      "move",
      "delete",
      "list_comments",
      "list_comment_replies",
      "add_comment",
      "reply_comment",
    ] as const,
    {
      description:
        "Drive action: query file metadata, list/view files & records, create folder, move/delete files, manage comments (list/reply/add).",
    },
  ),
  file_tokens: Type.Optional(
    Type.Array(Type.String({ description: "File tokens to query" }), {
      description: "Array of file tokens (action: 'metas_batch_query')",
    }),
  ),
  file_token: Type.Optional(Type.String({ description: "File or folder token" })),
  file_type: Type.Optional(
    stringEnum(QUERY_FILE_TYPES, {
      description: "Document type. Defaults vary by action (doc/docx).",
    }),
  ),
  type: Type.Optional(
    stringEnum(FILE_TYPES, {
      description: "File type (action: 'info', 'move', 'delete')",
    }),
  ),
  folder_token: Type.Optional(
    Type.String({
      description: "Folder token (action: 'list' for parent, 'create_folder'/'move' for target)",
    }),
  ),
  name: Type.Optional(Type.String({ description: "Folder name (action: 'create_folder')" })),
  page_size: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Page size" })),
  page_token: Type.Optional(Type.String({ description: "Page token for pagination" })),
  comment_id: Type.Optional(Type.String({ description: "Comment id" })),
  content: Type.Optional(Type.String({ description: "Comment or reply text content" })),
  block_id: Type.Optional(
    Type.String({
      description:
        "Optional docx block id for a local comment. Omit to create a full-document comment.",
    }),
  ),
});

export type FeishuDriveParams = Static<typeof FeishuDriveSchema>;
