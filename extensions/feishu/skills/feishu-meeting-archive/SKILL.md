---
name: feishu-meeting-archive
description: |
  Archive meeting minutes to Feishu wiki with structured template.
  Extracts AI summary, decisions, and action items from meeting notes,
  creates a wiki page, and optionally creates follow-up tasks.
  Trigger: "会议归档", "存档会议", "归档纪要", "meeting archive",
  "archive meeting", "保存会议记录", "meeting minutes to wiki".
---

# Feishu Meeting Archive

Archive meeting minutes to a Feishu wiki page with structured formatting. Extracts AI summary, key decisions, and action items from meeting notes, creates a wiki node, writes formatted content, and optionally creates follow-up tasks for each action item.

## Prerequisites

Feishu app requires the following scopes:

| Scope | Purpose |
|-------|---------|
| `vc:meeting.meetingevent:read` | Search meeting records |
| `vc:note:read` | Fetch meeting notes |
| `vc:meeting.search:read` | Search meetings by keyword/time |
| `wiki:space:retrieve` | List wiki spaces |
| `wiki:node:create` | Create wiki nodes |
| `wiki:node:read` | Read wiki node info |
| `task:task:write` | Create follow-up tasks |
| `task:task:read` | Query task details |
| `drive:drive:read` | Read document metadata |

## Workflow

```
User request (topic / date / URL)
  → Step 1: Identify target meeting
    → Step 2: Fetch meeting data (vc +search → +notes → +fetch)
      → Step 3: Select wiki space
        → Step 4: Create wiki node
          → Step 5: Write structured content
            → Step 6: Create follow-up tasks (optional)
              → Step 7: Confirm & notify
```

### Step 1: Identify Target Meeting

Determine which meeting to archive based on user input:

- **Meeting URL**: Extract meeting ID directly from the URL.
- **Topic keyword**: "归档今天下午的产品会议" → search with keyword "产品" + today's date range.
- **Date range**: "归档这周的所有会议" → search all meetings in the week.
- **Vague request**: "帮我归档会议" → ask user to specify topic, date, or URL.

For date-based queries, resolve relative dates to absolute dates using system `date` command (never mental math):

```bash
# Examples
date -d "today" +%Y-%m-%d
date -d "yesterday" +%Y-%m-%d
date -d "last monday" +%Y-%m-%d
```

### Step 2: Fetch Meeting Data

Two paths — try lark-cli first, fallback to manual input.

#### Path A: Automated Fetch (preferred)

**2a. Search meetings:**

```bash
# Read the search reference first for parameter details
# File: references/lark-vc-search.md in lark-vc skill directory
lark-cli vc +search --start "<YYYY-MM-DD>" --end "<YYYY-MM-DD>" --query "<keyword>" --format json --page-size 30
```

- `--start` / `--end`: inclusive date range (both same day for "today").
- `--query`: optional keyword filter for meeting topic.
- `--format json`: structured output for parsing.
- If `page_token` is returned, continue fetching until all pages are collected.
- From results, collect `id` (meeting_id) for the target meeting(s).

**2b. Get meeting notes:**

```bash
# Read the notes reference first for output structure
# File: references/lark-vc-notes.md in lark-vc skill directory
lark-cli vc +notes --meeting-ids "<meeting_id>"
```

This returns:
- `note_doc_token` — AI smart notes (summary + todos + chapters)
- `verbatim_doc_token` — verbatim transcript
- `meeting_notes` — user-attached notes (only via `--calendar-event-ids` path)

**2c. Read note content:**

```bash
# Fetch AI summary, decisions, action items, chapters
lark-cli docs +fetch --doc <note_doc_token>
```

Parse the returned markdown to extract:
- **AI Summary**: Usually at the top of the document.
- **Decisions**: Look for sections containing "决策", "决定", "结论", "决议".
- **Action Items / Todos**: Look for sections with "待办", "TODO", "行动项", "任务". Extract each item with assignee and deadline if available.
- **Key Points / Chapters**: Structured sections from the meeting.

If the note document contains a `<whiteboard>` tag, download the cover image:

```bash
lark-cli docs +media-download --type whiteboard --token <whiteboard_token> --output ./artifact-<meeting-title>/cover
```

