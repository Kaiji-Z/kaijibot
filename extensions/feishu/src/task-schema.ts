import { stringEnum } from "kaijibot/plugin-sdk/core";
import { Type, type Static } from "typebox";

export const FeishuTaskSchema = Type.Object({
  action: stringEnum(["create", "list", "update"] as const, {
    description: "Task action: create task, list tasks, update task",
  }),
  summary: Type.Optional(Type.String({ description: "Task summary/title (required for create)" })),
  description: Type.Optional(Type.String({ description: "Task description" })),
  due: Type.Optional(Type.String({ description: "Due time in ISO format or unix timestamp (ms)" })),
  assignee: Type.Optional(Type.String({ description: "Assignee open_id" })),
  task_id: Type.Optional(Type.String({ description: "Task ID (required for update)" })),
  status: Type.Optional(
    Type.String({ description: "Task status for update: todo, in_progress, done" }),
  ),
  page_size: Type.Optional(Type.Number({ description: "Page size (1-50, default 20)" })),
  page_token: Type.Optional(Type.String({ description: "Page token for pagination" })),
});

export type FeishuTaskParams = Static<typeof FeishuTaskSchema>;
