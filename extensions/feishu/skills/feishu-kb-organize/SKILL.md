---
name: feishu-kb-organize
description: |
  Knowledge base smart organization. Scans wiki structure, classifies documents
  by topic, detects duplicates, suggests tag systems, and proposes hierarchy
  optimizations. All write operations require explicit user confirmation.
  Trigger: "整理知识库", "知识库整理", "文档分类", "知识库太乱了", "文档归类",
  "wiki organize", "KB cleanup", "organize docs", "帮我整理一下文档",
  "知识库健康", "文档重复".
---

# feishu-kb-organize

Knowledge base organization assistant. Builds on top of `feishu-kb-health` scan data to produce actionable classification, tagging, deduplication, and hierarchy optimization plans. No write operation executes without user approval.

> **Phase 1 (scan) is strictly READ-ONLY.** Phase 3 (execution) only proceeds after explicit user confirmation of each proposed action.

## Prerequisites

The Feishu app must have the following scopes:

| Scope | Purpose |
|-------|---------|
| `wiki:wiki:readonly` | List spaces, read node tree |
| `drive:drive:readonly` | Query file metadata and view records |

Required tools:

| Tool | Role |
|------|------|
| `feishu_wiki` | Enumerate spaces, walk node tree, move/rename nodes |
| `feishu_drive` | Batch metadata queries, view records |
| `feishu_doc` | Read document content for classification (optional) |
| `feishu_kb_health` | Provides the base scan data (health report) |

If a scope is missing, the scan will fail with a permission error. Guide the user to add the scope in the Feishu Open Platform admin console.

## Workflow

```
User request (space name / "整理知识库")
  --> Phase 1: Scan & Analyze (read-only)
    --> Phase 2: Generate Suggestions
      --> Phase 3: User Confirmation & Execution
        --> Verification (re-run feishu_kb_health)
```

### Phase 1: Scan & Analyze (Read-Only)

#### 1.1 Identify Target Space

Ask the user which knowledge space to organize:

- **Specific space**: User provides a space name or space ID.
- **Health report space**: If the user recently ran `feishu_kb_health`, reuse that report's data.

#### 1.2 Collect Node Tree

Use `feishu_wiki` to walk the full node tree:

```json
{ "action": "nodes", "space_id": "<space_id>" }
```

For each node, collect:

- `node_token` — wiki node identifier
- `obj_token` — real document token
- `obj_type` — document type (docx, doc, sheet, bitable, etc.)
- `title` — node title
- `parent_node_token` — parent for hierarchy reconstruction
- `depth` — nesting level (root = 0)

**Pagination**: Keep fetching until no `page_token` remains. Track parent-child relationships.

#### 1.3 Collect File Metadata

Batch query file metadata to get freshness and editor info:

```json
{
  "action": "metas.batch_query",
  "file_tokens": ["token1", "token2"],
  "file_type": "docx"
}
```

From each result, extract:

- `last_modified_time` — when the document was last edited
- `last_editor` — who last edited it
- `title` — document title

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

#### 1.4 Check View Records (Optional)

For leaf nodes, check recent view activity to gauge relevance:

```json
{ "action": "view_records", "file_token": "<obj_token>", "file_type": "<obj_type>" }
```

#### 1.5 Merge Health Report Data

If a `feishu_kb_health` report exists for the same space, incorporate its findings:

- Stale documents (days since last edit)
- Orphan nodes (no recent views)
- Deep nesting issues
- Type distribution anomalies

Skip this step if no prior health report is available. The organize skill works standalone but produces better suggestions with health data.

#### 1.6 Output Analysis Summary

Present a quick summary before generating suggestions:

```
扫描完成！
空间: {space_name} ({space_id})
总节点: N | 文档: X | 快捷方式: Y
过期文档 (>90天): A | 孤立节点: B | 深层嵌套: C
```

### Phase 2: Generate Suggestions

#### 2.1 Document Classification

Group documents by topic based on title keywords and (if available) document summary.

**Classification strategies** (let the user choose or auto-detect the best fit):

| Strategy | When to use |
|----------|-------------|
| By project | Documents naturally cluster around project names or code names |
| By time | Documents have clear date patterns (meeting notes, weekly reports) |
| By type | Documents fall into clear categories (design docs, specs, minutes) |

