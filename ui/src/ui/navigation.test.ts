import { describe, expect, it } from "vitest";
import {
  iconForTab,
  inferBasePathFromPathname,
  normalizeBasePath,
  normalizePath,
  pathForTab,
  subtitleForTab,
  tabFromPath,
  titleForTab,
  TABS,
  type Tab,
} from "./navigation.ts";

describe("iconForTab", () => {
  it("returns a non-empty string for every tab", () => {
    for (const tab of TABS) {
      const icon = iconForTab(tab);
      expect(icon).toBeTruthy();
      expect(typeof icon).toBe("string");
      expect(icon.length).toBeGreaterThan(0);
    }
  });

  it("returns stable icons for known tabs", () => {
    expect(iconForTab("chat")).toBe("messageSquare");
    expect(iconForTab("agents")).toBe("brain");
    expect(iconForTab("cron")).toBe("fileText");
    expect(iconForTab("settings")).toBe("settings");
  });

  it("returns a fallback icon for unknown tab", () => {
    // TypeScript won't allow this normally, but runtime could receive unexpected values
    const unknownTab = "unknown" as Tab;
    expect(iconForTab(unknownTab)).toBe("folder");
  });
});

describe("titleForTab", () => {
  it("returns a non-empty string for every tab", () => {
    for (const tab of TABS) {
      const title = titleForTab(tab);
      expect(title).toBeTruthy();
      expect(typeof title).toBe("string");
    }
  });
});

describe("subtitleForTab", () => {
  it("returns a string for every tab", () => {
    for (const tab of TABS) {
      const subtitle = subtitleForTab(tab);
      expect(typeof subtitle).toBe("string");
    }
  });
});

describe("normalizeBasePath", () => {
  it("returns empty string for falsy input", () => {
    expect(normalizeBasePath("")).toBe("");
  });

  it("adds leading slash if missing", () => {
    expect(normalizeBasePath("ui")).toBe("/ui");
  });

  it("removes trailing slash", () => {
    expect(normalizeBasePath("/ui/")).toBe("/ui");
  });

  it("returns empty string for root path", () => {
    expect(normalizeBasePath("/")).toBe("");
  });

  it("handles nested paths", () => {
    expect(normalizeBasePath("/apps/kaijibot")).toBe("/apps/kaijibot");
  });
});

describe("normalizePath", () => {
  it("returns / for falsy input", () => {
    expect(normalizePath("")).toBe("/");
  });

  it("adds leading slash if missing", () => {
    expect(normalizePath("chat")).toBe("/chat");
  });

  it("removes trailing slash except for root", () => {
    expect(normalizePath("/chat/")).toBe("/chat");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("pathForTab", () => {
  it("returns correct path without base", () => {
    expect(pathForTab("chat")).toBe("/chat");
    expect(pathForTab("settings")).toBe("/settings");
  });

  it("prepends base path", () => {
    expect(pathForTab("chat", "/ui")).toBe("/ui/chat");
    expect(pathForTab("agents", "/apps/kaijibot")).toBe("/apps/kaijibot/agents");
  });
});

describe("tabFromPath", () => {
  it("returns tab for valid path", () => {
    expect(tabFromPath("/chat")).toBe("chat");
    expect(tabFromPath("/agents")).toBe("agents");
    expect(tabFromPath("/cron")).toBe("cron");
    expect(tabFromPath("/settings")).toBe("settings");
  });

  it("returns chat for root path", () => {
    expect(tabFromPath("/")).toBe("chat");
  });

  it("handles base paths", () => {
    expect(tabFromPath("/ui/chat", "/ui")).toBe("chat");
    expect(tabFromPath("/apps/kaijibot/agents", "/apps/kaijibot")).toBe("agents");
  });

  it("returns null for unknown path", () => {
    expect(tabFromPath("/unknown")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(tabFromPath("/CHAT")).toBe("chat");
    expect(tabFromPath("/Settings")).toBe("settings");
  });
});

describe("inferBasePathFromPathname", () => {
  it("returns empty string for root", () => {
    expect(inferBasePathFromPathname("/")).toBe("");
  });

  it("returns empty string for direct tab path", () => {
    expect(inferBasePathFromPathname("/chat")).toBe("");
    expect(inferBasePathFromPathname("/settings")).toBe("");
  });

  it("infers base path from nested paths", () => {
    expect(inferBasePathFromPathname("/ui/chat")).toBe("/ui");
    expect(inferBasePathFromPathname("/apps/kaijibot/agents")).toBe("/apps/kaijibot");
  });

  it("handles index.html suffix", () => {
    expect(inferBasePathFromPathname("/index.html")).toBe("");
    expect(inferBasePathFromPathname("/ui/index.html")).toBe("/ui");
  });
});
