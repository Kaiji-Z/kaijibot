import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonaTree } from "../../cognitive/types.js";
import { createCognitiveFeedbackTool } from "./cognitive-feedback-tool.js";

const mockPersona: PersonaTree = {
  identity: {
    coreTraits: {},
    expertDomains: [],
    interestDomains: [],
    curiosityDomains: [],
  },
  domains: {},
  recentFocus: [],
  activeProjects: [],
  pendingQuestions: [],
  feedbackProfile: {
    topicBandits: {},
    preferredStyle: "observation",
    optimalFrequencyHours: 4,
    lastProactiveAt: 0,
  },
  rapport: {
    trustScore: 0.1,
    totalExchanges: 0,
    avgResponseLength: 0,
    selfDisclosureLevel: 0,
  },
};

function makeUpdatedPersona(overrides?: Partial<PersonaTree["rapport"]>): PersonaTree {
  return {
    ...mockPersona,
    rapport: {
      ...mockPersona.rapport,
      trustScore: 0.35,
      totalExchanges: 1,
      ...overrides,
    },
  };
}

const mockProcessFeedback = vi.fn();
const mockLoad = vi.fn().mockResolvedValue(mockPersona);
const mockSave = vi.fn().mockResolvedValue(undefined);

vi.mock("../../cognitive/feedback/collector.js", () => ({
  processFeedback: (...args: unknown[]) => mockProcessFeedback(...args),
}));

vi.mock("../../cognitive/persona/store.js", () => ({
  PersonaStore: class {
    load = mockLoad;
    save = mockSave;
  },
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    resolveConfigDir: vi.fn().mockReturnValue("/home/test/.kaijibot"),
  };
});

describe("createCognitiveFeedbackTool", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLoad.mockResolvedValue(mockPersona);
    mockSave.mockResolvedValue(undefined);
  });

  it("returns null when cognitive.enabled is false", () => {
    const tool = createCognitiveFeedbackTool({
      config: { cognitive: { enabled: false } } as never,
    });
    expect(tool).toBeNull();
  });

  it("returns a tool when cognitive is enabled or config is absent", () => {
    const tool = createCognitiveFeedbackTool({});
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe("cognitive_feedback");
  });

  describe("execute", () => {
    it("records positive feedback and returns recorded status", async () => {
      const updated = makeUpdatedPersona({ trustScore: 0.45 });
      mockProcessFeedback.mockReturnValue(updated);

      const tool = createCognitiveFeedbackTool({
        sessionKey: "agent:main:user-abc",
      })!;

      const result = await tool.execute("call-1", {
        targetId: "msg-001",
        sentiment: "positive",
        topic: "programming",
      });

      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.status).toBe("recorded");
      expect(payload.sentiment).toBe("positive");
      expect(payload.trustScore).toBe("0.45");
      expect(mockSave).toHaveBeenCalledWith("user-abc", updated);
    });

    it("records negative feedback and updates persona", async () => {
      const updated = makeUpdatedPersona({ trustScore: 0.05 });
      mockProcessFeedback.mockReturnValue(updated);

      const tool = createCognitiveFeedbackTool({
        sessionKey: "agent:main:user-xyz",
      })!;

      const result = await tool.execute("call-2", {
        targetId: "msg-002",
        sentiment: "negative",
        textResponse: "That was not helpful",
      });

      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.status).toBe("recorded");
      expect(payload.sentiment).toBe("negative");
      expect(mockSave).toHaveBeenCalledWith("user-xyz", updated);
    });

    it("returns graceful message when persona not found", async () => {
      mockLoad.mockResolvedValueOnce(undefined);

      const tool = createCognitiveFeedbackTool({
        sessionKey: "agent:main:user-none",
      })!;

      const result = await tool.execute("call-3", {
        targetId: "msg-003",
        sentiment: "neutral",
      });

      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("No user profile found");
    });

    it("returns error message when store.save fails without throwing", async () => {
      mockProcessFeedback.mockReturnValue(makeUpdatedPersona());
      mockSave.mockRejectedValueOnce(new Error("disk full"));

      const tool = createCognitiveFeedbackTool({
        sessionKey: "agent:main:user-err",
      })!;

      const result = await tool.execute("call-4", {
        targetId: "msg-004",
        sentiment: "positive",
      });

      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("Feedback acknowledged but could not persist");
      expect(text).toContain("disk full");
    });
  });
});
