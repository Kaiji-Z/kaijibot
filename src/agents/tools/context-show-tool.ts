import { Type } from "typebox";
import type { KaijiBotConfig } from "../../config/config.js";
import { resolveBootstrapContextForRun } from "../../agents/bootstrap-files.js";
import type { AnyAgentTool } from "./common.js";
import { textResult } from "./common.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("context-show-tool");

const ContextShowSchema = Type.Object({}, { description: "No parameters needed." });

function approxTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk * 1.5 + other / 4);
}

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? filePath;
}

async function isSoulPresetActive(
  config: KaijiBotConfig | undefined,
  agentId: string,
  sessionKey: string | undefined,
): Promise<boolean> {
  if (!config) return false;
  try {
    const { resolveSessionAgentIds, resolveAgentConfig } = await import("../agent-scope.js");
    const { sessionAgentId } = resolveSessionAgentIds({ config, agentId, sessionKey });
    const resolved = resolveAgentConfig(config, sessionAgentId);
    return Boolean(resolved?.soul?.preset);
  } catch {
    return false;
  }
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
      "输出当前 agent 的三层注入上下文快照：L1 系统提示核心段 + L2 workspace 文件内容 + L3 persona/corrections 数据。纯数据展示，不含整理指导。",
    parameters: ContextShowSchema,
    async execute(_toolCallId: string) {
      try {
        const workspaceDir = deps.workspaceDir;
        if (!workspaceDir) {
          return textResult("No workspace directory available.", { status: "no_workspace" });
        }

        const parts: string[] = [];
        const agentId = deps.agentId ?? "main";
        let totalTokens = 0;

        // ── L1 ──
        parts.push("=== L1: 系统提示硬编码段 ===");
        parts.push("来源: system-prompt.ts → buildAgentSystemPrompt()");
        parts.push("包含: Identity / Capabilities / Safety / Tooling / Messaging / Silent Replies");
        parts.push("注意: 此处展示核心硬编码段。实际系统提示还包含 Runtime（model/provider）、工具列表、skills 列表等动态参数，这些每轮不同，此处省略。");
        parts.push("注意: 末尾的 `--- context-layer: project-doc ---` 是 L2 文件注入位置的占位标记，此处为空（L2 在下方单独展示）。");
        parts.push("");
        let l1Tokens = 0;
        try {
          const { buildAgentSystemPrompt } = await import("../system-prompt.js");
          const l1Text = buildAgentSystemPrompt({
            workspaceDir,
            toolNames: [],
            contextFiles: [],
          });
          l1Tokens = approxTokens(l1Text);
          totalTokens += l1Tokens;
          parts.push(`(~${l1Tokens} tokens)`);
          parts.push(l1Text);
        } catch (err) {
          parts.push(`(failed to build L1: ${String(err)})`);
        }
        parts.push("");

        // ── L2 ──
        parts.push("=== L2: workspace 文件（agent 实际看到的版本）===");
        parts.push(`workspace: ${workspaceDir}`);
        parts.push("来源: resolveBootstrapContextForRun()（与系统提示组装相同的管线）");
        parts.push("处理: 读取 → soul preset 覆盖 → session/contextMode 过滤 → hooks → sanitize → heartbeat 过滤 → maxChars 截断");
        parts.push("说明: 经过完整处理管线，可能和磁盘原始文件不一致。");
        parts.push("");

        const soulPresetActive = await isSoulPresetActive(deps.config, agentId, deps.sessionKey);

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
                ? " [⚠️ soul preset 覆盖中，编辑文件不会生效]"
                : "";
            parts.push(`--- ${name} (${cf.content.length} chars / ~${tokens} tok)${presetWarning} ---`);
            parts.push(cf.content);
            parts.push("");
          }
        } catch (err) {
          parts.push(`(failed to resolve bootstrap context: ${String(err)})`);
        }
        totalTokens += l2TotalTokens;
        parts.push(`L2 合计: ~${l2TotalTokens} tokens (${l2FileCount} files)`);
        parts.push("");

        // ── L3 ──
        parts.push("=== L3: 认知数据 ===");
        parts.push("来源: PersonaStore + CorrectionStore");
        parts.push("说明: 以下展示全量数据。实际注入时 buildCognitiveModePrompt 会做额外处理：");
        parts.push("  - persona 格式化后注入 + Interaction Guidance（信任阶段行为建议）");
        parts.push("  - corrections 按 Jaccard 相关性筛选子集（每轮不同）");
        parts.push("  - Skill Evolution 段 + Current Mode 分类");
        parts.push("  以上动态内容此处不展示。");
        parts.push("");
        const { resolveConfigDir } = await import("../../utils.js");
        const configDir = resolveConfigDir();

        let l3Tokens = 0;

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
            const header = `--- Persona (${domainCount} domains, trust=${trust.toFixed(2)}, user=${userId}) ---`;
            parts.push(header);
            parts.push(personaCtx || "(empty)");
            l3Tokens += approxTokens(header + (personaCtx || ""));
          } else {
            parts.push("--- Persona ---");
            parts.push("(no persona data)");
          }
        } catch (err) {
          parts.push("--- Persona ---");
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
            const lines: string[] = [];
            lines.push(`--- Corrections (${corrections.length} active, 全量) ---`);
            for (const c of corrections) {
              lines.push(
                `  [${c.domain}] trigger: ${c.trigger} | mistake: ${c.mistake} | fix: ${c.correction} | reinforced: ${c.reinforcedCount}`,
              );
            }
            if (corrections.length === 0) {
              lines.push("  (none)");
            }
            const correctionText = lines.join("\n");
            l3Tokens += approxTokens(correctionText);
            parts.push(correctionText);
          } else {
            parts.push("--- Corrections ---");
            parts.push("  (no user session)");
          }
        } catch (err) {
          parts.push("--- Corrections ---");
          parts.push(`(load error: ${String(err)})`);
        }
        parts.push("");

        totalTokens += l3Tokens;
        parts.push(`L3 合计: ~${l3Tokens} tokens`);
        parts.push("");
        parts.push(`=== 总计: L1 ~${l1Tokens} + L2 ~${l2TotalTokens} + L3 ~${l3Tokens} = ~${totalTokens} tokens ===`);

        const output = parts.join("\n");
        log.info("context shown", { agentId, l2Files: l2FileCount, l2Tokens: l2TotalTokens, totalTokens });

        return textResult(output, { status: "ok", l2Tokens: l2TotalTokens });
      } catch (err) {
        return textResult(`Context show failed: ${String(err)}`, { status: "error" });
      }
    },
  };
}
