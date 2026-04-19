import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderAgents, type AgentsProps } from "./agents.ts";

function createSkill() {
  return {
    name: "Repo Skill",
    description: "Skill description",
    source: "workspace",
    filePath: "/tmp/skill",
    baseDir: "/tmp",
    skillKey: "repo-skill",
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    requirements: {
      bins: [],
      env: [],
      config: [],
      os: [],
    },
    missing: {
      bins: [],
      env: [],
      config: [],
      os: [],
    },
    configChecks: [],
    install: [],
  };
}

function createProps(overrides: Partial<AgentsProps> = {}): AgentsProps {
  return {
    basePath: "",
    loading: false,
    error: null,
    agentsList: {
      defaultId: "alpha",
      mainKey: "main",
      scope: "workspace",
      agents: [{ id: "alpha", name: "Alpha" } as never, { id: "beta", name: "Beta" } as never],
    },
    selectedAgentId: "beta",
    activePanel: "overview",
    config: {
      form: null,
      loading: false,
      saving: false,
      dirty: false,
    },
    channels: {
      snapshot: null,
      loading: false,
      error: null,
      lastSuccess: null,
    },
    cron: {
      status: null,
      jobs: [],
      loading: false,
      error: null,
    },
    agentFiles: {
      list: null,
      loading: false,
      error: null,
      active: null,
      contents: {},
      drafts: {},
      saving: false,
    },
    agentIdentityLoading: false,
    agentIdentityError: null,
    agentIdentityById: {},
    agentSkills: {
      report: null,
      loading: false,
      error: null,
      agentId: null,
      filter: "",
    },
    toolsCatalog: {
      loading: false,
      error: null,
      result: null,
    },
    toolsEffective: {
      loading: false,
      error: null,
      result: null,
    },
    runtimeSessionKey: "main",
    runtimeSessionMatchesSelectedAgent: false,
    modelCatalog: [],
    onRefresh: () => undefined,
    onSelectAgent: () => undefined,
    onSelectPanel: () => undefined,
    onLoadFiles: () => undefined,
    onSelectFile: () => undefined,
    onFileDraftChange: () => undefined,
    onFileReset: () => undefined,
    onFileSave: () => undefined,
    onToolsProfileChange: () => undefined,
    onToolsOverridesChange: () => undefined,
    onConfigReload: () => undefined,
    onConfigSave: () => undefined,
    onModelChange: () => undefined,
    onModelFallbacksChange: () => undefined,
    onCronRefresh: () => undefined,
    onCronRunNow: () => undefined,
    onSetDefault: () => undefined,
    ...overrides,
  };
}

describe("renderAgents", () => {
  it("renders agent cards for each agent", async () => {
    const container = document.createElement("div");
    render(renderAgents(createProps()), container);
    await Promise.resolve();

    const cards = container.querySelectorAll<HTMLButtonElement>(".agent-card");
    expect(cards.length).toBe(2);
  });

  it("marks the selected agent card as selected", async () => {
    const container = document.createElement("div");
    render(renderAgents(createProps({ selectedAgentId: "beta" })), container);
    await Promise.resolve();

    const selected = container.querySelector(".agent-card--selected");
    expect(selected).not.toBeNull();
  });

  it("shows default badge on the default agent card", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({ selectedAgentId: "alpha" }),
      ),
      container,
    );
    await Promise.resolve();

    const badge = container.querySelector(".agent-card__badge");
    expect(badge?.textContent?.trim()).toBe("default");
  });

  it("shows skills count in detail stats when report matches selected agent", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          agentSkills: {
            report: {
              workspaceDir: "/tmp/workspace",
              managedSkillsDir: "/tmp/skills",
              skills: [createSkill()],
            },
            loading: false,
            error: null,
            agentId: "beta",
            filter: "",
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const stats = Array.from(container.querySelectorAll<HTMLSpanElement>(".agent-detail-stat"));
    const skillsStat = stats.find((stat) =>
      stat.querySelector(".agent-detail-stat__label")?.textContent?.includes("Skills"),
    );
    expect(skillsStat?.querySelector(".agent-detail-stat__value")?.textContent?.trim()).toBe("1");
  });

  it("does not show skills count when report is for a different agent", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          agentSkills: {
            report: {
              workspaceDir: "/tmp/workspace",
              managedSkillsDir: "/tmp/skills",
              skills: [createSkill()],
            },
            loading: false,
            error: null,
            agentId: "alpha",
            filter: "",
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const stats = Array.from(container.querySelectorAll<HTMLSpanElement>(".agent-detail-stat"));
    const skillsStat = stats.find((stat) =>
      stat.querySelector(".agent-detail-stat__label")?.textContent?.includes("Skills"),
    );
    expect(skillsStat?.querySelector(".agent-detail-stat__value")?.textContent?.trim()).toBe("—");
  });

  it("renders detail panel for the selected agent", async () => {
    const container = document.createElement("div");
    render(renderAgents(createProps()), container);
    await Promise.resolve();

    const detail = container.querySelector(".agent-detail-panel");
    expect(detail).not.toBeNull();
  });
});
