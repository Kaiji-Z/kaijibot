---
name: feishu-project-track
description: |
  Project and workflow tracking across Feishu tasks, documents, meetings, and wiki.
  Scans active projects, aggregates progress from multiple sources, identifies blockers,
  and generates status reports. All write operations require explicit user confirmation.
  Trigger: "项目进度", "追踪项目", "项目状态", "工作进展", "看看项目", "track project",
  "project status", "进度汇报", "项目跟踪", "周报", "项目报告".
---

# feishu-project-track

Project and workflow tracking across Feishu tasks, documents, meetings, and wiki. Scans active projects from multiple data sources, aggregates progress metrics, identifies blockers, and generates structured status reports.

> **Phase 1 (discovery & scan) is strictly READ-ONLY.** Phase 3 (ongoing monitoring) only proceeds after explicit user confirmation.

## Prerequisites

The Feishu app must have the following scopes:

| Scope | Purpose |
|-------|---------|
| `task:task:read` | Read task lists and tasks |
| `wiki:wiki:readonly` | Read wiki nodes and spaces |
| `drive:drive:readonly` | Query file metadata |
| `vc:meeting:readonly` | Search meeting records |

If a scope is missing, the scan will fail with a permission error. Guide the user to add the scope in the Feishu Open Platform admin console.

Required tools:

| Tool | Role |
|------|------|
| `feishu_task` | List/create/update tasks, track completion |
| `feishu_vc` | Search meetings, extract notes and decisions |
| `feishu_wiki` | Navigate project wiki structure |
| `feishu_drive` | Query file metadata, view records |
| `feishu_doc` | Read project documents for progress extraction |

## Workflow

```
User request (project name / "项目进度" / "周报")
  --> Phase 1: Discovery & Scan (read-only)
    --> Phase 2: Generate Status Report
      --> Phase 3: Ongoing Monitoring (optional, with user confirmation)
```

### Phase 1: Discovery & Scan (Read-Only)

#### 1.1 Identify Projects

Scan multiple sources to detect active projects:

- **Task lists**: Use `feishu_task` with action `list` to find task lists with project-like names or custom fields.
- **Wiki spaces**: Use `feishu_wiki` with action `spaces` to find knowledge spaces named after projects or teams.
- **Recent meetings**: Use `feishu_vc` with action `search` to find recurring meetings that suggest ongoing projects.

Ask the user to confirm which projects to track. Present detected projects as a numbered list:

```
检测到以下活跃项目：
1. 产品重构 (12 个任务, 3 个相关文档, 4 次近期会议)
2. 用户增长 (8 个任务, 5 个相关文档, 2 次近期会议)
3. 技术债清理 (6 个任务, 1 个相关文档)

请选择要追踪的项目（可多选）：
```

If no projects are detected, suggest the user create a project task list first or specify project identifiers manually.

#### 1.2 Collect Project Data from Multiple Sources

For each confirmed project, collect data from all available sources.

**1.2.1 Tasks:**

```json
{ "action": "list", "task_list_id": "<task_list_id>" }
```

Collect for each task:

- `task_id` — unique identifier
- `summary` — task title
- `status` — current status (todo, in_progress, done, cancelled)
- `assignee` — responsible person
- `due` — deadline
- `completed_at` — completion timestamp
- `created_at` — creation timestamp

Filter tasks by project keyword in summary or by task list ID if available.

**1.2.2 Meetings:**

```json
{
  "action": "search",
  "start_time": "<YYYY-MM-DD>",
  "end_time": "<YYYY-MM-DD>",
  "query": "<project_keyword>"
}
```

Collect for each meeting:

- `meeting_id` — meeting identifier
- `topic` — meeting subject
- `start_time` / `end_time` — time range
- `participants` — attendee list

Search within a configurable time window (default: last 30 days). Expand to 90 days if initial results are sparse.

**1.2.3 Wiki pages:**

```json
{ "action": "nodes", "space_id": "<space_id>" }
```

For each project-related wiki page, record:

- `node_token` — wiki node identifier
- `title` — page title
- `obj_type` — document type
- `parent_node_token` — hierarchy context

Match wiki pages to projects by title keyword overlap.

**1.2.4 File metadata:**

```json
{
  "action": "metas.batch_query",
  "file_tokens": ["token1", "token2"],
  "file_type": "docx"
}
```

From each result, extract:

- `last_modified_time` — last edit timestamp
- `last_editor` — who last edited
- `title` — document title

Batch queries in groups of 10 tokens. Use file_type mapping:

| obj_type | file_type |
|----------|-----------|
| `docx` | `docx` |
| `doc` | `doc` |
| `sheet` | `sheet` |
| `bitable` | `bitable` |
| `slides` | `slides` |
| `file` | `file` |
| `mindnote` | `mindnote` |

**1.2.5 Document content (optional):**

```json
{ "action": "read", "doc_token": "<obj_token>" }
```

