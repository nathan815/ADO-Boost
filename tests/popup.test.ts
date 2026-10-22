// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionPopup, type PopupDependencies } from "../src/popup/popup";
import { defaultSettings } from "../src/features/registry";
import { recentPrUrl, type RecentPr } from "../src/core/recent-prs";
import popupHtml from "../public/popup.html?raw";

const pr: RecentPr = {
  organization: "org", project: "Project", repository: "Repo", repositoryId: "repo-id",
  pullRequestId: 42, title: "Fix a bug", author: "PR Author", viewedAt: 1_700_000_000_000,
  url: recentPrUrl({ organization: "org", project: "Project", repository: "Repo", pullRequestId: 42 })
};
let popup: ExtensionPopup | undefined;

function setup(overrides: Partial<PopupDependencies> = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  const unsubscribe = vi.fn();
  let onChange!: (area: "history" | "settings") => void;
  const deps = {
    health: vi.fn(async () => ({ connected: true, authenticated: true, login: "reviewer" })),
    list: vi.fn(async () => [pr]),
    reviews: vi.fn(async () => []),
    loadTab: vi.fn(async () => "recent" as const),
    saveTab: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    openSettings: vi.fn(async () => undefined),
    settings: vi.fn(async () => defaultSettings()),
    subscribe: (listener: typeof onChange) => { onChange = listener; return unsubscribe; },
    ...overrides
  };
  popup = new ExtensionPopup(root, deps);
  popup.start();
  return { root: document.body, container: root, deps, unsubscribe, changed: (area: "history" | "settings") => onChange(area) };
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const element = [...root.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === text);
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}

afterEach(() => {
  popup?.destroy();
  popup = undefined;
  document.body.innerHTML = "";
  delete document.documentElement.dataset.theme;
});

