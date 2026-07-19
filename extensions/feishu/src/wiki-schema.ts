import { stringEnum } from "kaijibot/plugin-sdk/core";
import { Type, type Static } from "typebox";

export const FeishuWikiSchema = Type.Object({
  action: stringEnum(["spaces", "nodes", "get", "search", "create", "move", "rename"] as const, {
    description:
      "Wiki action: 'spaces' list all, 'nodes' list children of a space, 'get' fetch a wiki node, 'search' query nodes, 'create' a new node, 'move' a node between spaces, 'rename' a node.",
  }),
  space_id: Type.Optional(Type.String({ description: "Knowledge space ID" })),
  parent_node_token: Type.Optional(
    Type.String({ description: "Parent node token (optional, omit for root)" }),
  ),
  token: Type.Optional(Type.String({ description: "Wiki node token (from URL /wiki/XXX)" })),
  query: Type.Optional(Type.String({ description: "Search query (action: 'search')" })),
  title: Type.Optional(Type.String({ description: "Node title (action: 'create' or 'rename')" })),
  obj_type: Type.Optional(
    stringEnum(["docx", "sheet", "bitable"] as const, {
      description: "Object type for 'create' (default: docx)",
    }),
  ),
  node_token: Type.Optional(
    Type.String({ description: "Node token (action: 'move' or 'rename')" }),
  ),
  target_space_id: Type.Optional(
    Type.String({
      description: "Target space ID (action: 'move'; optional, same space if omitted)",
    }),
  ),
  target_parent_token: Type.Optional(
    Type.String({
      description: "Target parent node token (action: 'move'; optional, root if omitted)",
    }),
  ),
});

export type FeishuWikiParams = Static<typeof FeishuWikiSchema>;