Read project documents only when the user requests deeper analysis or when title-based classification is insufficient. Extract progress indicators, milestone mentions, and blocker descriptions from document text.

#### 1.3 Aggregate and Analyze

For each project, compute:

| Metric | Calculation |
|--------|-------------|
| Task completion rate | `completed tasks / total tasks * 100%` |
| Overdue tasks | Tasks where `due < now` and `status != done` |
| Average task age | `mean(now - created_at)` for open tasks |
| Meeting frequency | Count of project-related meetings in time window |
| Document freshness | Days since `last_modified_time` on project docs |
| Team activity signals | Unique editors and task assignees in last 14 days |

**Cross-project analysis:**

- Shared team members with overloaded assignments (> 5 open tasks across projects).
- Dependency indicators: tasks in one project blocked by deliverables from another project (detected via title keyword overlap or explicit mention).
- Trending risks: projects with declining completion rates or increasing overdue counts.

#### 1.4 Output Analysis Summary

Present a quick summary before generating the full report:

```
扫描完成！
项目数: N | 总任务: X | 已完成: Y | 逾期: Z
近期会议: M 次 | 活跃文档: K 份 | 参与人员: P 人
```

### Phase 2: Generate Status Report

#### 2.1 Structure the Report

**Executive summary** — overall health assessment:

| Health | Condition |
|--------|-----------|
| Green | All projects on track, overdue < 10%, no critical blockers |
| Yellow | 1-2 projects have issues, overdue 10-25%, minor blockers |
| Red | Multiple projects at risk, overdue > 25%, critical blockers unresolved |

**Per-project breakdown:**

- Progress percentage (completed tasks / total tasks)
- Key milestones achieved (tasks with "milestone" or "key" in summary that are completed)
- Blockers and risks (overdue tasks, stale documents with no recent edits)
- Recent decisions from meetings (extract from meeting notes if available)
- Upcoming deadlines (tasks due within next 14 days)

**Cross-project insights:**

- Shared team members with overloaded assignments
- Dependencies between projects (inferred from task titles and meeting topics)
- Trending risks (projects with worsening metrics)

#### 2.2 Format as a Feishu Document or Direct Message

Deliver the report in the user's language. Chinese triggers produce Chinese output; English triggers produce English output.

If the user requests a persistent report, create a Feishu document:

```json
{
  "action": "create",
  "space_id": "<space_id>",
  "title": "项目状态报告 - <date>",
  "parent_node_token": "<optional_parent>"
}
```

Then write the report content:

```json
{
  "action": "write",
  "doc_token": "<obj_token>",
  "content": "<formatted markdown report>"
}
```

**Report template:**

```markdown
# 项目状态报告

**生成时间**: {timestamp}
**扫描范围**: 最近 {N} 天
**整体健康度**: {Green/Yellow/Red}

---

## 总览

| 项目 | 进度 | 任务 | 逾期 | 健康度 |
|------|------|------|------|--------|
| {Project A} | 75% | 12/16 | 1 | Green |
| {Project B} | 40% | 4/10 | 3 | Yellow |

## {Project A}

**进度**: 75% (12/16 任务完成)
**最近更新**: {last_modified_time}
**下次截止**: {nearest_due_task}

### 已完成里程碑
- {milestone 1}
- {milestone 2}

### 当前阻塞
- {blocker 1} (负责人: {assignee}, 截止: {due})
- {blocker 2}

### 近期会议决策
- {meeting date}: {decision extracted from notes}

## 跨项目分析

### 人员负载
| 成员 | 负责任务数 | 涉及项目 | 状态 |
|------|-----------|----------|------|
| {User A} | 8 | Project A, B | 过载 |

### 项目间依赖
- {Project B} 依赖 {Project A} 的 {deliverable}，预计影响时间线。
```

Before writing to a document, always show the preview to the user and wait for confirmation.

### Phase 3: Ongoing Monitoring (Optional, With User Confirmation)

#### 3.1 Set Up Tracking

All setup actions require explicit user approval. Ask before each step.

**Create a project dashboard document in wiki:**

```json
{
  "action": "create",
  "space_id": "<space_id>",
  "title": "项目仪表盘",
  "parent_node_token": "<optional_parent>"
}
```

Write a dashboard template that can be refreshed on subsequent runs.

**Schedule periodic scans:**

Suggest using a cron job or scheduled task to run the scan at regular intervals:

- Weekly report (recommended for most teams)
- Daily standup summary (for active sprints)
- Bi-weekly executive summary (for leadership updates)

Record the schedule preference and remind the user when the next scan is due.

**Configure notification preferences:**

Ask the user how they want to receive updates:

- Feishu message notification (via `feishu_im`)
- Wiki document update
- Both

#### 3.2 Alert Rules

Define alert conditions that trigger proactive notifications:

