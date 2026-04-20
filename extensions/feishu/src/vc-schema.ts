import { Type, type Static } from "@sinclair/typebox";

export const FeishuVcSchema = Type.Object({
  action: Type.Union(
    [Type.Literal("search"), Type.Literal("notes"), Type.Literal("detail")],
    { description: "VC meeting action: search meetings, get meeting notes, get meeting detail" },
  ),
  start_time: Type.Optional(
    Type.String({ description: "Start time in ISO format or unix timestamp (ms) for search" }),
  ),
  end_time: Type.Optional(
    Type.String({ description: "End time in ISO format or unix timestamp (ms) for search" }),
  ),
  query: Type.Optional(Type.String({ description: "Search keyword for meeting topic" })),
  meeting_id: Type.Optional(Type.String({ description: "Meeting ID for notes/detail" })),
  page_size: Type.Optional(Type.Number({ description: "Page size (1-50, default 20)" })),
  page_token: Type.Optional(Type.String({ description: "Page token for pagination" })),
  with_participants: Type.Optional(
    Type.Boolean({ description: "Include participants in detail (default false)" }),
  ),
});

export type FeishuVcParams = Static<typeof FeishuVcSchema>;
