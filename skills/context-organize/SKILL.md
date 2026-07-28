---
name: context-organize
description: "整理和优化 KaijiBot 的上下文 token 预算。展示三层注入（L1 硬编码 / L2 用户文件 / L3 认知数据），让 agent 判断冗余并修改 L2 文件。当用户说'整理上下文'、'上下文太乱了'、'优化上下文'、'精简 prompt'、'AGENTS.md 太长'、'token 太多了'、'organize context'、'trim context' 时使用。即使用户没有明确说'上下文'，只要提到某个 workspace 文件需要精简或优化，也应使用此 skill。"
metadata: { "kaijibot": { "emoji": "🔧", "requires": { "bins": [] }, "install": [] } }
---

# Context Organize

KaijiBot 每个 agent turn 注入三层上下文。随着使用积累，L2 文件膨胀，token 预算被无效内容占据，模型注意力被稀释。这个 skill 让 agent 看到全部注入内容，判断冗余，修改 L2 文件。

**职责边界**：只改 L2 workspace 文件。L1 是硬编码（不改），L3 由 cognitive 系统自管理（consolidation cron 自动清理，不碰）。

## 三步流程

### Step 1: 展示上下文

调用 `context_show` 工具——它会输出当前 agent 的三层注入内容：

- **L1**：系统提示关键段（Capabilities / Safety / Tooling / Messaging 等）
- **L2**：workspace 文件全文（AGENTS.md / SOUL.md / IDENTITY.md / USER.md / TOOLS.md / HEARTBEAT.md），含 token 统计
- **L3**：persona + corrections 的完整内容

MEMORY.md 显示 token 统计但不输出全文（由 consolidation 系统管理）。

### Step 2: 判断冗余

对比三层内容，对 L2 文件的每段内容判断：

1. **模型本来就知道？**（通用工具描述、语言能力、常见编程模式）→ 删
2. **L1 已覆盖？**（安全规则、工具用法、消息路由——你在 L1 里每轮都遵循的指令）→ 删
3. **L3 已固化？**（用户偏好、纠错记录——persona 里已记录的信息）→ 删
4. **驱动特定行为？**（项目命令、平台特性、安全红线、用户习惯）→ 留

不需要额外工具或 LLM 调用——你就是 LLM，你活在 L1 里、每轮看到 L3，你比任何独立 LLM 分析更有上下文优势。

### Step 3: 修改 L2 文件

用 `edit` 工具逐段修改文件，每处展示 before/after 让用户确认。

**不要碰 MEMORY.md**——它由 consolidation 系统（每日 cron + memory-organize skill）管理。你修改 L3 数据也没有意义——persona 和 corrections 有自己的生命周期管理（衰减半衰期、TTL 过期、Jaccard 去重）。

改完后向用户汇报 token 变化。