| Alert | Condition | Severity |
|-------|-----------|----------|
| Task overdue | Task past due date and not completed | `warning` |
| Milestone completed | Key task marked as done | `info` |
| Risk escalation | Overdue count increases by > 50% between scans | `critical` |
| Stale project | No task updates or document edits in 14 days | `info` |
| Team overload | Assignee has > 5 open overdue tasks | `warning` |

Alerts are delivered as Feishu messages to the configured recipient. Each alert includes:

- Project name and affected task/document
- Current status and expected status
- Suggested action
- Link to the relevant Feishu resource

**Alert delivery requires user confirmation for the first occurrence.** After the user acknowledges an alert type, subsequent alerts of the same type for the same project can be sent automatically.

## Safety Rules

> **These rules are NON-NEGOTIABLE. Violating them breaks user trust.**

1. **Phase 1 is always read-only.** Never create, modify, or delete any task, document, or wiki node during the scan phase.
2. **Every write action requires explicit user confirmation.** This includes creating reports, creating tasks, and sending notifications. Show the action, target, and expected effect before executing. Wait for a clear "yes" or equivalent approval.
3. **Never auto-create tasks or modify documents without asking.** Even in Phase 3, alert rules only trigger notifications after the user has confirmed the alert type.
4. **Never expose sensitive project data in logs.** Project names, task details, and assignee information should only appear in the report delivered to the user, not in debug or system logs.
5. **Rate limit API calls.** Maximum 10 API calls per phase. Batch queries where possible. Add a small delay between sequential calls to avoid hitting Feishu rate limits.
6. **Scope boundary.** Only access tasks, documents, and meetings the Feishu app has permission to read. If a source returns a permission error, skip it and note the gap in the report.
7. **Data freshness disclaimer.** The report reflects data at scan time. Always include the scan timestamp. Do not claim the data is real-time.

## Execution Notes

- For projects with > 50 tasks, paginate through task lists until all pages are collected.
- Meeting search is bounded by a time window. Default: last 30 days. The user can override this.
- Document content reading (Phase 1.2.5) is optional and should only be used when the user explicitly requests deeper analysis. It is expensive in API calls.
- Wiki page matching to projects uses title keyword overlap. If the matching is ambiguous, ask the user to confirm rather than guessing.
- Cross-project dependency detection is heuristic-based. Always present dependencies as "possible dependencies" and ask the user to verify.
- The report should be delivered in the user's language. Chinese triggers produce Chinese output; English triggers produce English output.
- When creating a dashboard document in Phase 3, use the project names as section headers so the document is easy to navigate.
- After Phase 3 setup, suggest running a test scan to verify the configuration before relying on automated monitoring.

## Error Handling

| Error | Response |
|-------|----------|
| Permission denied | "权限不足：需要 {scope} 权限。" Guide user to the Feishu Open Platform admin console to add the missing scope. |
| Task list not found | "未找到任务清单 '{name}'。" List available task lists and ask the user to specify the correct one. |
| No projects detected | "未检测到活跃项目。建议先在飞书任务中创建项目任务清单，或在知识库中建立项目文档。" Offer to help create initial project structure. |
| Rate limited | "API 调用频率过高，等待 5 秒后重试。" Add exponential backoff (5s, 10s, 20s). |
| Meeting search returns no results | "未找到相关会议记录。" Suggest broadening the time range or using different keywords. |
| Wiki space not accessible | "无法访问知识空间 '{name}'。" List accessible spaces and ask the user to pick an alternative. |
| Metadata batch query partially fails | "部分文档元数据获取失败。" Continue with available data. Flag unresolved documents in the report. |
| Document write fails | "写入文档失败：{error}。" Retry once. If still fails, deliver the report as a direct message instead. |
| Cross-project analysis yields no insights | Skip the cross-project section. Report only per-project breakdowns. |

## Example Interaction

**User:** 帮我看看项目进度

**Agent flow:**
1. `feishu_task { action: "list" }` — discover task lists, find project-related ones
2. `feishu_wiki { action: "spaces" }` — find project wiki spaces
3. `feishu_vc { action: "search", start_time: "2026-03-21", end_time: "2026-04-20" }` — recent meetings
4. Present detected projects: "产品重构" (12 tasks), "用户增长" (8 tasks)
5. User confirms both projects
6. `feishu_task { action: "list", task_list_id: "tl_xxx" }` — fetch tasks for each project
7. `feishu_drive { action: "metas.batch_query", file_tokens: [...], file_type: "docx" }` — get doc metadata
8. Aggregate: "产品重构" at 75%, "用户增长" at 40%
9. Generate status report with executive summary, per-project breakdown, cross-project insights
10. User requests persistent report
11. `feishu_wiki { action: "create", space_id: "xxx", title: "项目状态报告 - 2026-04-20" }`
12. Show preview, user confirms
13. `feishu_doc { action: "write", doc_token: "xxx", content: "..." }`
14. Offer to set up weekly monitoring (Phase 3)
