---
name: feishu-kb-health
description: |
  Feishu knowledge base health scanner. Analyzes wiki structure to detect
  stale, orphaned, and poorly organized documents. Generates read-only
  health report with actionable suggestions. NEVER modifies content
  without explicit user confirmation.
  Trigger: "知识库健康", "KB扫描", "wiki健康", "文档整理", "文档体检",
  "KB health", "wiki scan", "check wiki", "organize docs", "知识库扫描".
---

# feishu-kb-health

Read-only knowledge base health scanner. Walks the wiki tree, collects metadata, and produces a structured report identifying stale, orphaned, and poorly organized documents.

> **This skill is strictly READ-ONLY.** It never modifies, moves, or deletes any document unless the user explicitly confirms a proposed action.

## Prerequisites

The Feishu app must have the following scopes:

| Scope | Purpose |
|-------|---------|
| `wiki:wiki:readonly` | List spaces, read node tree |
| `drive:drive:readonly` | Query file metadata (last modified, last editor) |

If a scope is missing, the scan will fail with a permission error. Guide the user to add the scope in the Feishu Open Platform admin console.

## Workflow

### Step 1 — Identify Target Space

Ask the user which knowledge space to scan:

- **Specific space**: User provides a space name or space ID.
- **All spaces**: Scan every accessible space (warn: can be slow for large deployments).

### Step 2 — List Knowledge Spaces

Use the internal wiki tool to enumerate spaces:

```json
{ "action": "spaces" }
```

If the user specified a space name, match it against the returned list to find the `space_id`. If ambiguous, show candidates and ask the user to pick.

Alternatively, with `lark-cli`:

```bash
lark-cli wiki spaces list
```

### Step 3 — Walk the Node Tree

For the target space, recursively fetch all nodes:

```json
{ "action": "nodes", "space_id": "<space_id>" }
```

**Pagination**: The API returns paginated results. Keep fetching until no `page_token` remains. Track parent-child relationships to compute nesting depth.

Alternatively:

```bash
lark-cli wiki nodes list --params '{"space_id":"<space_id>","parent_node_token":"<parent>","page_size":50}'
```

For each node, collect:

- `node_token` — wiki node identifier
- `obj_token` — real document token
- `obj_type` — document type (docx, doc, sheet, bitable, slides, file, mindnote)
- `title` — node title
- `depth` — nesting level (root = 0)

### Step 4 — Collect File Metadata

Batch query file metadata to get freshness and editor info.

Collect `obj_token` values grouped by `obj_type` (the `file_type` parameter depends on type). Batch in groups of up to 10 tokens per call.

```json
{
  "action": "metas.batch_query",
  "file_tokens": ["token1", "token2", "..."],
  "file_type": "docx"
}
```

**file_type mapping**:

| obj_type | file_type |
|----------|-----------|
| `docx` | `docx` |
| `doc` | `doc` |
| `sheet` | `sheet` |
| `bitable` | `bitable` |
| `slides` | `slides` |
| `file` | `file` |
| `mindnote` | `mindnote` |

Alternatively:

```bash
lark-cli drive metas.batch_query --data '{"request_docs":[{"doc_type":"docx","doc_token":"<token>"}],"with_url":false}'
```

From each result, extract:

- `last_modified_time` — when the document was last edited
- `last_editor` — who last edited it
- `title` — document title (may differ from wiki node title)

### Step 5 — Check View Records (Optional, for Orphan Detection)

For leaf nodes (no children), check recent view activity:

```json
{ "action": "view_records", "file_token": "<obj_token>", "file_type": "<obj_type>" }
```

Alternatively:

```bash
lark-cli drive file.view_records list --params '{"file_token":"<token>","file_type":"docx"}'
```

If no view records exist or the most recent view is > 180 days ago, flag as a potential orphan.

## Analysis Checks

### 1. Stale Documents

**Condition**: `last_modified_time` is > 90 days ago.

**Severity**:

| Days since last edit | Severity |
|---------------------|----------|
| 90–180 | `low` |
| 180–365 | `medium` |
| > 365 | `high` |

**Suggestion**: "Consider reviewing for relevance. Archive if outdated, or update if still needed."

### 2. Orphan Nodes

**Condition**: Leaf node (no children) AND no view records in the last 180 days.

**Severity**: `medium`

**Suggestion**: "This document has no recent readers. Consider archiving or consolidating into a related parent."

### 3. Deep Nesting

**Condition**: Node depth > 5 levels from root.

**Severity**:

| Depth | Severity |
|-------|----------|
| 6–8 | `low` |
| 9–12 | `medium` |
| > 12 | `high` |

**Suggestion**: "Deeply nested content is hard to discover. Consider flattening the hierarchy or promoting to a higher level."

### 4. Type Distribution

Count each `obj_type` and report as a summary table. Flag anomalies:

- **Shortcuts-heavy** (> 40% shortcuts): "Many nodes are shortcuts. Verify links are not broken."
- **Old doc format** (any `doc` type): "Legacy doc format found. Consider migrating to docx."

### 5. Large Spaces

**Condition**: Space contains > 500 nodes.

**Severity**: `low` (informational)

**Suggestion**: "This space is large. Consider splitting into topic-specific sub-spaces for easier management."

## Report Format

### Header — Summary Statistics

```markdown
# 知识库健康报告 / KB Health Report

**扫描时间**: <timestamp>
**扫描范围**: <space_name> (<space_id>)
**总节点数**: N
**发现问题**: M

| 指标 | 数量 |
|------|------|
| 总节点 | N |
| 文档 (docx/doc) | X |
| 电子表格 (sheet) | Y |
| 多维表格 (bitable) | Z |
| 其他 | W |
| 快捷方式 (shortcut) | S |
| 过期文档 (>90天) | A |
| 孤立节点 | B |
| 深层嵌套 (>5级) | C |
```

### Body — Issues Table (grouped by space)

```markdown
## <Space Name>

| 标题 | 类型 | 问题 | 严重度 | 建议 |
|------|------|------|--------|------|
| <title> | <obj_type> | 过期文档 (XXX天未更新) | high | 建议归档或更新 |
| <title> | <obj_type> | 孤立节点 (180天无访问) | medium | 建议归档或合并 |
| <title> | <obj_type> | 嵌套过深 (第X级) | low | 建议提升层级 |
```

### Footer — Recommendations

```markdown
## 建议 / Recommendations

1. **[高优先级]** X 份文档超过一年未更新，建议逐一审查。
2. **[中优先级]** Y 个孤立节点无近期访问，建议归档或合并。
3. **[低优先级]** Z 个节点嵌套过深，建议重构层级。
4. **[维护]** 考虑为大型空间建立定期审查机制（建议每季度一次）。
```

## Safety Rules

> **These rules are NON-NEGOTIABLE. Violating them breaks user trust.**

1. **NEVER modify, move, or delete any document** without explicit user confirmation.
2. **NEVER automatically archive** documents — only suggest and wait for approval.
3. **Show a preview** of any proposed action (list of affected documents) before executing.
4. **Log all operations** for audit trail. Include: timestamp, action, target document, user who confirmed.
5. **Respect scope boundaries** — only access spaces and documents the Feishu app has permission to read.
6. **Rate limit** — add a small delay between API calls when scanning large spaces to avoid hitting Feishu API rate limits.

## Execution Notes

- For spaces with > 200 nodes, batch the metadata queries to avoid timeouts.
- Shortcut nodes (`node_type: "shortcut"`) should be tracked but NOT followed into their target for metadata queries (use the shortcut's own metadata only).
- If a node's `obj_token` is empty or the metadata query fails, record it as an "unresolved node" and flag in the report rather than failing the entire scan.
- The report should be delivered in the user's language (Chinese triggers if they used Chinese, English triggers if they used English).
