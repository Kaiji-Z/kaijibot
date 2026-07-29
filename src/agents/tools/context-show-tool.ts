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
      "输出当前 agent 的三层注入上下文快照：L1 系统提示完整全文 + L2 workspace 文件内容 + L3 persona/corrections 数据。纯数据展示，不含整理指导。",
    parameters: ContextShowSchema,
    async execute(_toolCallId: string) {
      try {
        const workspaceDir = deps.workspaceDir;
        if (!workspaceDir) {
          return textResult("No workspace directory available.", { status: "no_workspace" });
        }

        const parts: string[] = [];

        parts.push("=== L1 System Prompt (hardcoded sections only) ===");
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

        const output = parts.join("\n");
        log.info("context shown", { agentId, l2Files: l2Files.length, l2Tokens: l2TotalTokens });

        return textResult(output, { status: "ok", l2Tokens: l2TotalTokens });
      } catch (err) {
        return textResult(`Context show failed: ${String(err)}`, { status: "error" });
      }
    },
  };
}