**Classification rules**:

- Extract keywords from each document title using Chinese word segmentation and English tokenization.
- Cluster documents with shared keywords into the same category.
- A document belongs to the category with the highest keyword overlap.
- Categories with fewer than 3 documents are flagged as "small groups" and suggested for merging into broader categories.

Output as a classification suggestion table (see Output Format section below).

#### 2.2 Tag System

Propose a tag taxonomy based on document titles and content summaries.

**Tag extraction rules**:

- Extract meaningful nouns and noun phrases from titles (skip common words like "关于", "的", "报告", "文档").
- Normalize synonyms (e.g., "AI" and "人工智能" should map to the same tag).
- Cap at 20 unique tags to keep the system manageable.

**Tag hierarchy**:

- Level 1 (main tag): broad category (e.g., "产品", "技术", "运营").
- Level 2 (sub-tag): specific topic (e.g., "产品/需求评审", "技术/后端", "运营/活动").

Output as a tag suggestion table with document counts per tag.

#### 2.3 Duplicate Document Detection

Find documents that likely overlap in content.

**Detection methods**:

1. **Title similarity**: Normalize titles (remove punctuation, lowercase, remove common suffixes), then compute character-level Jaccard similarity. Flag pairs with similarity > 80%.
2. **Version pattern**: Detect titles matching "X (v2)", "X-副本", "X-copy", "X-final", "X-最终版" patterns. The version with the most recent `last_modified_time` is the candidate for keeping.
3. **Same-type, same-keyword, close timestamps**: Documents of the same `obj_type`, sharing > 50% title keywords, and modified within 7 days of each other.

For each duplicate pair, recommend:

- **Merge**: Keep the newer version, move the older one to an archive section.
- **Keep both**: If titles are similar but topics genuinely differ (rare, verify by reading summaries).

#### 2.4 Hierarchy Optimization

Analyze the node tree for structural issues.

**Issues to detect**:

| Issue | Threshold | Severity |
|-------|-----------|----------|
| Deep nesting | depth > 4 levels | `info` for 5, `warning` for 6+, `critical` for 8+ |
| Wide nodes | > 20 direct children under one parent | `warning` for 21-50, `critical` for > 50 |
| Unbalanced tree | Sibling subtree depth variance > 3 | `info` |
| Flat root | Root has > 15 direct children with no intermediate grouping | `warning` |

**Optimization strategies**:

- For deep nesting: suggest promoting nodes closer to the root or flattening intermediate levels.
- For wide nodes: suggest grouping children by topic into sub-folders.
- For flat roots: suggest creating category folders as first-level children.
- When moving would break existing links, suggest creating shortcuts instead.

### Phase 3: User Confirmation & Execution

#### 3.1 Present Suggestion Report

Show the full report with all four suggestion categories. Each suggestion includes a severity label and a proposed action.

#### 3.2 User Reviews & Selects

The user can:

- Accept individual suggestions
- Accept an entire category (e.g., "apply all duplicate merges")
- Reject suggestions
- Modify a suggestion before accepting

#### 3.3 Execute Confirmed Actions

Only execute actions the user explicitly approved. Available actions:

| Action | Tool | Notes |
|--------|------|-------|
| Move node | `feishu_wiki` `move` | Preserves permissions of the original document |
| Rename node | `feishu_wiki` `rename` | Updates the wiki node title |
| Create shortcut | `feishu_wiki` `create` with `node_type: "shortcut"` | Does not duplicate content |
| Merge (delete older, keep newer) | `feishu_wiki` `move` to archive + manual delete | Delete requires separate confirmation |
| Create category folder | `feishu_wiki` `create` | New empty node as grouping container |

**Batch limit**: Process at most 50 confirmed actions per round. If more remain, pause and ask the user to continue.

#### 3.4 Log All Operations

For each executed action, record:

- Timestamp
- Action type (move / rename / merge / create)
- Target document (node_token, title)
- Result (success / failure, error message if any)

Present the log at the end of the execution phase.

## Output Format

### Classification Suggestion Table