**2d. Get meeting details (participants, duration):**

```bash
lark-cli vc meeting get --params '{"meeting_id": "<meeting_id>", "with_participants": true}'
```

#### Path B: Manual Input (fallback)

If automated fetch fails (no notes, API error, permissions):

1. Inform the user: "无法自动获取会议纪要，请粘贴会议摘要或纪要内容。"
2. Accept pasted content and proceed to formatting.
3. Ask for: topic, date, participants, key decisions, action items.

### Step 3: Select Target Wiki Space

**3a. List available spaces:**

```json
{ "action": "spaces" }
```

Use `feishu_wiki` tool to list all accessible wiki spaces.

**3b. Suggest or confirm space:**

- If user specified a space name, find matching `space_id`.
- If meeting topic suggests a team/project, propose the matching space.
- If ambiguous, show the list and ask user to pick.

**3c. Optional — select parent node:**

Ask if the archive page should go under a specific parent node. List nodes if needed:

```json
{ "action": "nodes", "space_id": "<space_id>" }
```

### Step 4: Create Wiki Node

```json
{
  "action": "create",
  "space_id": "<space_id>",
  "title": "会议纪要 - <topic> - <date>",
  "parent_node_token": "<optional_parent>"
}
```

Use `feishu_wiki` tool with `create` action. Default `obj_type` is `docx`.

From the response, capture:
- `node_token` — wiki node token
- `obj_token` — actual document token (use this for writing content)

### Step 5: Write Structured Content

Compose the meeting archive from the template below and write to the wiki node.

**Write using `feishu_doc` tool:**

```json
{
  "action": "write",
  "doc_token": "<obj_token>",
  "content": "<formatted markdown>"
}
```

**Important:** Pass `owner_open_id` context if available so the requesting user gets full access. The `write` action replaces the entire document, so compose the full content before calling.

**Template (adapt fields based on available data):**

```markdown
# 会议纪要：{topic}

**日期**: {date}
**时长**: {duration}
**参会人**: {participants}

---

## 摘要

{AI-generated summary from note_doc_token, or user-provided summary}

## 关键决策

{Extract decisions from meeting notes. Each decision as a bullet point. If no explicit decisions section, extract from context.}

## 待办事项

{List action items extracted from the AI todos section. Format as a checklist or bullet list with assignee and deadline.}

## 详细记录

{Key chapters or section summaries from the meeting. Organize by topic/time if chapters are available.}

## 相关文档

{Links to: original note_doc, verbatim_doc, any referenced docs or materials}
```

**Field extraction rules:**

| Field | Source | Fallback |
|-------|--------|----------|
| `topic` | `meeting.topic` from vc +search | User input |
| `date` | `meeting.start_time` | User input |
| `duration` | Calculate from `start_time` / `end_time` | "未知" |
| `participants` | `vc meeting get --with-participants` | "未获取" |
| `summary` | AI note first section | User-provided |
| `decisions` | Parse note for decision keywords | "无明确决策记录" |
| `action items` | AI note todos section | Ask user |
| `chapters` | AI note chapter sections | "无章节记录" |
| `related docs` | `note_doc_token` + `verbatim_doc_token` URLs | "无" |

**Before writing — show preview:**

Always compose the full content and show it to the user before calling `write`. Say:

> 以下是将写入知识库的会议纪要内容，请确认：
> {preview content}

Wait for user confirmation before proceeding.

### Step 6: Create Follow-up Tasks (Optional)

After the wiki page is created, extract action items and offer to create Feishu tasks.

**Ask user:**

> 检测到 {N} 个待办事项，是否为每个待办创建飞书任务？

If confirmed, create tasks using `feishu_task` tool or lark-cli:

**Using lark-cli (preferred):**

```bash
# Read the task create reference first
# File: references/lark-task-create.md in lark-task skill directory
lark-cli task tasks create --data '{
  "summary": "<action item description>",
  "due": {"time": "<deadline ISO string>"},
  "assignee": {"open_id": "<assignee_open_id>"}
}'
```

**Using feishu tools (if lark-cli unavailable):**

Look for `feishu_task` tool with create action.

**For each action item:**
1. Extract task description, assignee (resolve name to `open_id` if needed), and deadline.
2. If assignee is not specified, default to the requesting user.
3. If deadline is not specified, ask or skip the due date field.
4. Create the task and record the task URL.

