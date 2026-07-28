import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import type { AnyAgentTool } from "./common.js";
import { textResult } from "./common.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("context-show-tool");

const ContextShowSchema = Type.Object({}, { description: "No parameters needed." });

const BOOTSTRAP_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
] as const;

const PROTECTED_FILES = new Set(["MEMORY.md"]);

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function createContextShowTool(deps: {
  config?: { cognitive?: { enabled?: boolean } };
  workspaceDir?: string;
  sessionKey?: string;
  agentId?: string;
}): AnyAgentTool | null {
  if (deps.config?.cognitive?.enabled === false) {
    return null;
  }

  return {
    name: "context_show",
    label: "Context Show",
    description:
      "整理和优化上下文 token 预算。输出当前 agent 三层注入内容（L1 系统提示全文 + L2 workspace 文件 + L3 persona/corrections），末尾附整理指导。当用户说'整理上下文'、'上下文太乱了'、'优化上下文'、'精简 prompt'、'AGENTS.md 太长'、'SOUL.md 需要精简'、'token 太多了'、'workspace 太大了'、'上下文窗口不够用了'、'organize context'、'optimize context' 时使用。即使用户没有明确说'上下文'，只要提到某个 workspace 文件需要精简、缩短或优化，就应使用此工具。",
    parameters: ContextShowSchema,
    async execute(_toolCallId: string) {
      try {
        const workspaceDir = deps.workspaceDir;
        if (!workspaceDir) {
          return textResult("No workspace directory available.", { status: "no_workspace" });
        }

        const parts: string[] = [];

        parts.push("=== L1 System Prompt (hardcoded, full text) ===");
        try {
          const { buildAgentSystemPrompt } = await import("../system-prompt.js");
          const l1Text = buildAgentSystemPrompt({
            workspaceDir,
            toolNames: [],
          });
          const l1Tokens = approxTokens(l1Text);
          parts.push(`(~${l1Tokens} tokens)`);
          parts.push(l1Text);
        } catch (err) {
          parts.push(`(failed to build L1: ${String(err)})`);
        }
        parts.push("");

        // L2: workspace bootstrap files (excluding MEMORY.md)
        parts.push("=== L2 Workspace Files ===");
        let l2TotalTokens = 0;
        const l2Files: { name: string; content: string; tokens: number }[] = [];

        for (const name of BOOTSTRAP_FILES) {
          try {
            const content = await readFile(join(workspaceDir, name), "utf-8");
            const tokens = approxTokens(content);
            l2Files.push({ name, content, tokens });
            l2TotalTokens += tokens;
          } catch {}
        }

        // Also check MEMORY.md for stats but don't output content
        // Intentionally not shown — mentioning it invites the agent to modify it.

        parts.push(`Total: ~${l2TotalTokens} tokens (${l2Files.length} files)`);
        parts.push("");

        for (const f of l2Files) {
          parts.push(`--- ${f.name} (${f.content.length} chars / ~${f.tokens} tok) ---`);
          parts.push(f.content);
          parts.push("");
        }

        // L3: cognitive data
        parts.push("=== L3 Cognitive Data (dynamic) ===");
        const agentId = deps.agentId ?? "main";
        const { resolveConfigDir } = await import("../../utils.js");
        const configDir = resolveConfigDir();

        // Persona
        try {
          const { resolveCognitiveUserId } = await import("../../cognitive/identity.js");
          const userId = resolveCognitiveUserId(deps.sessionKey) ?? "operator";
          const { PersonaStore } = await import("../../cognitive/persona/store.js");
          const store = new PersonaStore(configDir);
          const persona = await store.load(agentId, userId);
          if (persona) {
            const { buildPersonaContext } = await import("../../cognitive/persona/context-builder.js");
            const personaCtx = buildPersonaContext(persona);
            const domainCount = Object.keys(persona.domains).length;
            const trust = persona.rapport.trustScore;
            parts.push(`--- Persona (${domainCount} domains, trust=${trust.toFixed(2)}, user=${userId}) ---`);
            parts.push(personaCtx || "(empty)");
          } else {
            parts.push("--- Persona ---");
            parts.push("(no persona data)");
          }
        } catch (err) {
          parts.push(`--- Persona ---`);
          parts.push(`(load error: ${String(err)})`);
        }
        parts.push("");

        // Corrections
        try {
          const { CorrectionStore } = await import("../../cognitive/correction/store.js");
          const store = new CorrectionStore(configDir);
          const { resolveCognitiveUserId } = await import("../../cognitive/identity.js");
          const userId = resolveCognitiveUserId(deps.sessionKey);
          if (userId) {
            const corrections = await store.listActive(agentId, userId);
            parts.push(`--- Corrections (${corrections.length} active for user=${userId}) ---`);
            for (const c of corrections) {
              parts.push(
                `  [${c.domain}] trigger: ${c.trigger} | mistake: ${c.mistake} | fix: ${c.correction} | reinforced: ${c.reinforcedCount}`,
              );
            }
            if (corrections.length === 0) {
              parts.push("  (none)");
            }
          } else {
            parts.push("--- Corrections ---");
            parts.push("  (no user session)");
          }
        } catch (err) {
          parts.push("--- Corrections ---");
          parts.push(`(load error: ${String(err)})`);
        }
        parts.push("");

        // Skill Evolution section
        parts.push("--- Skill Evolution Section ---");
        parts.push('Injected when cognitive.evolution.enabled: "## Skill Evolution — 当看到 [Evolution Signal]..."');
        parts.push("");

        // Mode classification
        parts.push("--- Current Mode ---");
        parts.push("Classified each turn by mode-router (task/insight/hybrid). Changes per message.");

        parts.push("");
        parts.push("=== 整理指导 ===");
        parts.push("");
        parts.push("以上是原始数据。接下来由你判断 L2 文件中哪些内容是冗余的，用 edit 工具修改。");
        parts.push("");
        parts.push("判断标准——对 L2 文件每段内容问：");
        parts.push("1. 模型本来就知道？（通用工具描述、语言能力、常见编程模式）→ 删");
        parts.push("2. L1 已覆盖？（安全规则、工具用法、消息路由——在上文 L1 全文里逐字可见）→ 删");
        parts.push("3. L3 已固化？（用户偏好、纠错记录——在上文 persona/corrections 里可见）→ 删");
        parts.push("4. 驱动特定行为？（项目命令、平台特性、安全红线、用户习惯）→ 留");
        parts.push("");
        parts.push("安全原则：");
        parts.push("- 拿不准时保留。删错的代价（丢失行为驱动信息、人格偏移）远大于多留几百 token。");
        parts.push("- SOUL.md 定义人格语气，误删影响所有后续对话，要保守。AGENTS.md 是规则指令，冗余更易识别。USER.md 和 L3 persona 最容易重叠，优先检查。");
        parts.push("- 不修改 MEMORY.md（由 consolidation 系统管理）。不修改 L3 数据（persona/corrections 有自己的生命周期管理）。");
        parts.push("- 如果没发现明显冗余，直接告诉用户'当前上下文已经很精简'，不要强行删减。");
        parts.push("- 每处修改展示 before/after 让用户确认。");
        parts.push("");
        parts.push("改完后汇报：");
        parts.push("```");
        parts.push("## 上下文整理完成");
        parts.push("| 文件 | 修改前 | 修改后 | 变化 |");
        parts.push("| --- | --- | --- | --- |");
        parts.push("| AGENTS.md | 5432 chars | 3200 chars | -41% |");
        parts.push("| L2 总计 | ~1695 tok | ~1100 tok | -35% |");
        parts.push("```");

        const output = parts.join("\n");
        log.info("context shown", { agentId, l2Files: l2Files.length, l2Tokens: l2TotalTokens });

        return textResult(output, { status: "ok", l2Tokens: l2TotalTokens });
      } catch (err) {
        return textResult(`Context show failed: ${String(err)}`, { status: "error" });
      }
    },
  };
}