```markdown
## 文档分类建议

| 文档标题 | 当前位置 | 建议分类 | 建议位置 | 理由 |
|----------|----------|----------|----------|------|
| Q2 产品规划 | 根目录 | 产品 | 产品/规划 | 标题含"产品"关键词 |
| 2026-04 周报 | 根目录 | 周报 (按时间) | 周报/2026-Q2 | 标题含日期模式 |
```

### Duplicate Document Table

```markdown
## 重复文档检测

| 文档 A | 文档 B | 相似度 | 建议 | 理由 |
|--------|--------|--------|------|------|
| API 设计文档 | API 设计文档-v2 | 95% | 保留 v2, 归档旧版 | 标题高度相似 |
| 产品需求 | 产品需求(副本) | 100% | 合并, 保留原文 | 副本后缀 |
```

### Tag Suggestion Table

```markdown
## 标签体系建议

| 标签 | 文档数 | 示例文档 |
|------|--------|----------|
| 产品 | 23 | Q2 产品规划, 需求评审记录 |
| 技术/后端 | 15 | API 设计文档, 数据库方案 |
| 会议纪要 | 31 | 0420 产品评审, 0418 技术对齐 |
```

### Hierarchy Optimization Table

```markdown
## 层级优化建议

| 节点路径 | 问题 | 严重度 | 建议 |
|----------|------|--------|------|
| 根目录/A组/子项目1/模块/子模块/文档 | 嵌套过深 (第6级) | warning | 提升到第3级: A组/子项目1/文档 |
| 根目录 | 直接子节点 28 个 | warning | 按主题创建 4-5 个分类文件夹 |
```

## Safety Rules

> **These rules are NON-NEGOTIABLE. Violating them breaks user trust.**

1. **Phase 1 is always read-only.** Never modify, move, rename, or delete any document during the scan phase.
2. **Every write action requires explicit user confirmation.** Show the action, target, and expected effect before executing. Wait for a clear "yes" or equivalent approval.
3. **Deletion requires double confirmation.** When a suggestion involves deleting a document (e.g., merging duplicates), ask the user twice: once in the report and once before executing.
4. **Batch limit: 50 actions per round.** If the user approves more than 50 actions, process the first 50, pause, show results, and ask whether to continue.
5. **Scope boundary**: Only operate on the user-specified space. Never touch documents in other spaces unless the user explicitly asks.
6. **Preserve permissions**: Moving or renaming a node should not alter its existing permission settings. If a move would change access, warn the user.
7. **Rate limit awareness**: Add a small delay between API calls when processing large spaces to avoid hitting Feishu API rate limits.
8. **No auto-execute**: Even if the user says "全部执行", confirm the total number of actions and list the categories before proceeding.

## Execution Notes

- For spaces with > 500 nodes, batch the metadata queries in groups of 10 tokens to avoid timeouts.
- Classification is based on title keywords and optional summaries. It does not read full document content unless the user explicitly requests deeper analysis.
- Shortcut nodes (`node_type: "shortcut"`) are tracked but not followed into their targets for metadata queries.
- If a node's `obj_token` is empty or the metadata query fails, record it as "unresolved" and exclude it from classification rather than failing the entire scan.
- When creating new category folders, use descriptive Chinese titles that match the user's organizational language.
- After execution, suggest running `feishu_kb_health` on the same space to verify improvements.
- The report should be delivered in the user's language. Chinese triggers produce Chinese output; English triggers produce English output.

## Error Handling

| Error | Response |
|-------|----------|
| Space not found | "未找到名为 '{name}' 的知识空间。" List available spaces and ask user to pick. |
| Node tree fetch fails | "获取节点树失败：{error}。" Retry once. If still fails, suggest the user check permissions. |
| Metadata batch query fails | "部分文档元数据获取失败。" Continue with available data. Flag unresolved nodes in the report. |
| Move operation fails | "移动文档 '{title}' 失败：{error}。" Log the failure, skip to next action, report at end. |
| Rename operation fails | "重命名失败：{error}。" Retry once. If still fails, log and continue. |
| Permission denied | "权限不足：需要 {scope} 权限。" Guide user to the Feishu Open Platform admin console. |
| Rate limit hit | "API 调用频率过高，等待 5 秒后重试。" Add exponential backoff (5s, 10s, 20s). |
| User cancels mid-execution | Stop immediately. Report what was completed and what remains. |
