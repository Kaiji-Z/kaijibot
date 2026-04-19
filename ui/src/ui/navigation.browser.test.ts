import { describe, expect, it } from "vitest";
import "../test-helpers/load-styles.ts";
import { mountApp as mountTestApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

function mountApp(pathname: string) {
  return mountTestApp(pathname);
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function findConfirmButton(app: ReturnType<typeof mountApp>) {
  return Array.from(app.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "Confirm",
  );
}

async function confirmPendingGatewayChange(app: ReturnType<typeof mountApp>) {
  const confirmButton = findConfirmButton(app);
  expect(confirmButton).not.toBeUndefined();
  confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await app.updateComplete;
}

function expectConfirmedGatewayChange(app: ReturnType<typeof mountApp>) {
  expect(app.settings.gatewayUrl).toBe("wss://other-gateway.example/kaijibot");
  expect(app.settings.token).toBe("abc123");
  expect(window.location.search).toBe("");
  expect(window.location.hash).toBe("");
}

describe("control UI routing", () => {
  it("hydrates the tab from the location", async () => {
    const app = mountApp("/agents");
    await app.updateComplete;

    expect(app.tab).toBe("agents");
    expect(window.location.pathname).toBe("/agents");
  });

  it("respects /ui base paths", async () => {
    const app = mountApp("/ui/cron");
    await app.updateComplete;

    expect(app.basePath).toBe("/ui");
    expect(app.tab).toBe("cron");
    expect(window.location.pathname).toBe("/ui/cron");
  });

  it("infers nested base paths", async () => {
    const app = mountApp("/apps/kaijibot/cron");
    await app.updateComplete;

    expect(app.basePath).toBe("/apps/kaijibot");
    expect(app.tab).toBe("cron");
    expect(window.location.pathname).toBe("/apps/kaijibot/cron");
  });

  it("honors explicit base path overrides", async () => {
    window.__KAIJIBOT_CONTROL_UI_BASE_PATH__ = "/kaijibot";
    const app = mountApp("/kaijibot/sessions");
    await app.updateComplete;

    expect(app.basePath).toBe("/kaijibot");
    expect(app.tab).toBe("sessions");
    expect(window.location.pathname).toBe("/kaijibot/sessions");
  });

  it("updates the URL when clicking nav items", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>('a.nav-item[href="/channels"]');
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("channels");
    expect(window.location.pathname).toBe("/channels");
  });

  it("renders the settings view on the /settings route", async () => {
    const app = mountApp("/settings");
    app.requestUpdate();
    await app.updateComplete;

    expect(app.tab).toBe("settings");
  });

  it("renders the refreshed top navigation shell", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(app.querySelector(".topnav-shell")).not.toBeNull();
    expect(app.querySelector(".topnav-shell__content")).not.toBeNull();
    expect(app.querySelector(".topnav-shell__actions")).not.toBeNull();
    expect(app.querySelector(".topnav-shell .brand-title")).toBeNull();
  });

  it("renders the refreshed sidebar shell structure", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(app.querySelector(".sidebar-shell")).not.toBeNull();
    expect(app.querySelector(".sidebar-shell__header")).not.toBeNull();
    expect(app.querySelector(".sidebar-shell__body")).not.toBeNull();
    expect(app.querySelector(".sidebar-shell__footer")).not.toBeNull();
    expect(app.querySelector(".sidebar-brand")).not.toBeNull();
    expect(app.querySelector(".sidebar-brand__logo")).not.toBeNull();
    expect(app.querySelector(".sidebar-brand__copy")).not.toBeNull();
  });

  it("does not render a desktop sidebar resizer or inject a custom nav width", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.applySettings({ ...app.settings, navWidth: 360 });
    await app.updateComplete;

    expect(app.querySelector(".sidebar-resizer")).toBeNull();
    const shell = app.querySelector<HTMLElement>(".shell");
    expect(shell?.style.getPropertyValue("--shell-nav-width")).toBe("");
  });

  it("hides section labels in collapsed mode", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.applySettings({ ...app.settings, navCollapsed: true });
    await app.updateComplete;

    expect(app.querySelector(".nav-section__label")).toBeNull();
    expect(app.querySelector(".sidebar-brand__logo")).toBeNull();
  });

  it("keeps footer utilities available in collapsed mode", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.applySettings({ ...app.settings, navCollapsed: true });
    await app.updateComplete;

    expect(app.querySelector(".sidebar-shell__footer")).not.toBeNull();
    expect(app.querySelector(".sidebar-utility-link")).not.toBeNull();
  });

  it("keeps the collapsed desktop rail compact", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.applySettings({ ...app.settings, navCollapsed: true });
    await app.updateComplete;

    const item = app.querySelector<HTMLElement>(".sidebar .nav-item");
    const header = app.querySelector<HTMLElement>(".sidebar-shell__header");
    const sidebar = app.querySelector<HTMLElement>(".sidebar");
    expect(item).not.toBeNull();
    expect(header).not.toBeNull();
    expect(sidebar).not.toBeNull();
    if (!item || !header || !sidebar) {
      return;
    }

    expect(sidebar.classList.contains("sidebar--collapsed")).toBe(true);
    expect(item.querySelector(".nav-item__icon")).not.toBeNull();
    expect(item.querySelector(".nav-item__text")).toBeNull();
    expect(app.querySelector(".sidebar-brand__copy")).toBeNull();
    expect(header.querySelector(".nav-collapse-toggle")).not.toBeNull();
  });

  it("resets to the main session when opening chat from sidebar navigation", async () => {
    const app = mountApp("/sessions?session=agent:main:subagent:task-123");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>('a.nav-item[href="/chat"]');
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("chat");
    expect(app.sessionKey).toBe("main");
    expect(window.location.pathname).toBe("/chat");
    expect(window.location.search).toBe("?session=main");
  });

  it("keeps chat and nav usable on narrow viewports", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    const split = app.querySelector(".chat-split-container");
    expect(split).not.toBeNull();
    if (split) {
      expect(getComputedStyle(split).position).not.toBe("fixed");
    }

    const chatMain = app.querySelector(".chat-main");
    expect(chatMain).not.toBeNull();
    if (chatMain) {
      expect(getComputedStyle(chatMain).display).not.toBe("none");
    }

    if (split) {
      split.classList.add("chat-split-container--open");
      await app.updateComplete;
      expect(split.classList.contains("chat-split-container--open")).toBe(true);
    }
    if (chatMain) {
      expect(chatMain).not.toBeNull();
    }
  });

  it("stacks the refreshed top navigation for narrow viewports", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    const shell = app.querySelector<HTMLElement>(".topnav-shell");
    const content = app.querySelector<HTMLElement>(".topnav-shell__content");
    expect(shell).not.toBeNull();
    expect(content).not.toBeNull();
    if (!shell || !content) {
      return;
    }

    expect(shell.classList.contains("topnav-shell")).toBe(true);
    expect(content.classList.contains("topnav-shell__content")).toBe(true);
    expect(shell.querySelector(".topbar-nav-toggle")).not.toBeNull();
    expect(shell.children[1]).toBe(content);
    expect(shell.querySelector(".topnav-shell__actions")).not.toBeNull();
  });

  it("keeps the mobile topbar nav toggle visible beside the search row", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    const shell = app.querySelector<HTMLElement>(".topnav-shell");
    const toggle = app.querySelector<HTMLElement>(".topbar-nav-toggle");
    const actions = app.querySelector<HTMLElement>(".topnav-shell__actions");
    expect(shell).not.toBeNull();
    expect(toggle).not.toBeNull();
    expect(actions).not.toBeNull();
    if (!shell || !toggle || !actions) {
      return;
    }

    expect(toggle.classList.contains("topbar-nav-toggle")).toBe(true);
    expect(actions.classList.contains("topnav-shell__actions")).toBe(true);
    expect(shell.firstElementChild).toBe(toggle);
    expect(shell.querySelector(".topbar-nav-toggle")).toBe(toggle);
    expect(actions.querySelector(".topbar-search")).not.toBeNull();
    expect(toggle.getAttribute("aria-label")).toBeTruthy();
  });

  it("opens the mobile sidenav as a drawer from the topbar toggle", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    const toggle = app.querySelector<HTMLButtonElement>(".topbar-nav-toggle");
    const shell = app.querySelector<HTMLElement>(".shell");
    const nav = app.querySelector<HTMLElement>(".shell-nav");
    expect(toggle).not.toBeNull();
    expect(shell).not.toBeNull();
    expect(nav).not.toBeNull();
    if (!toggle || !shell || !nav) {
      return;
    }

    expect(shell.classList.contains("shell--nav-drawer-open")).toBe(false);
    toggle.click();
    await app.updateComplete;

    expect(shell.classList.contains("shell--nav-drawer-open")).toBe(true);
    expect(nav.classList.contains("shell-nav")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes the mobile sidenav drawer after navigation", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    const toggle = app.querySelector<HTMLButtonElement>(".topbar-nav-toggle");
    expect(toggle).not.toBeNull();
    toggle?.click();
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>('a.nav-item[href="/settings"]');
    const shell = app.querySelector<HTMLElement>(".shell");
    expect(link).not.toBeNull();
    expect(shell?.classList.contains("shell--nav-drawer-open")).toBe(true);
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("settings");
    expect(shell?.classList.contains("shell--nav-drawer-open")).toBe(false);
  });

  it("auto-scrolls chat history to the latest message", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    const initialContainer: HTMLElement | null = app.querySelector(".chat-thread");
    expect(initialContainer).not.toBeNull();
    if (!initialContainer) {
      return;
    }
    initialContainer.style.maxHeight = "180px";
    initialContainer.style.overflow = "auto";
    let scrollTop = 0;
    Object.defineProperty(initialContainer, "clientHeight", {
      configurable: true,
      get: () => 180,
    });
    Object.defineProperty(initialContainer, "scrollHeight", {
      configurable: true,
      get: () => 2400,
    });
    Object.defineProperty(initialContainer, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    initialContainer.scrollTo = ((options?: ScrollToOptions | number, y?: number) => {
      const top =
        typeof options === "number" ? (y ?? 0) : typeof options?.top === "number" ? options.top : 0;
      scrollTop = Math.max(0, Math.min(top, 2400 - 180));
    }) as typeof initialContainer.scrollTo;

    app.chatMessages = Array.from({ length: 60 }, (_, index) => ({
      role: "assistant",
      content: `Line ${index} - ${"x".repeat(200)}`,
      timestamp: Date.now() + index,
    }));

    await app.updateComplete;
    for (let i = 0; i < 6; i++) {
      await nextFrame();
    }

    const container = app.querySelector(".chat-thread");
    expect(container).not.toBeNull();
    if (!container) {
      return;
    }
    let finalScrollTop = 0;
    Object.defineProperty(container, "clientHeight", {
      value: 180,
      configurable: true,
    });
    Object.defineProperty(container, "scrollHeight", {
      value: 960,
      configurable: true,
    });
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      get: () => finalScrollTop,
      set: (value: number) => {
        finalScrollTop = value;
      },
    });
    Object.defineProperty(container, "scrollTo", {
      configurable: true,
      value: ({ top }: { top: number }) => {
        finalScrollTop = top;
      },
    });
    const targetScrollTop = container.scrollHeight;
    expect(targetScrollTop).toBeGreaterThan(container.clientHeight);
    app.chatMessages = [
      ...app.chatMessages,
      {
        role: "assistant",
        content: `Line 60 - ${"x".repeat(200)}`,
        timestamp: Date.now() + 60,
      },
    ];
    await app.updateComplete;
    for (let i = 0; i < 10; i++) {
      if (container.scrollTop === targetScrollTop) {
        break;
      }
      await nextFrame();
    }
    expect(container.scrollTop).toBe(targetScrollTop);
  });

  it("hydrates token from query params and strips them", async () => {
    const app = mountApp("/ui/settings?token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("kaijibot.control.settings.v1") ?? "{}").token).toBe(
      undefined,
    );
    expect(window.location.pathname).toBe("/ui/settings");
    expect(window.location.search).toBe("");
  });

  it("strips password URL params without importing them", async () => {
    const app = mountApp("/ui/settings?password=sekret");
    await app.updateComplete;

    expect(app.password).toBe("");
    expect(window.location.pathname).toBe("/ui/settings");
    expect(window.location.search).toBe("");
  });

  it("hydrates token from URL hash when settings already set", async () => {
    localStorage.setItem(
      "kaijibot.control.settings.v1",
      JSON.stringify({ token: "existing-token", gatewayUrl: "wss://gateway.example/kaijibot" }),
    );
    const app = mountApp("/ui/settings#token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("kaijibot.control.settings.v1") ?? "{}")).toMatchObject({
      gatewayUrl: "wss://gateway.example/kaijibot",
    });
    expect(JSON.parse(localStorage.getItem("kaijibot.control.settings.v1") ?? "{}").token).toBe(
      undefined,
    );
    expect(window.location.pathname).toBe("/ui/settings");
    expect(window.location.hash).toBe("");
  });

  it("hydrates token from URL hash and strips it", async () => {
    const app = mountApp("/ui/settings#token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("kaijibot.control.settings.v1") ?? "{}").token).toBe(
      undefined,
    );
    expect(window.location.pathname).toBe("/ui/settings");
    expect(window.location.hash).toBe("");
  });

  it("clears the current token when the gateway URL changes", async () => {
    const app = mountApp("/ui/settings#token=abc123");
    await app.updateComplete;

    const gatewayUrlInput = app.querySelector<HTMLInputElement>(
      'input[placeholder="ws://100.x.y.z:18789"]',
    );
    expect(gatewayUrlInput).not.toBeNull();
    gatewayUrlInput!.value = "wss://other-gateway.example/kaijibot";
    gatewayUrlInput!.dispatchEvent(new Event("input", { bubbles: true }));
    await app.updateComplete;

    expect(app.settings.gatewayUrl).toBe("wss://other-gateway.example/kaijibot");
    expect(app.settings.token).toBe("");
  });

  it("keeps a hash token pending until the gateway URL change is confirmed", async () => {
    const app = mountApp(
      "/ui/settings?gatewayUrl=wss://other-gateway.example/kaijibot#token=abc123",
    );
    await app.updateComplete;

    expect(app.settings.gatewayUrl).not.toBe("wss://other-gateway.example/kaijibot");
    expect(app.settings.token).toBe("");

    await confirmPendingGatewayChange(app);

    expectConfirmedGatewayChange(app);
  });

  it("keeps a query token pending until the gateway URL change is confirmed", async () => {
    const app = mountApp(
      "/ui/settings?gatewayUrl=wss://other-gateway.example/kaijibot&token=abc123",
    );
    await app.updateComplete;

    expect(app.settings.gatewayUrl).not.toBe("wss://other-gateway.example/kaijibot");
    expect(app.settings.token).toBe("");

    await confirmPendingGatewayChange(app);

    expectConfirmedGatewayChange(app);
  });

  it("restores the token after a same-tab refresh", async () => {
    const first = mountApp("/ui/settings#token=abc123");
    await first.updateComplete;
    first.remove();

    const refreshed = mountApp("/ui/settings");
    await refreshed.updateComplete;

    expect(refreshed.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("kaijibot.control.settings.v1") ?? "{}").token).toBe(
      undefined,
    );
  });
});
