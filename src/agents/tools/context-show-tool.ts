import { Type } from "typebox";
import type { KaijiBotConfig } from "../../config/config.js";
import { resolveBootstrapContextForRun } from "../../agents/bootstrap-files.js";
import type { AnyAgentTool } from "./common.js";
import { textResult } from "./common.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("context-show-tool");

const ContextShowSchema = Type.Object({}, { description: "No parameters needed." });

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? filePath;
}

export function createContextShowTool(deps: {
  config?: KaijiBotConfig;
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
      "输出当前 agent 的三层注入上下文快照：L1 系统提示完整全文 + L2 workspace 文件内容 + L3 persona/corrections 数据。纯数据展示，不含整理指导。",
    parameters: ContextShowSchema,
    async execute(_toolCallId: string) {
      try {
        const workspaceDir = deps.workspaceDir;
        if (!workspaceDir) {
          return textResult("No workspace directory available.", { status: "no_workspace" });
        }

        const parts: string[] = [];
        const agentId = deps.agentId ?? "main";

        parts.push("=== L1: 系统提示硬编码段（不可修改）===");
        parts.push("来源: system-prompt.ts → buildAgentSystemPrompt()");
        parts.push("包含: Identity / Capabilities / Safety / Tooling / Messaging / Silent Replies / Context Layer Priority");
        parts.push("说明: 开发者硬编码在代码里的指令，agent 每轮都遵循。用于和 L2 对比识别冗余。");
        parts.push("");
        try {
          const { buildAgentSystemPrompt } = await import("../system-prompt.js");
          const l1Text = buildAgentSystemPrompt({
            workspaceDir,
            toolNames: [],
            contextFiles: [],
          });
          const l1Tokens = approxTokens(l1Text);
          parts.push(`(~${l1Tokens} tokens)`);
          parts.push(l1Text);
        } catch (err) {
          parts.push(`(failed to build L1: ${String(err)})`);
        }
        parts.push("");

        parts.push("=== L2: workspace 文件（agent 实际看到的版本）===");
        parts.push("来源: workspace 目录 → resolveBootstrapContextForRun()");
        parts.push("处理: soul preset 覆盖 → sanitize → hooks → maxChars 截断");
        parts.push("说明: 经过处理管线后的内容，可能和磁盘原始文件不一致。");
        parts.push("");

        const soulPresetActive = (() => {
          try {
            const { resolveSessionAgentIds } = require("../../routing/session-key.js");
            const { resolveAgentConfig } = require("../agent-scope.js");
            const { sessionAgentId } = resolveSessionAgentIds({
              config: deps.config,
              agentId,
              sessionKey: deps.sessionKey,
            });
            const resolved = resolveAgentConfig(deps.config, sessionAgentId);
            return Boolean(resolved?.soul?.preset);
          } catch {
            return false;
          }
        })();

        let l2TotalTokens = 0;
        let l2FileCount = 0;
        try {
          const { contextFiles } = await resolveBootstrapContextForRun({
            workspaceDir,
            config: deps.config,
            sessionKey: deps.sessionKey,
            agentId,
          });

          for (const cf of contextFiles) {
            const name = basename(cf.path);
            if (name === "MEMORY.md") continue;
            const tokens = approxTokens(cf.content);
            l2TotalTokens += tokens;
            l2FileCount++;
            const presetWarning =
              name === "SOUL.md" && soulPresetActive
                ? " [⚠️ soul preset 覆盖中，编辑文件不会生效。如需修改人格，先移除 soul preset 配置]"
                : "";
            parts.push(`--- ${name} (${cf.content.length} chars / ~${tokens} tok)${presetWarning} ---`);
            parts.push(cf.content);
            parts.push("");
          }
        } catch (err) {
          parts.push(`(failed to resolve bootstrap context: ${String(err)})`);
        }
        parts.push(`L2 合计: ~${l2TotalTokens} tokens (${l2FileCount} files)`);
        parts.push("");

        parts.push("=== L3: 认知数据（cognitive 系统自管理，不可手动修改）===");
        parts.push("来源: PersonaStore + CorrectionStore → buildCognitiveModePrompt() 格式化后注入");
        parts.push("处理: persona 全量特征 + corrections 按 Jaccard 相关性筛选（每轮不同）+ 信任阶段建议");
        parts.push("说明: 由 cognitive 系统自动维护（对话中提取、每日 consolidation、衰减半衰期）。");
        parts.push("用途: 用于和 L2 对比——如果 L2 里有和 L3 重复的用户画像或纠错信息，就是冗余。");
        parts.push("");
        const { resolveConfigDir } = await import("../../utils.js");
        const configDir = resolveConfigDir();

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

        parts.push("--- Skill Evolution Section ---");
        parts.push('Injected when cognitive.evolution.enabled: "## Skill Evolution — 当看到 [Evolution Signal]..."');
        parts.push("");

        parts.push("--- Current Mode ---");
        parts.push("Classified each turn by mode-router (task/insight/hybrid). Changes per message.");

        const output = parts.join("\n");
        log.info("context shown", { agentId, l2Files: l2FileCount, l2Tokens: l2TotalTokens });

        return textResult(output, { status: "ok", l2Tokens: l2TotalTokens });
      } catch (err) {
        return textResult(`Context show failed: ${String(err)}`, { status: "error" });
      }
    },
  };
}
