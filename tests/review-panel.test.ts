// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AdoApi } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import { RuntimeCopilotGateway } from "../src/core/copilot-gateway";
import type { PullRequestAnalysis } from "../src/core/types";
import { RuntimeWriteGateway } from "../src/core/write-gateway";
import { defaultSettings } from "../src/features/registry";
import { MemorySettingsStorage, SettingsService } from "../src/features/settings-service";
import { ReviewPanel } from "../src/ui/review-panel";

let panel: ReviewPanel | undefined;

afterEach(() => {
  panel?.destroy();
  panel = undefined;
  document.body.innerHTML = "";
});

describe("ReviewPanel native shell", () => {
  function mountPanel() {
    document.body.innerHTML = '<div class="region-content"><main class="repos-pr-details-page">Native PR content</main></div><button class="adopp-start-button">Assistant</button>';
    const settings = defaultSettings();
    settings.features.startReviewing = false;
    settings.features.threadNavigator = false;
    const openSettings = vi.fn();
    panel = new ReviewPanel({
      analysis: {
        context: {
          origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
          repositoryId: "repo-id", pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target",
          mergeBaseCommit: "base", iterationId: 3, identity: "identity", reviewer: { id: "me", displayName: "Me" }
        },
        files: [], groups: [], threads: { state: "available", active: 0, resolved: 0, total: 0 }, completedTrackingIds: new Set()
      },
      api: new AdoApi({ fetch: vi.fn() }),
      store: new MemoryBrowserStore(),
      settingsService: new SettingsService(new MemorySettingsStorage()),
      settings,
      reviewKey: "org/project/repo-id/7",
      writes: new RuntimeWriteGateway(),
      copilot: new RuntimeCopilotGateway(),
      openSettings
    });
    const host = document.querySelector<HTMLElement>("[data-adopp-review-panel]")!;
    return { host, root: host.shadowRoot!, openSettings };
  }

  it("opens inline with official Bolt buttons, switches layout, and closes without reserving space", () => {
    const { host, root, openSettings } = mountPanel();
    panel!.openDiscussions();
    expect(host.dataset.layout).toBe("inline");
    expect(root.querySelectorAll(".header-actions > .bolt-button,.panel-layout-toggle")).toHaveLength(3);
    expect(root.querySelector(".subtitle")!.textContent).toBe("Iteration 3");
    root.querySelector<HTMLButtonElement>(".settings")!.click();
    expect(openSettings).toHaveBeenCalledOnce();
    root.querySelector<HTMLButtonElement>(".panel-layout-toggle")!.click();
    expect(root.querySelector<HTMLElement>(".panel-layout-menu")!.hidden).toBe(false);
    expect(host.dataset.layout).toBe("inline");
    expect(root.querySelector('[data-overlay="false"]')!.getAttribute("aria-checked")).toBe("true");
    root.querySelector<HTMLButtonElement>('[data-overlay="true"]')!.click();
    expect(host.dataset.layout).toBe("overlay");
    expect(document.querySelector("[data-adopp-panel-main]")).toBeNull();
    expect(root.activeElement?.classList.contains("panel-layout-toggle")).toBe(true);
    root.querySelector<HTMLButtonElement>(".panel-layout-toggle")!.click();
    root.querySelector<HTMLButtonElement>('[data-overlay="false"]')!.click();
    expect(host.dataset.layout).toBe("inline");
    root.querySelector<HTMLButtonElement>(".close")!.click();
    expect(host.dataset.open).toBe("false");
    expect(document.querySelector("[data-adopp-panel-main]")).toBeNull();
    expect(document.activeElement?.classList.contains("adopp-start-button")).toBe(true);
    expect(root.querySelector(".rail")!.hasAttribute("inert")).toBe(true);
  });

  it("supports layout menu keyboard navigation and dismisses it without closing the panel", () => {
    const { host, root } = mountPanel();
    panel!.openDiscussions();
    const trigger = root.querySelector<HTMLButtonElement>(".panel-layout-toggle")!;
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(root.activeElement).toBe(root.querySelector('[data-overlay="false"]'));
    root.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));
    expect(root.activeElement).toBe(root.querySelector('[data-overlay="true"]'));
    root.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    expect(host.dataset.open).toBe("true");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(root.activeElement).toBe(trigger);
    trigger.click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes with Escape but does not toggle while typing across the shadow boundary", () => {
    const { host, root } = mountPanel();
    panel!.openDiscussions();
    const input = document.createElement("textarea");
    root.append(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "R", shiftKey: true, composed: true, bubbles: true }));
    expect(host.dataset.open).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.dataset.open).toBe("false");
  });

  it("does not remount after outstanding draft loading completes on a destroyed panel", async () => {
    const { host } = mountPanel();
    panel!.destroy();
    await vi.waitFor(() => expect(host.isConnected).toBe(false));
    await Promise.resolve();
    expect(document.querySelector("[data-adopp-review-panel]")).toBeNull();
    expect(document.querySelector("[data-adopp-panel-main]")).toBeNull();
  });

  it.each(["keydown", "keypress", "keyup"])("contains %s inside the sidebar without suppressing editor events or default behavior", (type) => {
    const { root } = mountPanel();
    panel!.openDiscussions();
    const textarea = document.createElement("textarea");
    root.append(textarea);
    const editor = vi.fn();
    const adoShortcut = vi.fn();
    textarea.addEventListener(type, editor);
    document.addEventListener(type, adoShortcut);
    try {
      const event = new KeyboardEvent(type, { key: "e", bubbles: true, composed: true, cancelable: true });
      textarea.dispatchEvent(event);
      expect(editor).toHaveBeenCalledOnce();
      expect(adoShortcut).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      document.body.dispatchEvent(new KeyboardEvent(type, { key: "e", bubbles: true }));
      expect(adoShortcut).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener(type, adoShortcut);
    }
  });

  it("preserves default keyboard editing commands and local button behavior", () => {
    const { root, openSettings } = mountPanel();
    panel!.openDiscussions();
    const input = document.createElement("textarea");
    root.append(input);
    for (const options of [{ key: "a", ctrlKey: true }, { key: "Enter" }, { key: "Tab" }, { key: "ArrowLeft" }]) {
      const event = new KeyboardEvent("keydown", { ...options, bubbles: true, composed: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    root.querySelector<HTMLButtonElement>(".settings")!.click();
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("removes the keyboard boundary when destroyed", () => {
    const { root } = mountPanel();
    const button = document.createElement("button");
    root.append(button);
    const keyboard = vi.fn();
    root.host.addEventListener("keydown", keyboard);
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true, composed: true }));
    expect(keyboard).not.toHaveBeenCalled();
    panel!.destroy();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true, composed: true }));
    expect(keyboard).toHaveBeenCalledOnce();
  });
});

