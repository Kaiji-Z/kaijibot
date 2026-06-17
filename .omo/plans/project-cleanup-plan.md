# KaijiBot 项目清理计划

> 来源：Hyperplan 对抗性规划（4 角色 × 3 轮交叉攻击）
> 日期：2026-06-03

## 背景

KaijiBot 从 OpenClaw fork 后，虽品牌重命名完成度 99%，但仍残留 6,404 文件、60 扩展、~118K LOC extensions 代码。经过 4 个专家角色（激进派/保守派/架构师/风险评估师）3 轮互相攻击，收敛到以下可执行计划。

## 共识事实

1. **删除不如排除** — `optionalBundledClusters` 已有机制，排除构建比删除文件更安全（0% vs 5-15% 上游合并冲突）
2. **桶导出非零破坏** — `src/agents/` 重构会破坏 326+ 导入，延后
3. **IDE 扩展深度耦合** — github-copilot 219 核心引用、kilocode 76 引用，不能删但可禁用
4. **"空"模块不空** — tui (10K LOC)、migrator (4.3K LOC)、ui (Docker 耦合)、realtime-\* (plugin-sdk 导出) 都是活代码
5. **open-prose 是真死代码** — 12 LOC，空 register()

---

## Phase 1: Skills 品牌清理 (~30 min) — 零风险

### 1.1 修复 .clawdbot 路径

- **文件**: `skills/gh-issues/SKILL.md`
- **操作**: 9 处 `/data/.clawdbot/` → `~/.kaijibot/`

### 1.2 修复 clawd 路径

- **文件**: `skills/coding-agent/SKILL.md`
- **操作**: `~/clawd` → `~/.kaijibot`

### 1.3 Codex 品牌替换

- **文件**: `skills/skill-creator/SKILL.md`
- **操作**: 57 处 "Codex" → "KaijiBot"

**验证**: `pnpm tsgo` + grep 确认无残留

---

## Phase 2: IDE 扩展默认禁用 (~15 min) — 零风险

### 2.1 设置 enabledByDefault: false

在以下 6 个扩展的 manifest 中添加或修改字段：

- `extensions/opencode/package.json` → `"enabledByDefault": false`
- `extensions/opencode-go/package.json` → `"enabledByDefault": false`
- `extensions/kilocode/package.json` → `"enabledByDefault": false`
- `extensions/open-prose/package.json` → `"enabledByDefault": false`
- `extensions/github-copilot/package.json` → `"enabledByDefault": false`
- `extensions/copilot-proxy/package.json` → `"enabledByDefault": false`

**机制**: `enabledByDefault` 已被 loader → manifest-registry → config-state 完整管线支持，用户仍可手动启用

**验证**: `pnpm tsgo` + `pnpm build`

---

## Phase 3: Provider 可选排除 + 孤立引用清理 (~1 hour) — 低风险

### 3.1 添加 11 个 provider 到可选集群

- **文件**: `scripts/lib/optional-bundled-clusters.mjs`
- **操作**: 在 `optionalBundledClusters` 数组中添加:
  ```
  "arcee", "sglang", "litellm", "open-prose", "copilot-proxy",
  "fireworks", "venice", "vydra", "runway", "chutes", "openshell"
  ```
- **效果**: 这些扩展不再默认构建，但文件保留（上游合并无冲突）
- **运行时**: 动态插件发现扫描不到目录 = 不注册 = 不可用（不崩溃）

### 3.2 清理孤立 SDK 表面

- **删除**: `src/plugin-sdk/copilot-proxy.ts`
- **删除**: `src/plugin-sdk/open-prose.ts`
- **注意**: 删除后检查 `src/plugin-sdk/index.ts` 的 re-export

### 3.3 清理死模型引用

- **文件**: `src/agents/live-model-filter.ts:22`
- **操作**: 移除 `"fireworks/accounts/fireworks/routers/kimi-k2p5-turbo"` 硬编码

### 3.4 清理 onboard 类型

- **文件**: `src/commands/onboard-types.ts:56`
- **操作**: 移除 `arceeaiApiKey?: string` 可选字段

**验证**: `pnpm tsgo` + `pnpm build` + `pnpm test`

---

## 延后项（Phase 2 of product evolution）

| 项目                                                      | 原因                                     | 前置条件             |
| --------------------------------------------------------- | ---------------------------------------- | -------------------- |
| `src/agents/` 桶导出重构                                  | 326+ 导入需迁移                          | 需专门规划           |
| Provider manifest stub 系统                               | 当前插件加载器不兼容                     | 需架构变更           |
| 扩展 tier/category 分类                                   | 字段不存在于 PluginManifest              | 需 SDK 扩展          |
| `bundled-channel-config-metadata.generated.ts` 死频道清理 | 需先修 generator                         | 需定位生成管线       |
| `send-policy.ts` 硬编码 whatsapp/discord 正则             | Feishu-only 下是死分支，风险低但收益也低 | 可随其他改动顺手清理 |

---

## 预期效果

- ~4,265 LOC 无用 provider 代码排除构建
- 6 个 IDE 扩展默认关闭（仍可手动启用）
- 57 个 Codex 引用 + 9 个 .clawdbot 路径清理
- 零合并冲突风险
- 零高风险操作

## 注意事项

- 所有 11 个 provider 在上游 OpenClaw 中也存在，使用可选集群而非删除确保 `git merge openclaw/main` 无冲突
- Chinese-market providers（zai, deepseek, qwen, moonshot, minimax 等）保持构建，不加入可选列表
- 深度耦合 providers（openrouter 39 refs, google 28 refs, mistral 18 refs）保持构建
