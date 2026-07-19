import { stringEnum } from "kaijibot/plugin-sdk/core";
import { Type, type Static } from "typebox";

export const FeishuDocSchema = Type.Object({
  action: stringEnum(
    [
      "read",
      "write",
      "append",
      "insert",
      "create",
      "list_blocks",
      "get_block",
      "update_block",
      "delete_block",
      "create_table",
      "write_table_cells",
      "create_table_with_values",
      "insert_table_row",
      "insert_table_column",
      "delete_table_rows",
      "delete_table_columns",
      "merge_table_cells",
      "upload_image",
      "upload_file",
      "color_text",
    ] as const,
    {
      description:
        "Document action: read/write/append content, insert blocks, create doc, list/get/update/delete blocks, table operations (create/write/insert/delete/merge), upload image/file, color_text styling.",
    },
  ),
  doc_token: Type.Optional(
    Type.String({ description: "Document token (extract from URL /docx/XXX)" }),
  ),
  content: Type.Optional(
    Type.String({
      description:
        "Markdown content (action: 'write', 'append', 'insert', 'update_block', 'color_text')",
    }),
  ),
  after_block_id: Type.Optional(
    Type.String({ description: "Insert after this block ID (action: 'insert')" }),
  ),
  title: Type.Optional(Type.String({ description: "Document title (action: 'create')" })),
  folder_token: Type.Optional(
    Type.String({ description: "Target folder token (action: 'create')" }),
  ),
  grant_to_requester: Type.Optional(
    Type.Boolean({
      description:
        "Grant edit permission to the trusted requesting Feishu user (action: 'create', default: true).",
    }),
  ),
  block_id: Type.Optional(
    Type.String({
      description: "Block ID (actions: get/update/delete_block, table ops, color_text)",
    }),
  ),
  parent_block_id: Type.Optional(
    Type.String({ description: "Parent block ID (default: document root)" }),
  ),
  row_size: Type.Optional(
    Type.Integer({ description: "Table row count (action: create_table*)", minimum: 1 }),
  ),
  column_size: Type.Optional(
    Type.Integer({ description: "Table column count (action: create_table*)", minimum: 1 }),
  ),
  column_width: Type.Optional(
    Type.Array(Type.Number({ minimum: 1 }), {
      description: "Column widths in px (length should match column_size)",
    }),
  ),
  table_block_id: Type.Optional(
    Type.String({ description: "Table block ID (action: write_table_cells)" }),
  ),
  values: Type.Optional(
    Type.Array(Type.Array(Type.String()), {
      description: "2D matrix values[row][col] to write into table cells",
      minItems: 1,
    }),
  ),
  row_index: Type.Optional(
    Type.Number({ description: "Row index to insert at (-1 for end, default: -1)" }),
  ),
  column_index: Type.Optional(
    Type.Number({ description: "Column index to insert at (-1 for end, default: -1)" }),
  ),
  row_start: Type.Optional(Type.Number({ description: "Start row index (0-based)" })),
  row_end: Type.Optional(Type.Number({ description: "End row index (exclusive)" })),
  row_count: Type.Optional(Type.Number({ description: "Number of rows to delete (default: 1)" })),
  column_start: Type.Optional(Type.Number({ description: "Start column index (0-based)" })),
  column_end: Type.Optional(Type.Number({ description: "End column index (exclusive)" })),
  column_count: Type.Optional(
    Type.Number({ description: "Number of columns to delete (default: 1)" }),
  ),
  url: Type.Optional(
    Type.String({ description: "Remote URL (http/https) for upload_image/upload_file" }),
  ),
  file_path: Type.Optional(
    Type.String({ description: "Local file path for upload_image/upload_file" }),
  ),
  image: Type.Optional(
    Type.String({
      description:
        "Image as data URI (data:image/png;base64,...) or plain base64 string. Use instead of url/file_path.",
    }),
  ),
  filename: Type.Optional(Type.String({ description: "Optional filename override" })),
  index: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Insert position (0-based index among siblings). Omit to append.",
    }),
  ),
});

export type FeishuDocParams = Static<typeof FeishuDocSchema>;