describe("ReviewPanel unresolved changes", () => {
  it("lists retained records and safely escapes diagnostic text without requesting unknown files", async () => {
    const analysis: PullRequestAnalysis = {
      context: {
        origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
        repositoryId: "repo-id", pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target",
        mergeBaseCommit: "base", iterationId: 3, identity: "identity", reviewer: { id: "me", displayName: "Me" }
      },
      files: [],
      groups: [],
      threads: { state: "available", active: 0, resolved: 0, total: 0 },
      completedTrackingIds: new Set(),
      unresolvedChanges: [
        { unresolved: true, trackingId: 2, detail: "No usable file path", raw: { item: { path: null } } },
        { unresolved: true, path: "<img src=x>", detail: "<script>unexpected metadata</script>", raw: {} }
      ]
    };
    const settings = defaultSettings();
    settings.features.startReviewing = false;
    settings.features.threadNavigator = false;
    const fetch = vi.fn(async () => { throw new Error("Unexpected API request"); });
    panel = new ReviewPanel({
      analysis,
      api: new AdoApi({ fetch }),
      store: new MemoryBrowserStore(),
      settingsService: new SettingsService(new MemorySettingsStorage()),
      settings,
      reviewKey: "org/project/repo-id/7",
      writes: new RuntimeWriteGateway(),
      copilot: new RuntimeCopilotGateway(),
      openSettings: vi.fn()
    });
    panel.openDiscussions();
    const root = [...document.documentElement.children].find((element) => element.shadowRoot)?.shadowRoot;
    await vi.waitFor(() => expect(root?.querySelector("summary")?.textContent).toBe("2 unresolved changes retained. Diff totals are partial."));
    expect(root?.textContent).toContain("Change 2: No usable file path");
    expect(root?.textContent).toContain("<img src=x>: <script>unexpected metadata</script>");
    expect(root?.querySelectorAll("script, img")).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