**Report results:**

```
✅ 已创建 3 个任务：
  1. [任务名称1] → @负责人1 (截止: 2026-04-25) — https://...
  2. [任务名称2] → @负责人2 (截止: 2026-04-30) — https://...
  ❌ 失败 1 个：
  1. [任务名称3] — 原因: 负责人 open_id 未找到
```

### Step 7: Confirm & Notify

**Summarize the archive result:**

> ✅ 会议纪要已归档完成！
>
> 📄 知识库页面: {wiki_page_url}
> 📝 纪要文档: {note_doc_url}
> 📋 逐字稿: {verbatim_url}
> ✅ 已创建任务: {N} 个
>
> 待办事项已同步到飞书任务，负责人会收到通知。

**Optional notification:** If the user wants to notify other participants, send a message via `feishu_im` tool:

```json
{
  "action": "send",
  "chat_id": "<group_chat_id>",
  "text": "会议纪要已归档到知识库：{wiki_page_url}\n请查看并确认各自的待办事项。"
}
```

Only send notifications when the user explicitly asks or confirms.

## Safety Rules

1. **Preview before write** — Always show the formatted content to the user before creating the wiki page. Never write without confirmation.
2. **Confirm task creation** — Always ask before creating follow-up tasks. List the tasks that will be created and get explicit approval.
3. **Duplicate detection** — Before creating a new wiki node, check if a page with the same title already exists in the target space. If found, ask the user whether to overwrite or create a new page with a different title.
4. **No auto-delete** — Never delete existing wiki content or tasks without explicit user instruction.
5. **Preserve originals** — Always include links to original note_doc and verbatim_doc in the archive. The wiki page is a formatted copy, not a replacement.
6. **Owner access** — When creating documents, always pass `owner_open_id` so the requesting user gets full access.

## Error Handling

| Error | Response |
|-------|----------|
| `vc +search` returns no results | "未找到匹配的会议记录。请确认会议主题或时间范围。" Suggest broadening search or providing meeting URL. |
| `vc +notes` returns no notes | "该会议没有自动生成的纪要。" Switch to Path B (manual input). |
| `docs +fetch` fails on note_doc | "无法读取纪要文档内容。" Try fetching verbatim_doc instead, or ask user to paste. |
| Wiki space not accessible | "无法访问该知识空间。" List available spaces and ask user to pick an alternative. |
| Wiki node creation fails | "创建知识库页面失败：{error}。" Suggest creating a standalone doc instead via `feishu_doc create`. |
| `feishu_doc write` fails | "写入文档内容失败。" Retry once. If still fails, offer to save content as local file. |
| Task creation fails for some items | Report which tasks succeeded and which failed. Continue with remaining tasks. Do not abort all tasks on single failure. |
| Participant name → open_id resolution fails | Use the name as-is in the archive. For task creation, ask user to provide open_id or skip that task. |
| Permission denied on any step | Check required scopes. Suggest user run `lark-cli auth login --domain vc,wiki,task` to re-authorize. |

## Example Interaction

**User:** 帮我归档今天下午的产品会议

**Agent flow:**
1. Resolve "今天下午" → date range: today 12:00 ~ 23:59
2. `vc +search --start 2026-04-20 --end 2026-04-20 --query "产品" --format json`
3. Found meeting: "产品需求评审" (14:00-15:30, meeting_id: om_xxx)
4. `vc +notes --meeting-ids om_xxx` → note_doc_token: docxnxxx
5. `docs +fetch --doc docxnxxx` → extract summary, 3 decisions, 5 action items
6. `vc meeting get --params '{"meeting_id":"om_xxx","with_participants":true}'` → 8 participants
7. `feishu_wiki { action: "spaces" }` → suggest "产品团队知识库"
8. User confirms space → `feishu_wiki { action: "create", space_id: "xxx", title: "会议纪要 - 产品需求评审 - 2026-04-20" }`
9. Compose template with all extracted data → show preview to user
10. User approves → `feishu_doc { action: "write", doc_token: "xxx", content: "..." }`
11. Ask about task creation → user confirms → create 5 tasks
12. Show summary with wiki link, task links, and original doc links