describe("extension popup", () => {
  it("filters review tabs, highlights status, and refreshes completion from storage", async () => {
    let reviews = [{ ...pr, reviewStatus: "reviewing" as "reviewing" | "reviewed" }];
    const { root, deps, changed } = setup({ reviews: async () => reviews });
    await vi.waitFor(() => expect(root.querySelector(".pr-review-status")?.textContent).toBe("Reviewing"));
    expect(root.querySelector(".pr-reviewing")).not.toBeNull();
    expect([...root.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["Recently Viewed", "Reviewing", "Reviewed"]);
    button(root, "Reviewing").click();
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Reviewing");
    expect(root.textContent).not.toContain("Clear history");
    await vi.waitFor(() => expect(deps.saveTab).toHaveBeenCalledWith("reviewing"));
    reviews = [{ ...pr, reviewStatus: "reviewed" }];
    changed("history");
    await vi.waitFor(() => expect(root.textContent).toContain("No pull requests being reviewed"));
    button(root, "Reviewed").click();
    expect(root.querySelector(".pr-review-status")?.textContent).toBe("Review complete");
    expect(root.querySelector(".pr-reviewed")).not.toBeNull();
  });

  it("restores the saved tab, supports keyboard navigation, and retains tracked reviews after clearing history", async () => {
    const { root, deps } = setup({
      list: async () => [], reviews: async () => [{ ...pr, reviewStatus: "reviewed" }],
      loadTab: async () => "reviewed"
    });
    await vi.waitFor(() => expect(root.querySelector(".pr-review-status")?.textContent).toBe("Review complete"));
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Reviewed");
    button(root, "Reviewed").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(root.textContent).toContain("No recent pull requests yet");
    expect(document.activeElement?.textContent).toBe("Recently Viewed");
    button(root, "Recently Viewed").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(root.querySelector(".pr-title")?.textContent).toBe(pr.title);
    await vi.waitFor(() => expect(deps.saveTab).toHaveBeenLastCalledWith("reviewed"));
  });

  it("does not replace a user selection with a late saved tab and surfaces save errors", async () => {
    let loaded!: (tab: "reviewed") => void;
    const { root } = setup({
      loadTab: () => new Promise((resolve) => { loaded = resolve; }),
      saveTab: async () => { throw new Error("Cannot save tab"); }
    });
    button(root, "Reviewing").click();
    loaded("reviewed");
    await vi.waitFor(() => expect(root.textContent).toContain("Cannot save tab"));
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Reviewing");
  });

  it("sets stable document width and minimum height before popup JavaScript loads", () => {
    const html = new DOMParser().parseFromString(popupHtml, "text/html");
    const style = document.createElement("style");
    style.textContent = html.querySelector("head style")!.textContent;
    document.head.append(style);
    try {
      expect(getComputedStyle(document.documentElement).width).toBe("420px");
      expect(getComputedStyle(document.documentElement).minWidth).toBe("420px");
      expect(getComputedStyle(document.body).width).toBe("420px");
      expect(getComputedStyle(document.documentElement).minHeight).toBe("420px");
      expect(getComputedStyle(document.body).minHeight).toBe("420px");
      expect(getComputedStyle(document.documentElement).overflow).toBe("hidden");
    } finally {
      style.remove();
    }
  });

  it("uses ADO components and loads history without waiting for companion health", async () => {
    const { root } = setup({ health: () => new Promise(() => undefined) });
    await vi.waitFor(() => expect(root.querySelector(".pr-title")?.textContent).toBe("Fix a bug"));
    expect(root.textContent).toContain("Checking");
    expect(root.querySelector(".bolt-spinner")).not.toBeNull();
    expect(button(root, "Checking").classList.contains("bolt-button")).toBe(true);
    expect(root.querySelector(".popup-header .companion-toggle")).not.toBeNull();
    expect(root.querySelector(".connection")).toBeNull();
    expect(root.querySelector("footer")).toBeNull();
    expect(root.textContent).not.toContain("Latest 100 PRs. Stored only in this browser.");
    const link = root.querySelector<HTMLAnchorElement>(".bolt-link.pr-link")!;
    expect(link.href).toBe(pr.url);
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(root.textContent).toContain("org / Project / Repo");
    expect(root.textContent).toContain("#42");
    expect(root.querySelector(".pr-author")?.textContent).toBe("By PR Author");
    expect(root.querySelector("time")?.dateTime).toBe(new Date(pr.viewedAt).toISOString());
  });

  it("checks automatically and supports refreshing signed-in status", async () => {
    const health = vi.fn<PopupDependencies["health"]>().mockResolvedValueOnce({ connected: true, authenticated: false }).mockResolvedValue({ connected: true, authenticated: true, login: "reviewer" });
    const { root } = setup({ health });
    await vi.waitFor(() => expect(root.textContent).toContain("Needs login"));
    expect(root.querySelector(".companion-username")).toBeNull();
    expect(root.textContent).not.toContain("ado-boost login");
    button(root, "Needs login").click();
    expect(root.textContent).toContain("ado-boost login");
    expect(root.textContent).not.toContain("Checks connection and sign-in only");
    expect(root.textContent).not.toContain("No PR content is sent");
    expect(root.querySelector(".bolt-status")).not.toBeNull();
    button(root, "Refresh").click();
    await vi.waitFor(() => expect(root.textContent).toContain("reviewer"));
    expect(health).toHaveBeenCalledTimes(2);
  });

  it("does not invent a username when authenticated health does not report one", async () => {
    const { root } = setup({ health: async () => ({ connected: true, authenticated: true }) });
    await vi.waitFor(() => expect(root.querySelector(".companion-summary")?.textContent).toBe("Local Copilot"));
    expect(root.querySelector(".companion-username")).toBeNull();
  });

  it.each([[0, "0s"], [59, "59s"], [60, "1m 0s"], [3661, "1h 1m"]])("shows companion diagnostics with %s seconds of uptime", async (uptimeSeconds, uptime) => {
    const { root } = setup({ health: async () => ({
      connected: true, authenticated: true, login: "reviewer", host: "https://github.com",
      companion: { version: "2.3.4", pid: 4321, uptimeSeconds }, cliVersion: "1.2.3", protocolVersion: 1
    }) });
    await vi.waitFor(() => expect(root.querySelector(".companion-username")).not.toBeNull());
    root.querySelector<HTMLButtonElement>(".companion-toggle")!.click();
    const details = [...root.querySelectorAll(".connection-diagnostics > div")].map((row) => [
      row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent
    ]);
    expect(details).toEqual([
      ["Companion version", "2.3.4"], ["Companion PID", "4321"], ["Uptime", uptime], ["Copilot CLI", "1.2.3"], ["GitHub host", "https://github.com"], ["Host protocol", "1"]
    ]);
    expect(root.textContent).toContain("Details reflect the last check");
  });

  it("refreshes process details while signed out and removes stale diagnostics on disconnect", async () => {
    const health = vi.fn<PopupDependencies["health"]>()
      .mockResolvedValueOnce({ connected: true, authenticated: false, companion: { pid: 4321, uptimeSeconds: 10 } })
      .mockResolvedValueOnce({ connected: true, authenticated: false, companion: { pid: 5678, uptimeSeconds: 0 } })
      .mockRejectedValue(new Error("Disconnected"));
    const { root } = setup({ health });
    await vi.waitFor(() => expect(root.textContent).toContain("Needs login"));
    button(root, "Needs login").click();
    expect(root.querySelector(".connection-diagnostics")?.textContent).toContain("4321");
    button(root, "Refresh").click();
    expect(root.querySelector(".connection-diagnostics")).toBeNull();
    await vi.waitFor(() => expect(root.querySelector(".connection-diagnostics")?.textContent).toContain("5678"));
    button(root, "Refresh").click();
    await vi.waitFor(() => expect(root.textContent).toContain("Disconnected"));
    expect(root.querySelector(".connection-diagnostics")).toBeNull();
  });

  it("clears the header username when a later health check fails", async () => {
    const health = vi.fn<PopupDependencies["health"]>()
      .mockResolvedValueOnce({ connected: true, authenticated: true, login: "reviewer" })
      .mockRejectedValue(new Error("Disconnected"));
    const { root } = setup({ health });
    await vi.waitFor(() => expect(root.querySelector(".companion-username")?.textContent).toBe("reviewer"));
    root.querySelector<HTMLButtonElement>(".companion-toggle")!.click();
    button(root, "Refresh").click();
    expect(root.querySelector(".companion-username")).toBeNull();
    await vi.waitFor(() => expect(root.querySelector(".companion-summary")?.textContent).toBe("Unavailable"));
    expect(root.querySelector(".companion-username")).toBeNull();
  });

  it("shows companion errors without hiding history and exposes retry", async () => {
    const health = vi.fn<PopupDependencies["health"]>().mockRejectedValueOnce(new Error("Native host not found")).mockResolvedValue({ connected: true, authenticated: true });
    const { root } = setup({ health });
    await vi.waitFor(() => expect(root.textContent).toContain("Unavailable"));
    expect(root.textContent).not.toContain("Native host not found");
    expect(root.querySelector(".connection")).toBeNull();
    button(root, "Unavailable").click();
    expect(root.textContent).toContain("Native host not found");
    expect(root.textContent).toContain("ado-boost doctor");
    expect(root.textContent).toContain("Fix a bug");
    button(root, "Refresh").click();
    await vi.waitFor(() => expect(root.textContent).not.toContain("Native host not found"));
  });

  it("opens a portaled ADO popover from the compact header and restores focus on Escape", async () => {
    const { root, container, deps } = setup();
    await vi.waitFor(() => expect(root.querySelector(".companion-username")?.textContent).toBe("reviewer"));
    const toggle = root.querySelector<HTMLButtonElement>(".companion-toggle")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Local Copilot: Connected, signed in as reviewer");
    expect(toggle.textContent).toBe("reviewer");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector(`#${toggle.getAttribute("aria-controls")}`)).not.toBeNull();
    expect(root.querySelector(".connection")?.closest(".bolt-portal")).not.toBeNull();
    expect(root.querySelector(".connection")?.closest(".bolt-portal-host.scroll-hidden")).not.toBeNull();
    expect(container.contains(root.querySelector(".connection"))).toBe(false);
    expect(root.querySelector(".popup .connection")).toBeNull();
    expect(root.querySelector('[role="dialog"]')?.getAttribute("aria-labelledby")).toBe(root.querySelector(".connection h2")?.id);
    expect(root.textContent).toContain("Signed in as reviewer");
    expect(root.querySelector(".connection h2")?.textContent).toBe("Local Copilot");
    expect(root.querySelector(".connection-diagnostics")).toBeNull();
    expect(deps.health).toHaveBeenCalledOnce();
    button(root, "Refresh").focus();
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.querySelector(".connection")).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();
    expect(root.querySelector(".connection")).not.toBeNull();
    toggle.click();
    expect(root.querySelector(".connection")).toBeNull();
  });

  it("dismisses the companion popover on an outside click", async () => {
    const { root } = setup();
    await vi.waitFor(() => expect(root.querySelector(".companion-username")?.textContent).toBe("reviewer"));
    const toggle = root.querySelector<HTMLButtonElement>(".companion-toggle")!;
    toggle.click();
    root.querySelector<HTMLElement>(".bolt-light-dismiss")!.click();
    expect(root.querySelector(".connection")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("renders untrusted PR metadata as text, not HTML", async () => {
    const { root } = setup({ list: async () => [{ ...pr, title: '<img src=x onerror="alert(1)">', author: "<script>author</script>", repository: "<script>bad</script>" }] });
    await vi.waitFor(() => expect(root.querySelector(".pr-title")?.textContent).toContain("<img"));
    expect(root.querySelector(".recent-list img")).toBeNull();
    expect(root.querySelector(".recent-list script")).toBeNull();
    expect(root.querySelector(".pr-author")?.textContent).toBe("By <script>author</script>");
  });

  it("keeps legacy entries without authors usable", async () => {
    const legacy = { ...pr };
    delete legacy.author;
    const { root } = setup({ list: async () => [legacy] });
    await vi.waitFor(() => expect(root.querySelector(".pr-title")?.textContent).toBe("Fix a bug"));
    expect(root.querySelector(".pr-author")).toBeNull();
    expect(root.querySelector<HTMLAnchorElement>(".pr-link")?.href).toBe(pr.url);
    expect(root.textContent).not.toContain("undefined");
  });

  it("shows a helpful empty state without an unusable clear action", async () => {
    const { root } = setup({ list: async () => [], health: async () => { throw new Error("Companion unavailable"); } });
    await vi.waitFor(() => expect(root.querySelector(".history-empty")).not.toBeNull());
    expect(root.querySelector(".history-empty h3")?.textContent).toBe("No recent pull requests yet");
    expect(root.querySelector(".history-empty p")?.textContent).toBe("Open a pull request in Azure DevOps. It will appear here for quick access.");
    expect(root.querySelector(".history-empty svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(root.textContent).not.toContain("Clear history");
    expect(root.querySelector("footer")).toBeNull();
  });

  it("does not show an empty state or clear action while history is loading", () => {
    const { root } = setup({ list: () => new Promise(() => undefined) });
    expect(root.querySelector(".history-empty")).toBeNull();
    expect(root.textContent).not.toContain("Clear history");
    expect(root.textContent).toContain("Loading recent PRs");
  });

  it("guides users to settings when empty history is disabled", async () => {
    const settings = defaultSettings();
    settings.masterEnabled = false;
    const { root, deps } = setup({ list: async () => [], settings: async () => settings });
    await vi.waitFor(() => expect(root.querySelector(".history-empty p")?.textContent).toContain("Turn on ADO Boost"));
    expect(root.querySelector(".disabled-note")).toBeNull();
    expect(root.textContent).not.toContain("Open a pull request in Azure DevOps");
    button(root, "Open settings").click();
    expect(deps.openSettings).toHaveBeenCalledOnce();
  });

  it("requires confirmation to clear history and leaves cancellation untouched", async () => {
    const list = vi.fn<PopupDependencies["list"]>().mockResolvedValue([pr]);
    const clear = vi.fn(async () => { list.mockResolvedValue([]); });
    const { root } = setup({ list, clear });
    await vi.waitFor(() => expect(root.querySelector(".pr-title")).not.toBeNull());
    button(root, "Clear history").click();
    expect(root.querySelector('[aria-label="Confirm clearing history"]')).not.toBeNull();
    expect(clear).not.toHaveBeenCalled();
    button(root, "Cancel").click();
    expect(clear).not.toHaveBeenCalled();
    button(root, "Clear history").click();
    button(root, "Confirm clear").click();
    await vi.waitFor(() => expect(root.textContent).toContain("No recent pull requests yet"));
    expect(clear).toHaveBeenCalledOnce();
  });

  it("allows clearing corrupt history, surfaces clear failures, and retries loading", async () => {
    const list = vi.fn<PopupDependencies["list"]>().mockRejectedValueOnce(new Error("Invalid recent PR URL")).mockResolvedValue([]);
    const { root } = setup({ list, clear: async () => { throw new Error("Storage unavailable"); } });
    await vi.waitFor(() => expect(root.textContent).toContain("Invalid recent PR URL"));
    expect(button(root, "Clear history").disabled).toBe(false);
    button(root, "Clear history").click();
    button(root, "Confirm clear").click();
    await vi.waitFor(() => expect(root.textContent).toContain("Storage unavailable"));
    button(root, "Cancel").click();
    button(root, "Retry history").click();
    await vi.waitFor(() => expect(root.textContent).toContain("No recent pull requests yet"));
  });

  it("updates theme, disabled state, and history from storage notifications", async () => {
    const settings = defaultSettings();
    settings.presentation.theme = "dark";
    settings.masterEnabled = false;
    const list = vi.fn<PopupDependencies["list"]>().mockResolvedValueOnce([pr]).mockResolvedValue([]);
    const { root, changed, unsubscribe } = setup({ settings: async () => settings, list });
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(root.textContent).toContain("New visits are not being recorded");
    changed("history");
    await vi.waitFor(() => expect(root.textContent).toContain("No recent pull requests yet"));
    settings.presentation.theme = "light";
    changed("settings");
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    popup?.destroy();
    expect(unsubscribe).toHaveBeenCalledOnce();
    popup = undefined;
  });

  it("opens settings and shows errors instead of silently failing", async () => {
    const openSettings = vi.fn().mockRejectedValue(new Error("Cannot open settings"));
    const { root } = setup({ openSettings });
    const settingsButton = root.querySelector<HTMLButtonElement>('.popup-header button[aria-label="Open settings"]')!;
    expect(settingsButton.querySelector("svg")).not.toBeNull();
    expect(settingsButton.textContent?.trim()).toBe("");
    settingsButton.click();
    await vi.waitFor(() => expect(root.textContent).toContain("Cannot open settings"));
    expect(openSettings).toHaveBeenCalledOnce();
  });
});
