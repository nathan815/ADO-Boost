// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AdoApi } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import { RuntimeCopilotGateway } from "../src/core/copilot-gateway";
import { AnnouncementService } from "../src/core/announcement";
import { HttpResponseError } from "../src/core/http-error";
import type { AnnouncementRecord, PullRequestAnalysis } from "../src/core/types";
import { RuntimeWriteGateway, type WriteGateway } from "../src/core/write-gateway";
import { defaultSettings } from "../src/features/registry";
import { MemorySettingsStorage, SettingsService } from "../src/features/settings-service";
import { ReviewPanel } from "../src/ui/review-panel";
import type { CopilotGateway, CopilotGroupResult } from "../src/core/copilot-gateway";
import type { SemanticGroupProposal } from "../src/core/types";
import * as adoNavigation from "../src/ui/ado-navigation";
import { SemanticGroupState } from "../src/core/semantic-groups";

let panel: ReviewPanel | undefined;

afterEach(() => {
  panel?.destroy();
  panel = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("ReviewPanel completion lifecycle", () => {
  async function fixture(announcementsEnabled = true, completionError?: Error) {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="region-content"><main class="repos-pr-details-page">Native PR content</main></div>';
    const analysis: PullRequestAnalysis = {
      context: {
        origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
        repositoryId: "repo-id", pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target",
        mergeBaseCommit: "base", iterationId: 3, identity: "identity", reviewer: { id: "me", displayName: "Me" }
      },
      files: [], groups: [], threads: { state: "available", active: 1, resolved: 0, total: 1 }, completedTrackingIds: new Set()
    };
    const settings = defaultSettings();
    settings.features.startReviewing = announcementsEnabled;
    settings.features.threadNavigator = false;
    const api = new AdoApi({ fetch: vi.fn() });
    const store = new MemoryBrowserStore();
    const announcement = new AnnouncementService(api, store);
    const record: AnnouncementRecord = {
      key: announcement.key(analysis.context), status: "posted", threadId: 8, commentId: 1, body: announcement.body(analysis.context)
    };
    await store.saveAnnouncement(record);
    const finishReview = vi.fn<WriteGateway["finishReview"]>().mockResolvedValue(record);
    if (completionError) finishReview.mockRejectedValue(completionError);
    panel = new ReviewPanel({
      analysis, api, store, settings,
      settingsService: new SettingsService(new MemorySettingsStorage()), reviewKey: "org/project/repo-id/7",
      writes: { postAnnouncement: vi.fn(), finishReview, submitReview: vi.fn(), retryDecision: vi.fn(), setThreadStatus: vi.fn() },
      copilot: new RuntimeCopilotGateway(), openSettings: vi.fn()
    });
    await vi.advanceTimersByTimeAsync(0);
    panel.openDiscussions();
    const root = document.querySelector("[data-adopp-review-panel]")!.shadowRoot!;
    return { root, record, finishReview, settings };
  }

  it("labels a failed completion check on page load without changing the announced review status", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, finishReview } = await fixture(true, new Error("Reviewer lookup failed (400)"));
      expect(finishReview).toHaveBeenCalledOnce();
      expect(root.querySelector(".panel-toast span")?.textContent).toBe("Couldn't check review completion: Reviewer lookup failed (400)");
      expect(error).toHaveBeenCalledWith("ADO Boost review completion check failed:", "Reviewer lookup failed (400)", expect.objectContaining({ message: "Reviewer lookup failed (400)" }));
      expect(panel!.isReviewAnnounced()).toBe(true);
      expect(panel!.isReviewFinished()).toBe(false);
    } finally {
      error.mockRestore();
    }
  });

  it("logs full HTTP diagnostics in the page console without putting them in the toast", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const error = await HttpResponseError.fromResponse("Reviewer lookup failed (400)", {
        url: "https://dev.azure.com/org/project/_apis/git/repositories/repo-id/pullRequests/7/reviewers/me?api-version=7.1",
        method: "GET", headers: { Accept: "application/json" }, credentials: "include", body: null
      }, new Response('{"message":"Invalid reviewer ID"}', { status: 400 }));
      const { root } = await fixture(true, error);
      expect(log).toHaveBeenCalledExactlyOnceWith("ADO Boost review completion check failed:", error.message, error.details);
      expect(root.querySelector(".panel-toast span")?.textContent).toBe("Couldn't check review completion: Reviewer lookup failed (400)");
      expect(root.querySelector(".panel-toast")?.textContent).not.toContain("Invalid reviewer ID");
      expect(panel!.isReviewFinished()).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it("checks on focus after a submission closed the thread and preserves unsaved draft text", async () => {
    const { root, record, finishReview } = await fixture();
    root.querySelector<HTMLButtonElement>(".add-general")!.click();
    const textarea = root.querySelector<HTMLTextAreaElement>(".draft-body")!;
    textarea.value = "Keep my unsaved feedback";
    textarea.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(finishReview).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector(".draft-body")).toBe(textarea);
    finishReview.mockResolvedValue({
      ...record, completions: [{ id: "review-1", kind: "submission", commentCount: 2, at: "2026-10-16T04:00:00Z", status: "closed" }]
    });
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(panel!.isReviewFinished()).toBe(true);
    expect(root.querySelector(".review-start-status")?.textContent).toBe("You've finished reviewing");
    expect(root.querySelector<HTMLTextAreaElement>(".draft-body")!.value).toBe("Keep my unsaved feedback");
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(finishReview).toHaveBeenCalledTimes(5);
    panel!.destroy();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(30000);
    expect(finishReview).toHaveBeenCalledTimes(5);
  });

  it("stops on feature disablement and resumes when enabled again", async () => {
    const { settings, finishReview } = await fixture();
    settings.features.startReviewing = false;
    panel!.updateSettings(settings);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(30000);
    expect(finishReview).toHaveBeenCalledOnce();
    settings.features.startReviewing = true;
    panel!.updateSettings(settings);
    await vi.advanceTimersByTimeAsync(0);
    expect(finishReview).toHaveBeenCalledTimes(2);
  });

  it("discovers an existing announcement when the feature was initially disabled", async () => {
    const { settings, finishReview } = await fixture(false);
    expect(finishReview).not.toHaveBeenCalled();
    panel!.updateSettings({ ...settings, features: { ...settings.features, startReviewing: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect(finishReview).toHaveBeenCalledOnce();
  });
});

describe("ReviewPanel native shell", () => {
  function mountPanel() {
    document.body.innerHTML = '<div class="region-content"><main class="repos-pr-details-page">Native PR content</main></div><button class="adopp-start-button" aria-label="ADO Boost"></button>';
    const settings = defaultSettings();
    settings.features.startReviewing = false;
    settings.features.threadNavigator = false;
    const openSettings = vi.fn();
    const fetch = vi.fn();
    panel = new ReviewPanel({
      analysis: {
        context: {
          origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
          repositoryId: "repo-id", pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target",
          mergeBaseCommit: "base", iterationId: 3, identity: "identity", reviewer: { id: "me", displayName: "Me" }
        },
        files: [], groups: [], threads: { state: "available", active: 0, resolved: 0, total: 0 }, completedTrackingIds: new Set()
      },
      api: new AdoApi({ fetch }),
      store: new MemoryBrowserStore(),
      settingsService: new SettingsService(new MemorySettingsStorage()),
      settings,
      reviewKey: "org/project/repo-id/7",
      writes: new RuntimeWriteGateway(),
      copilot: new RuntimeCopilotGateway(),
      openSettings
    });
    const host = document.querySelector<HTMLElement>("[data-adopp-review-panel]")!;
    return { host, root: host.shadowRoot!, openSettings, fetch };
  }

  it("shows a persistent test toast without opening the sidebar or making an API request", () => {
    vi.useFakeTimers();
    const { host, root, fetch } = mountPanel();
    panel!.triggerTestToast();
    expect(host.dataset.open).toBe("false");
    expect(root.querySelector(".rail")?.getAttribute("data-open")).toBe("false");
    expect(document.querySelector("[data-adopp-panel-main]")).toBeNull();
    expect(root.querySelector(".panel-toast strong")?.textContent).toBe("ADO Boost");
    expect(root.querySelector(".panel-toast span")?.textContent).toContain("This is a test notification.");
    vi.advanceTimersByTime(3600000);
    expect(root.querySelector(".panel-toast")).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('.panel-toast [aria-label="Dismiss notification"]')!.click();
    expect(root.querySelector(".panel-toast")).toBeNull();
  });

  it("opens inline with official Bolt buttons, switches layout, and closes without reserving space", () => {
    const { host, root, openSettings } = mountPanel();
    panel!.openDiscussions();
    expect(host.dataset.layout).toBe("inline");
    expect(root.querySelectorAll(".header-actions > .bolt-button,.panel-layout-toggle")).toHaveLength(3);
    expect(root.querySelector(".subtitle")!.textContent).toBe("Iteration 3");
    root.querySelector<HTMLButtonElement>(".settings")!.click();
    expect(openSettings).toHaveBeenCalledOnce();
    root.querySelector<HTMLButtonElement>(".panel-layout-toggle")!.click();
    expect(document.querySelector(".adopp-layout-callout .bolt-menu")).not.toBeNull();
    expect(host.dataset.layout).toBe("inline");
    expect(document.querySelector(".adopp-layout-docked")!.getAttribute("aria-checked")).toBe("true");
    document.querySelector<HTMLElement>(".adopp-layout-overlay")!.click();
    expect(host.dataset.layout).toBe("overlay");
    expect(document.querySelector("[data-adopp-panel-main]")).toBeNull();
    expect(root.activeElement?.classList.contains("panel-layout-toggle")).toBe(true);
    root.querySelector<HTMLButtonElement>(".panel-layout-toggle")!.click();
    document.querySelector<HTMLElement>(".adopp-layout-docked")!.click();
    expect(host.dataset.layout).toBe("inline");
    root.querySelector<HTMLButtonElement>(".close")!.click();
    expect(host.dataset.open).toBe("false");
    expect(document.querySelector("[data-adopp-panel-main]")).toBeNull();
    expect(document.activeElement?.classList.contains("adopp-start-button")).toBe(true);
    expect(root.querySelector(".rail")!.hasAttribute("inert")).toBe(true);
  });

  it("opens the official menu from the keyboard and dismisses it without closing the panel", () => {
    const { host, root } = mountPanel();
    panel!.openDiscussions();
    const trigger = root.querySelector<HTMLButtonElement>(".panel-layout-toggle")!;
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".adopp-layout-callout .bolt-menu")).not.toBeNull();
    const docked = document.querySelector<HTMLElement>(".adopp-layout-docked")!;
    const overlay = document.querySelector<HTMLElement>(".adopp-layout-overlay")!;
    vi.spyOn(docked, "offsetHeight", "get").mockReturnValue(32);
    vi.spyOn(overlay, "offsetHeight", "get").mockReturnValue(32);
    docked.focus();
    docked.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", keyCode: 40, bubbles: true }));
    expect(document.activeElement).toBe(overlay);
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
    expect(host.dataset.open).toBe("true");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(root.activeElement).toBe(trigger);
  });

  it("removes the official menu portal when the panel is destroyed", () => {
    const { root } = mountPanel();
    panel!.openDiscussions();
    const trigger = root.querySelector<HTMLButtonElement>(".panel-layout-toggle")!;
    trigger.click();
    const portal = document.querySelector(".adopp-layout-callout")!.closest(".bolt-portal")!;
    panel!.destroy();
    expect(document.querySelector(".adopp-layout-callout")).toBeNull();
    expect(portal.isConnected).toBe(false);
  });

  it.each(["keydown", "keypress", "keyup"])("isolates unused layout menu %s shortcuts without blocking native menu keys", (type) => {
    const { root } = mountPanel();
    panel!.openDiscussions();
    root.querySelector<HTMLButtonElement>(".panel-layout-toggle")!.click();
    const item = document.querySelector<HTMLElement>(".adopp-layout-docked")!;
    const shortcut = vi.fn();
    document.addEventListener(type, shortcut);
    try {
      for (const key of ["e", "n", "R"]) {
        item.dispatchEvent(new KeyboardEvent(type, { key, shiftKey: key === "R", bubbles: true }));
      }
      expect(shortcut).not.toHaveBeenCalled();
      item.dispatchEvent(new KeyboardEvent(type, { key: "ArrowDown", keyCode: 40, bubbles: true }));
      expect(shortcut).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener(type, shortcut);
    }
  });

  it("dismisses the official menu when focus moves outside it", async () => {
    const { host, root } = mountPanel();
    panel!.openDiscussions();
    const trigger = root.querySelector<HTMLButtonElement>(".panel-layout-toggle")!;
    trigger.click();
    document.querySelector<HTMLElement>(".adopp-layout-docked")!.focus();
    document.querySelector<HTMLButtonElement>(".adopp-start-button")!.focus();
    await vi.waitFor(() => expect(document.querySelector(".adopp-layout-callout")).toBeNull());
    expect(host.dataset.open).toBe("true");
    expect(root.querySelector(".panel-layout-toggle")!.getAttribute("aria-expanded")).toBe("false");
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

describe("ReviewPanel semantic groups", () => {
  function groupResult(groups: SemanticGroupProposal[] = [], session: CopilotGroupResult["session"] = null, cached = false, generation: CopilotGroupResult["generation"] = null): CopilotGroupResult {
    return { groups, session, cached, generation };
  }

  const dialogMethods = ["showModal", "close"] as const;
  const originalDialogMethods = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
  beforeAll(() => {
    // jsdom does not implement the browser's modal top layer.
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } }
    });
  });
  afterAll(() => {
    dialogMethods.forEach((name, index) => {
      const descriptor = originalDialogMethods[index];
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    });
  });

  async function fixture(autoGenerate = false, confirm = true, generate = vi.fn<CopilotGateway["semanticGroups"]>(), cachedSemanticGroups = vi.fn<CopilotGateway["cachedSemanticGroups"]>().mockResolvedValue(null), refreshComparison?: () => Promise<void>) {
    document.body.innerHTML = '<div class="region-content"><main class="repos-pr-details-page">Native PR content</main></div>';
    const settings = defaultSettings();
    settings.features.startReviewing = false;
    settings.features.threadNavigator = false;
    settings.features.copilotSemanticGroups = true;
    settings.features.autoGenerateCopilotGroups = autoGenerate;
    settings.features.confirmCopilotGroups = confirm;
    const analysis: PullRequestAnalysis = {
      context: {
        origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
        repositoryId: "repo-id", pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target",
        mergeBaseCommit: "base", iterationId: 3, identity: "identity", reviewer: { id: "me", displayName: "Me" }
      },
      files: ["/src/first.ts", "/src/other.ts"].map((path, index) => ({
        path, trackingId: index + 1, changeType: "edit", additions: 1, deletions: 1,
        state: "exact", generated: false, lockfile: false
      })),
      groups: [], threads: { state: "available", active: 0, resolved: 0, total: 0 }, completedTrackingIds: new Set()
    };
    const api = new AdoApi({ fetch: vi.fn() });
    vi.spyOn(api, "getFileContent").mockResolvedValue({ text: "content", size: 7 });
    const semanticGroups = generate;
    const chat = vi.fn<CopilotGateway["chat"]>();
    const state = new SemanticGroupState();
    const settingsService = new SettingsService(new MemorySettingsStorage());
    const store = new MemoryBrowserStore();
    panel = new ReviewPanel({
      analysis, api, settings, store,
      settingsService, reviewKey: "org/project/repo-id/7",
      writes: new RuntimeWriteGateway(),
      copilot: { semanticGroups, cachedSemanticGroups, health: vi.fn().mockResolvedValue({ connected: true, authenticated: true }), chat }, openSettings: vi.fn(), semanticGroups: state, ...(refreshComparison ? { refreshComparison } : {})
    });
    const initiallyOpen = document.querySelector<HTMLElement>("[data-adopp-review-panel]")!.dataset.open;
    panel.openDiscussions();
    await vi.waitFor(() => expect(document.querySelector("[data-adopp-review-panel]")).not.toBeNull());
    await Promise.resolve();
    const root = document.querySelector("[data-adopp-review-panel]")!.shadowRoot!;
    root.querySelector<HTMLButtonElement>('[data-panel-tab="groups"]')!.click();
    const requestGroups = async () => {
      root.querySelector<HTMLButtonElement>(".copilot-groups")!.click();
      root.querySelector<HTMLButtonElement>(".confirm-context")?.click();
      await Promise.resolve();
    };
    return { root, analysis, semanticGroups, cachedSemanticGroups, settings, requestGroups, state, settingsService, api, initiallyOpen, chat, store };
  }

  it("persists the automatic-generation toggle without starting inference or changing confirmation", async () => {
    const { settingsService, semanticGroups, root } = await fixture();
    await panel!.toggleGroupingPreference("autoGenerateCopilotGroups");
    expect((await settingsService.load()).features).toMatchObject({ autoGenerateCopilotGroups: true, confirmCopilotGroups: true });
    await panel!.toggleGroupingPreference("autoGenerateCopilotGroups");
    expect((await settingsService.load()).features).toMatchObject({ autoGenerateCopilotGroups: false, confirmCopilotGroups: true });
    expect(semanticGroups).not.toHaveBeenCalled();
    expect(root.querySelector(".confirm-context")).toBeNull();
  });

  it("reports automatic-generation save failures and leaves the preference unchanged", async () => {
    const { settingsService, root } = await fixture();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const save = vi.spyOn(settingsService, "save").mockRejectedValueOnce(new Error("Storage unavailable"));
    try {
      await panel!.toggleGroupingPreference("autoGenerateCopilotGroups");
      expect(root.querySelector(".panel-toast span")?.textContent).toBe("Storage unavailable");
      expect(log).toHaveBeenCalledWith("ADO Boost could not save grouping preference", expect.any(Error));
      await panel!.toggleGroupingPreference("autoGenerateCopilotGroups");
      expect(save.mock.calls[1]![0].features.autoGenerateCopilotGroups).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it.each([true, false])("toggles confirmation from %s without starting generation or changing auto-generation", async (confirm) => {
    const { settingsService, semanticGroups, root } = await fixture(false, confirm);
    await panel!.toggleGroupingPreference("confirmCopilotGroups");
    expect((await settingsService.load()).features).toMatchObject({
      confirmCopilotGroups: !confirm, autoGenerateCopilotGroups: false
    });
    await panel!.toggleGroupingPreference("confirmCopilotGroups");
    expect((await settingsService.load()).features.confirmCopilotGroups).toBe(confirm);
    expect(semanticGroups).not.toHaveBeenCalled();
    expect(root.querySelector(".confirm-context")).toBeNull();
  });

  it.each([
    { automatic: false, confirm: true }, { automatic: false, confirm: false },
    { automatic: true, confirm: true }, { automatic: true, confirm: false }
  ])("restores cached groups automatically with settings %j without inference or confirmation", async ({ automatic, confirm }) => {
    const cached = vi.fn<CopilotGateway["cachedSemanticGroups"]>().mockResolvedValue(groupResult(
      [{ title: "Restored", rationale: "Already analyzed", paths: ["/src/first.ts"] }],
      { sessionId: "cached-session", models: ["cached-model"], inputTokens: 100, outputTokens: 20, cacheReadTokens: null, cacheWriteTokens: null },
      true
    ));
    const { root, semanticGroups, state, api, initiallyOpen, settings } = await fixture(automatic, confirm, vi.fn(), cached);
    await vi.waitFor(() => expect(state.groups?.[0]?.title).toBe("Restored"));
    expect(initiallyOpen).toBe("false");
    expect(root.querySelector(".copilot-result summary")?.textContent).toContain("Restored");
    expect(root.querySelector(".copilot-session")?.textContent).toContain("cached-model");
    expect(root.querySelector(".copilot-session .status")?.textContent).toBe("Cached");
    expect(root.querySelector(".copilot-groups")?.textContent).toBe("Regenerate");
    expect(root.querySelector(".copilot-groups")?.classList.contains("secondary")).toBe(true);
    expect(root.querySelector(".copilot-groups")?.classList.contains("primary")).toBe(false);
    expect(root.querySelector(".confirm-context")).toBeNull();
    expect(state.view.mode).toBe("inline");
    expect(state.busy).toBe(false);
    expect(api.getFileContent).not.toHaveBeenCalled();
    expect(semanticGroups).not.toHaveBeenCalled();
    panel!.updateSettings(settings);
    expect(cached).toHaveBeenCalledOnce();
  });

  it("retains groups across historical comparisons and restores cache when the feature is re-enabled", async () => {
    const cached = vi.fn<CopilotGateway["cachedSemanticGroups"]>().mockResolvedValue(groupResult(
      [{ title: "Restored", rationale: "Cached", paths: ["/src/first.ts"] }], null, true
    ));
    const { state, settings, root, semanticGroups } = await fixture(false, true, vi.fn(), cached);
    await vi.waitFor(() => expect(state.groups).not.toBeNull());
    state.setAvailable(false);
    expect(state.groups).not.toBeNull();
    state.setAvailable(true);
    expect(cached).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(state.groups).not.toBeNull());
    panel!.updateSettings({ ...settings, features: { ...settings.features, copilotSemanticGroups: false } });
    expect(state.groups).toBeNull();
    expect(root.querySelector(".copilot-results")).toBeNull();
    expect(cached).toHaveBeenCalledOnce();
    panel!.updateSettings(settings);
    await vi.waitFor(() => expect(cached).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(state.groups).not.toBeNull());
    expect(semanticGroups).not.toHaveBeenCalled();
  });

  it("uses primary styling for Generate and regular styling for Regenerate", async () => {
    const { root, semanticGroups, requestGroups, state } = await fixture(false, false);
    expect(root.querySelector(".copilot-groups")?.classList.contains("primary")).toBe(true);
    expect(root.querySelector(".copilot-groups")?.classList.contains("secondary")).toBe(false);
    semanticGroups.mockResolvedValue(groupResult());
    await requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".copilot-groups")?.textContent).toBe("Regenerate"));
    expect(root.querySelector(".copilot-groups")?.classList.contains("secondary")).toBe(true);
    expect(root.querySelector(".copilot-groups")?.classList.contains("primary")).toBe(false);
    state.setAvailable(false);
    expect(root.querySelector(".copilot-groups")?.textContent).toBe("Regenerate");
    expect(root.querySelector(".copilot-groups")?.classList.contains("secondary")).toBe(true);
    expect(root.querySelector<HTMLButtonElement>(".copilot-groups")?.disabled).toBe(false);
  });

  it("never overwrites a newer manual generation with a delayed cached result", async () => {
    let resolveCache!: (result: CopilotGroupResult) => void;
    const cached = vi.fn<CopilotGateway["cachedSemanticGroups"]>().mockImplementation(() => new Promise((resolve) => { resolveCache = resolve; }));
    const generated = vi.fn<CopilotGateway["semanticGroups"]>().mockResolvedValue(groupResult(
      [{ title: "Fresh", rationale: "New generation", paths: ["/src/first.ts"] }]
    ));
    const { state, root, requestGroups } = await fixture(false, false, generated, cached);
    await requestGroups();
    await vi.waitFor(() => expect(state.groups?.[0]?.title).toBe("Fresh"));
    resolveCache(groupResult([{ title: "Old cache", rationale: "Previous generation", paths: ["/src/first.ts"] }], null, true));
    await Promise.resolve();
    expect(root.querySelector(".copilot-result summary")?.textContent).toContain("Fresh");
    expect(root.querySelector(".copilot-session .status")).toBeNull();
  });

  it("ignores delayed cached results after comparison invalidation", async () => {
    let resolveCache!: (result: CopilotGroupResult) => void;
    const cached = vi.fn<CopilotGateway["cachedSemanticGroups"]>().mockImplementation(() => new Promise((resolve) => { resolveCache = resolve; }));
    const { state, root, semanticGroups, analysis } = await fixture(true, true, vi.fn(), cached);
    const finishOld = resolveCache;
    cached.mockResolvedValue(null);
    panel!.updateComparison({ ...analysis, context: { ...analysis.context, identity: "latest", iterationId: 4 } });
    finishOld(groupResult([{ title: "Stale", rationale: "Wrong comparison", paths: ["/src/first.ts"] }], null, true));
    await Promise.resolve();
    expect(state.groups).toBeNull();
    expect(root.querySelector(".copilot-results")).toBeNull();
    expect(semanticGroups).not.toHaveBeenCalled();
  });

  it("surfaces cache-read failures without silently starting inference", async () => {
    const cached = vi.fn<CopilotGateway["cachedSemanticGroups"]>().mockRejectedValue(new Error("Cache storage unavailable"));
    const { root, semanticGroups, api } = await fixture(true, false, vi.fn(), cached);
    await vi.waitFor(() => expect(root.querySelector(".delivery.error")?.textContent).toBe("Cache storage unavailable"));
    expect(semanticGroups).not.toHaveBeenCalled();
    expect(api.getFileContent).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLButtonElement>(".copilot-groups")?.disabled).toBe(false);
  });

  it("shows progress, renders safe group results including omitted files, and opens native files", async () => {
    const { root, semanticGroups, requestGroups, analysis } = await fixture();
    let complete!: (result: CopilotGroupResult) => void;
    semanticGroups.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    await requestGroups();
    expect(root.querySelector(".copilot-groups")?.textContent).toBe("Grouping changes...");
    expect(root.querySelector<HTMLButtonElement>(".copilot-groups")?.disabled).toBe(true);
    await vi.waitFor(() => expect(semanticGroups).toHaveBeenCalledOnce());
    complete(groupResult([{ title: "<img src=x>", rationale: "<script>explanation</script>", paths: ["/src/first.ts"] }]));
    await vi.waitFor(() => expect(root.querySelector(".copilot-results")).not.toBeNull());
    expect(root.querySelector(".copilot-results [role=status]")?.textContent).toBe("2 groups, 2 files");
    expect(root.querySelectorAll(".copilot-result")).toHaveLength(2);
    expect(root.querySelector(".copilot-result summary")?.textContent).toContain("<img src=x>");
    expect(root.querySelector(".group-note")?.textContent).toBe("<script>explanation</script>");
    expect(root.querySelectorAll(".copilot-results script,.copilot-results img")).toHaveLength(0);
    expect(root.querySelector(".copilot-results")?.textContent).toContain("Unassigned changes");
    expect(root.querySelector(".copilot-groups")?.textContent).toBe("Regenerate");
    expect(semanticGroups.mock.calls[0]?.[3]).toBe(false);
    expect(analysis.groups).toEqual([]);

    const link = root.querySelector<HTMLAnchorElement>("[data-copilot-path]")!;
    expect(new URL(link.href).searchParams.get("path")).toBe("/src/first.ts");
    const navigate = vi.spyOn(adoNavigation, "navigateToAdoFile").mockResolvedValue();
    try {
      link.click();
      expect(navigate).toHaveBeenCalledExactlyOnceWith("/src/first.ts");
    } finally {
      navigate.mockRestore();
    }

    semanticGroups.mockResolvedValue(groupResult([{ title: "Updated", rationale: "New grouping", paths: analysis.files.map((file) => file.path) }]));
    await requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".copilot-result summary")?.textContent).toContain("Updated"));
    expect(semanticGroups.mock.calls[1]?.[3]).toBe(true);
  });

  it("shows regeneration errors without losing previous results and hides groups when disabled", async () => {
    const { root, semanticGroups, requestGroups, settings } = await fixture();
    semanticGroups.mockResolvedValue(groupResult([{ title: "Changes", rationale: "Related", paths: ["/src/first.ts"] }]));
    await requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".copilot-results")).not.toBeNull());
    semanticGroups.mockRejectedValue(new Error("Companion disconnected"));
    await requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".delivery.error")?.textContent).toBe("Companion disconnected"));
    expect(root.querySelectorAll("[data-copilot-path]")).toHaveLength(2);
    expect(root.querySelector<HTMLButtonElement>(".copilot-groups")?.disabled).toBe(false);
    panel!.updateSettings({ ...settings, features: { ...settings.features, copilotSemanticGroups: false } });
    expect(root.querySelector(".copilot-results")).toBeNull();
  });

  it("opens privacy confirmation from the native action without transmitting context or duplicating dialogs", async () => {
    const { root, semanticGroups } = await fixture();
    panel!.requestSemanticGroups();
    panel!.requestSemanticGroups();
    expect(root.querySelectorAll(".confirm-context")).toHaveLength(1);
    expect(semanticGroups).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>(".dialog-backdrop .cancel")!.click();
    expect(root.querySelector(".confirm-context")).toBeNull();
    expect(semanticGroups).not.toHaveBeenCalled();
  });

  it("keeps a modal confirmation open with its choices and focus across panel updates", async () => {
    const { root, settings, semanticGroups } = await fixture();
    panel!.requestSemanticGroups();
    const dialog = root.querySelector<HTMLDialogElement>("dialog.dialog-backdrop")!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBe("group-confirm-title");
    const checkbox = dialog.querySelector<HTMLInputElement>(".auto-generate-groups")!;
    checkbox.checked = true;
    checkbox.focus();
    panel!.updateSettings(settings);
    expect(root.querySelector("dialog.dialog-backdrop")).toBe(dialog);
    expect(dialog.open).toBe(true);
    expect(checkbox.checked).toBe(true);
    expect(root.activeElement).toBe(checkbox);
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(dialog.open).toBe(false);
    expect(dialog.isConnected).toBe(false);
    expect(semanticGroups).not.toHaveBeenCalled();
    expect(root.activeElement?.classList.contains("copilot-groups")).toBe(true);
  });

  it("closes the modal when the feature is disabled or the panel is destroyed", async () => {
    const { root, settings } = await fixture();
    panel!.requestSemanticGroups();
    const first = root.querySelector<HTMLDialogElement>("dialog")!;
    panel!.updateSettings({ ...settings, features: { ...settings.features, copilotSemanticGroups: false } });
    expect(first.open).toBe(false);
    expect(first.isConnected).toBe(false);
    panel!.updateSettings(settings);
    panel!.requestSemanticGroups();
    const second = root.querySelector<HTMLDialogElement>("dialog")!;
    panel!.destroy();
    expect(second.open).toBe(false);
    expect(second.isConnected).toBe(false);
  });

  it("keeps a generation for the latest PR context when the native view switches to a historical comparison", async () => {
    const { root, semanticGroups, requestGroups, state } = await fixture();
    let complete!: (result: CopilotGroupResult) => void;
    semanticGroups.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    await requestGroups();
    await vi.waitFor(() => expect(semanticGroups).toHaveBeenCalledOnce());
    state.setAvailable(false);
    complete(groupResult([{ title: "Stale", rationale: "Old comparison", paths: ["/src/first.ts"] }]));
    await Promise.resolve();
    await vi.waitFor(() => expect(state.groups).not.toBeNull());
    expect(root.querySelector(".copilot-results")).not.toBeNull();
    expect(root.querySelector(".copilot-panel")?.textContent).toContain("latest All Changes comparison");
    expect(root.querySelector<HTMLButtonElement>(".copilot-groups")?.disabled).toBe(false);
  });

  it("separates discussions and groups with keyboard-accessible tabs and independent scroll positions", async () => {
    const { root } = await fixture();
    const workspace = root.querySelector<HTMLElement>(".workspace")!;
    workspace.scrollTop = 250;
    workspace.dispatchEvent(new Event("scroll"));
    panel!.openDiscussions();
    expect(root.querySelector<HTMLElement>("#groups-panel")!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>("#discussions-panel")!.hidden).toBe(false);
    expect(root.querySelector(".workspace")!.scrollTop).toBe(0);
    const tab = root.querySelector<HTMLButtonElement>("#discussions-tab")!;
    tab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(root.querySelector("#groups-tab")!.getAttribute("aria-selected")).toBe("true");
    expect(root.activeElement?.id).toBe("groups-tab");
    expect(root.querySelector(".workspace")!.scrollTop).toBe(250);
  });

  it("remembers confirmation choices and sends all files without a file picker on subsequent requests", async () => {
    const { root, semanticGroups, requestGroups, analysis, settingsService, state } = await fixture();
    semanticGroups.mockResolvedValue(groupResult());
    panel!.requestSemanticGroups();
    expect(root.querySelector(".dialog")?.textContent).toContain("All PR files and context will be sent to Copilot running locally.");
    expect(root.querySelector("[data-context-path]")).toBeNull();
    expect(root.querySelector<HTMLInputElement>(".auto-generate-groups")!.checked).toBe(false);
    expect(root.querySelector<HTMLInputElement>(".show-group-confirmation")!.checked).toBe(true);
    expect(root.querySelector(".show-group-confirmation")!.parentElement!.textContent).toContain("Always show this confirmation dialog");
    root.querySelector<HTMLInputElement>(".show-group-confirmation")!.checked = false;
    root.querySelector<HTMLInputElement>(".auto-generate-groups")!.checked = true;
    root.querySelector<HTMLButtonElement>(".confirm-context")!.click();
    await vi.waitFor(() => expect(semanticGroups).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(state.busy).toBe(false));
    const saved = await settingsService.load();
    expect(saved.features.autoGenerateCopilotGroups).toBe(true);
    expect(saved.features.confirmCopilotGroups).toBe(false);
    expect(semanticGroups).toHaveBeenCalledOnce();
    expect(semanticGroups.mock.calls[0]![1]).toEqual(analysis.files);
    expect(semanticGroups.mock.calls[0]![2].map((excerpt) => excerpt.path)).toEqual(analysis.files.map((file) => file.path));
    await requestGroups();
    await vi.waitFor(() => expect(semanticGroups).toHaveBeenCalledTimes(2));
    expect(root.querySelector(".dialog")).toBeNull();
  });

  it("keeps confirmation enabled by default, and cancellation does not save or send", async () => {
    const { root, semanticGroups, settingsService } = await fixture();
    const save = vi.spyOn(settingsService, "save");
    panel!.requestSemanticGroups();
    root.querySelector<HTMLButtonElement>(".cancel")!.click();
    expect(save).not.toHaveBeenCalled();
    expect(semanticGroups).not.toHaveBeenCalled();
    panel!.requestSemanticGroups();
    expect(root.querySelector<HTMLInputElement>(".show-group-confirmation")!.checked).toBe(true);
    semanticGroups.mockResolvedValue(groupResult());
    root.querySelector<HTMLButtonElement>(".confirm-context")!.click();
    await vi.waitFor(() => expect(semanticGroups).toHaveBeenCalledOnce());
    expect((await settingsService.load()).features.confirmCopilotGroups).toBe(true);
    panel!.requestSemanticGroups();
    expect(root.querySelector<HTMLInputElement>(".show-group-confirmation")!.checked).toBe(true);
  });

  it("automatically generates once on load without opening the sidebar or showing confirmation", async () => {
    const generate = vi.fn<CopilotGateway["semanticGroups"]>().mockImplementation(() => new Promise(() => {}));
    const { root, state, settings, semanticGroups, initiallyOpen } = await fixture(true, true, generate);
    expect(initiallyOpen).toBe("false");
    expect(state.busy).toBe(true);
    expect(root.querySelector(".grouping-spinner")).not.toBeNull();
    expect(root.querySelector(".copilot-panel")?.getAttribute("aria-busy")).toBe("true");
    expect(root.querySelector(".confirm-context")).toBeNull();
    await vi.waitFor(() => expect(semanticGroups).toHaveBeenCalledOnce());
    panel!.updateSettings(settings);
    expect(semanticGroups).toHaveBeenCalledOnce();
  });

  it("does not send on load by default and can bypass confirmation explicitly", async () => {
    const { root, semanticGroups, requestGroups } = await fixture(false, false);
    expect(semanticGroups).not.toHaveBeenCalled();
    semanticGroups.mockResolvedValue(groupResult());
    await requestGroups();
    await vi.waitFor(() => expect(semanticGroups).toHaveBeenCalledOnce());
    expect(root.querySelector(".confirm-context")).toBeNull();
  });

  it("keeps manual generation unobtrusive after confirmation has been disabled", async () => {
    const { root, semanticGroups } = await fixture(false, false);
    root.querySelector<HTMLButtonElement>(".close")!.click();
    semanticGroups.mockResolvedValue(groupResult());
    panel!.requestSemanticGroups();
    expect(root.querySelector(".rail")!.getAttribute("data-open")).toBe("false");
    await vi.waitFor(() => expect(semanticGroups).toHaveBeenCalledOnce());
    expect(root.querySelector(".dialog")).toBeNull();
  });

  it.each([false, true])("preserves the sidebar state through confirmed tree generation with sidebar open=%s", async (open) => {
    const { root, semanticGroups, state } = await fixture();
    panel!.openDiscussions();
    if (!open) root.querySelector<HTMLButtonElement>(".close")!.click();
    const expectUnchanged = () => {
      expect(root.querySelector(".rail")!.getAttribute("data-open")).toBe(String(open));
      expect(root.querySelector("#discussions-tab")!.getAttribute("aria-selected")).toBe("true");
      expect(root.querySelector("#groups-tab")!.getAttribute("aria-selected")).toBe("false");
    };
    panel!.requestSemanticGroups();
    expect(root.querySelector<HTMLDialogElement>("dialog")!.open).toBe(true);
    expectUnchanged();
    root.querySelector<HTMLButtonElement>(".cancel")!.click();
    expectUnchanged();
    expect(semanticGroups).not.toHaveBeenCalled();

    let complete!: (result: CopilotGroupResult) => void;
    semanticGroups.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    panel!.requestSemanticGroups();
    root.querySelector<HTMLButtonElement>(".confirm-context")!.click();
    await vi.waitFor(() => expect(semanticGroups).toHaveBeenCalledOnce());
    expect(state.processing).toBe(true);
    expectUnchanged();
    complete(groupResult());
    await vi.waitFor(() => expect(state.processing).toBe(false));
    expectUnchanged();
  });

  it("preserves questions across tabs and switches to Discussions when drafting a Copilot answer", async () => {
    const { root, settings, chat } = await fixture();
    panel!.updateSettings({ ...settings, features: { ...settings.features, copilotChat: true } });
    expect(root.querySelector("#groups-panel .copilot-question")).toBeNull();
    root.querySelector<HTMLButtonElement>("#chat-tab")!.click();
    expect(root.querySelector<HTMLElement>("#chat-panel")!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>("#groups-panel")!.hidden).toBe(true);
    const question = root.querySelector<HTMLTextAreaElement>(".copilot-question")!;
    question.value = "What should reviewers focus on?";
    question.dispatchEvent(new Event("input"));
    root.querySelector<HTMLButtonElement>("#discussions-tab")!.click();
    root.querySelector<HTMLButtonElement>("#groups-tab")!.click();
    root.querySelector<HTMLButtonElement>("#chat-tab")!.click();
    expect(root.querySelector<HTMLTextAreaElement>(".copilot-question")!.value).toBe(question.value);
    chat.mockResolvedValue("Review the comparison lifecycle");
    root.querySelector<HTMLButtonElement>(".copilot-ask")!.click();
    expect(root.querySelectorAll("[data-context-path]")).toHaveLength(2);
    root.querySelector<HTMLButtonElement>(".confirm-context")!.click();
    await vi.waitFor(() => expect(root.querySelector(".copilot-draft")).not.toBeNull());
    expect(root.querySelector("#groups-panel .copilot-answer")).toBeNull();
    expect(root.querySelector("#chat-panel .copilot-answer")?.textContent).toBe("Review the comparison lifecycle");
    root.querySelector<HTMLButtonElement>(".copilot-draft")!.click();
    expect(root.querySelector<HTMLElement>("#discussions-panel")!.hidden).toBe(false);
    expect(root.querySelector("#discussions-tab")!.getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector<HTMLTextAreaElement>(".draft-body")!.value).toBe("Review the comparison lifecycle");
  });

  it("navigates all three tabs in both directions and restores each scroll position", async () => {
    const { root, settings } = await fixture();
    panel!.updateSettings({ ...settings, features: { ...settings.features, copilotChat: true } });
    expect([...root.querySelectorAll("[role=tab]")].map((tab) => tab.textContent)).toEqual(["Discussions", "Copilot Groups", "Chat"]);
    const positions = { discussions: 35, groups: 250, chat: 125 };
    for (const [tab, scrollTop] of Object.entries(positions)) {
      root.querySelector<HTMLButtonElement>(`#${tab}-tab`)!.click();
      const workspace = root.querySelector<HTMLElement>(".workspace")!;
      workspace.scrollTop = scrollTop;
      workspace.dispatchEvent(new Event("scroll"));
    }
    for (const [key, tab] of [
      ["ArrowLeft", "groups"], ["ArrowLeft", "discussions"], ["ArrowLeft", "chat"],
      ["ArrowRight", "discussions"], ["End", "chat"], ["Home", "discussions"],
      ["ArrowRight", "groups"], ["ArrowRight", "chat"]
    ] as const) {
      root.querySelector<HTMLButtonElement>('[role=tab][aria-selected="true"]')!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      expect(root.activeElement?.id).toBe(`${tab}-tab`);
      expect(root.querySelector(`#${tab}-panel`)?.hasAttribute("hidden")).toBe(false);
      expect(root.querySelectorAll('[role=tabpanel]:not([hidden])')).toHaveLength(1);
      expect(root.querySelector(".workspace")!.scrollTop).toBe(positions[tab]);
    }
  });

  it("shows Chat only when enabled and returns to Discussions if the active tab is disabled", async () => {
    const { root, settings } = await fixture();
    expect(root.querySelector("#chat-tab")).toBeNull();
    expect(root.querySelector("#chat-panel")).toBeNull();
    const enabled = { ...settings, features: { ...settings.features, copilotChat: true } };
    panel!.updateSettings(enabled);
    root.querySelector<HTMLButtonElement>("#chat-tab")!.click();
    panel!.updateSettings(settings);
    expect(root.querySelector("#chat-tab")).toBeNull();
    expect(root.querySelector("#chat-panel")).toBeNull();
    expect(root.querySelector("#discussions-tab")?.getAttribute("aria-selected")).toBe("true");
    panel!.updateSettings(enabled);
    root.querySelector<HTMLButtonElement>("#chat-tab")!.click();
    panel!.updateSettings({ ...enabled, features: { ...enabled.features, copilotSemanticGroups: false } });
    expect(root.querySelector("#chat-tab")).toBeNull();
    expect(root.querySelector("#groups-tab")).toBeNull();
    expect(root.querySelector("#discussions-panel")?.hasAttribute("hidden")).toBe(false);
  });

  it("keeps chat and grouping errors in their own tabs and preserves request serialization", async () => {
    const { root, settings, chat, semanticGroups, requestGroups } = await fixture();
    panel!.updateSettings({ ...settings, features: { ...settings.features, copilotChat: true } });
    root.querySelector<HTMLButtonElement>("#chat-tab")!.click();
    const question = root.querySelector<HTMLTextAreaElement>(".copilot-question")!;
    question.value = "What changed?";
    question.dispatchEvent(new Event("input"));
    let rejectChat!: (error: Error) => void;
    chat.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectChat = reject; }));
    root.querySelector<HTMLButtonElement>(".copilot-ask")!.click();
    root.querySelector<HTMLButtonElement>(".confirm-context")!.click();
    await vi.waitFor(() => expect(chat).toHaveBeenCalledOnce());
    expect(root.querySelector(".copilot-chat")?.getAttribute("aria-busy")).toBe("true");
    expect(root.querySelector<HTMLButtonElement>(".copilot-groups")!.disabled).toBe(true);
    root.querySelector<HTMLButtonElement>("#groups-tab")!.click();
    rejectChat(new Error("Question failed"));
    await vi.waitFor(() => expect(root.querySelector("#chat-panel [role=alert]")?.textContent).toBe("Question failed"));
    expect(root.querySelector("#groups-panel [role=alert]")).toBeNull();
    semanticGroups.mockRejectedValueOnce(new Error("Grouping failed"));
    await requestGroups();
    await vi.waitFor(() => expect(root.querySelector("#groups-panel [role=alert]")?.textContent).toBe("Grouping failed"));
    expect(root.querySelector("#chat-panel [role=alert]")?.textContent).toBe("Question failed");
    expect(root.querySelector<HTMLButtonElement>(".copilot-ask")!.disabled).toBe(false);
  });

  it("surfaces preference-save failures without sending context", async () => {
    const { root, semanticGroups, settingsService } = await fixture();
    vi.spyOn(settingsService, "save").mockRejectedValue(new Error("Storage unavailable"));
    panel!.requestSemanticGroups();
    root.querySelector<HTMLButtonElement>(".confirm-context")!.click();
    await vi.waitFor(() => expect(root.querySelector(".confirmation-error")?.textContent).toBe("Storage unavailable"));
    expect(semanticGroups).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLButtonElement>(".confirm-context")!.disabled).toBe(false);
  });

  it("shows actual model and per-session tokens and preserves them on failure or unsupported comparisons", async () => {
    const { root, semanticGroups, requestGroups, state } = await fixture();
    expect(root.querySelector(".copilot-session")).toBeNull();
    const session = { sessionId: "session-1", models: ["actual-model", "<img src=x>"], totalNanoAiu: 1_250_000_001, inputTokens: 1200, outputTokens: 300, cacheReadTokens: 400, cacheWriteTokens: 0 };
    semanticGroups.mockResolvedValue(groupResult([], session));
    await requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".copilot-session")?.textContent).toContain("actual-model"));
    const metrics = () => Object.fromEntries([...root.querySelectorAll(".copilot-session dl>div")].map((row) => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]));
    expect(metrics()).toMatchObject({
      "Session ID": "session-1", Model: "actual-model, <img src=x>", "Input tokens": (1200).toLocaleString(), "Output tokens": "300",
      "Total tokens": (1500).toLocaleString(), "Cache read tokens": "400", "Cache write tokens": "0",
      "AI credits used": (1.250000001).toLocaleString(undefined, { maximumFractionDigits: 9 })
    });
    expect(root.querySelector(".copilot-session img")).toBeNull();
    expect(root.querySelector(".copilot-session h3")?.getAttribute("title")).toContain("Each generation uses a separate session");
    expect(root.querySelector(".copilot-generation")?.textContent).toBe("Iteration 3 / Time not recorded");
    semanticGroups.mockRejectedValue(new Error("Host disconnected"));
    await requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".delivery.error")?.textContent).toBe("Host disconnected"));
    expect(metrics()["Total tokens"]).toBe((1500).toLocaleString());
    expect(metrics()["AI credits used"]).toBe((1.250000001).toLocaleString(undefined, { maximumFractionDigits: 9 }));
    state.setAvailable(false);
    expect(metrics()["Session ID"]).toBe("session-1");
  });

  it("restores stale cached groups without auto-generating and retains their original iteration and time", async () => {
    const cached = vi.fn<CopilotGateway["cachedSemanticGroups"]>().mockResolvedValue({
      ...groupResult([{ title: "Previous", rationale: "Old explanation", paths: ["/src/first.ts"] }], null, true,
        { iterationId: 2, generatedAt: "2026-10-20T12:00:00Z" }), stale: true
    });
    const { root, state, semanticGroups } = await fixture(true, false, vi.fn(), cached);
    await vi.waitFor(() => expect(state.stale).toBe(true));
    expect(root.querySelector(".copilot-panel")?.textContent).toContain("Groups are stale");
    expect(root.querySelector(".copilot-generation")?.textContent).toContain("Iteration 2");
    expect(root.querySelector("time")?.dateTime).toBe("2026-10-20T12:00:00Z");
    expect(state.groups?.map((group) => group.title)).toEqual(["Previous", "Unassigned changes"]);
    expect(semanticGroups).not.toHaveBeenCalled();
  });

  it("keeps stale results and session details visible during regeneration and after failure", async () => {
    const cached = vi.fn<CopilotGateway["cachedSemanticGroups"]>().mockResolvedValueOnce(groupResult(
      [{ title: "Previous", rationale: "Old explanation", paths: ["/src/first.ts"] }],
      { sessionId: "original", models: ["old-model"], inputTokens: 10, outputTokens: 2, cacheReadTokens: null, cacheWriteTokens: null }, true,
      { iterationId: 3, generatedAt: "2026-10-20T12:00:00Z" }
    )).mockResolvedValue(null);
    const { root, state, semanticGroups, requestGroups, analysis } = await fixture(false, false, vi.fn(), cached);
    await vi.waitFor(() => expect(state.groups).not.toBeNull());
    panel!.updateComparison({ ...analysis, context: { ...analysis.context, iterationId: 4, identity: "latest" },
      files: [analysis.files[0]!, { ...analysis.files[1]!, path: "/src/new.ts" }] });
    expect(state.stale).toBe(true);
    let fail!: (error: Error) => void;
    semanticGroups.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    await requestGroups();
    await vi.waitFor(() => expect(semanticGroups).toHaveBeenCalledOnce());
    expect(root.querySelector(".copilot-results")?.textContent).toContain("Previous");
    expect(root.querySelector(".copilot-session")?.textContent).toContain("original");
    expect(root.querySelector(".copilot-generation")?.textContent).toContain("Iteration 3");
    expect(semanticGroups.mock.calls[0]?.[0].identity).toBe("latest");
    expect(semanticGroups.mock.calls[0]?.[1].map((file) => file.path)).toEqual(["/src/first.ts", "/src/new.ts"]);
    fail(new Error("Disconnected"));
    await vi.waitFor(() => expect(state.busy).toBe(false));
    expect(state.stale).toBe(true);
    expect(root.querySelector(".copilot-results")?.textContent).toContain("Previous");
    expect(root.querySelector(".copilot-panel")?.textContent).toContain("Disconnected");
    semanticGroups.mockResolvedValue(groupResult([{ title: "Fresh", rationale: "", paths: analysis.files.map((file) => file.path) }]));
    await requestGroups();
    await vi.waitFor(() => expect(state.stale).toBe(false));
    expect(root.querySelector(".copilot-results")?.textContent).toContain("Fresh");
  });

  it("refreshes context before generation and rejects an obsolete in-flight result", async () => {
    let analysis!: PullRequestAnalysis;
    const refresh = vi.fn(async () => {
      panel!.updateComparison({ ...analysis, context: { ...analysis.context, iterationId: 4, identity: "latest" } });
    });
    const f = await fixture(false, false, vi.fn(), vi.fn().mockResolvedValue(null), refresh);
    analysis = f.analysis;
    let finish!: (result: CopilotGroupResult) => void;
    f.semanticGroups.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await f.requestGroups();
    await vi.waitFor(() => expect(f.semanticGroups).toHaveBeenCalledOnce());
    expect(refresh).toHaveBeenCalledOnce();
    expect(f.semanticGroups.mock.calls[0]?.[0].identity).toBe("latest");
    panel!.updateComparison({ ...analysis, context: { ...analysis.context, iterationId: 5, identity: "newest" } });
    expect(f.state.processing).toBe(true);
    finish(groupResult([{ title: "Obsolete", rationale: "", paths: ["/src/first.ts"] }]));
    await vi.waitFor(() => expect(f.root.querySelector<HTMLButtonElement>(".copilot-groups")?.disabled).toBe(false));
    expect(f.state.groups).toBeNull();
    expect(f.state.processing).toBe(false);
    expect(f.root.textContent).not.toContain("Obsolete");
  });

  it("preserves open feedback text and anchors it to its original comparison after a refresh", async () => {
    const { root, analysis, store } = await fixture();
    root.querySelector<HTMLButtonElement>('[data-panel-tab="discussions"]')!.click();
    await vi.waitFor(() => expect(root.querySelector(".add-general")).not.toBeNull());
    root.querySelector<HTMLButtonElement>(".add-general")!.click();
    const input = root.querySelector<HTMLTextAreaElement>(".draft-body")!;
    input.value = "Unsaved feedback";
    input.dispatchEvent(new Event("input"));
    panel!.updateComparison({ ...analysis, context: { ...analysis.context, iterationId: 4, identity: "latest" } });
    expect(root.querySelector<HTMLTextAreaElement>(".draft-body")?.value).toBe("Unsaved feedback");
    root.querySelector<HTMLButtonElement>(".save-draft")!.click();
    const key = `${analysis.context.origin}/${analysis.context.repositoryId}/${analysis.context.pullRequestId}/${analysis.context.reviewer.id}`;
    await vi.waitFor(async () => expect((await store.getDrafts(key))[0]).toMatchObject({ body: "Unsaved feedback", comparisonIdentity: "identity" }));
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(root.querySelector(".draft-item .status")?.textContent).toBe("stale");
    root.querySelector<HTMLButtonElement>(".add-general")!.click();
    const next = root.querySelector<HTMLTextAreaElement>(".draft-body")!;
    next.value = "Latest feedback";
    next.dispatchEvent(new Event("input"));
    root.querySelector<HTMLButtonElement>(".save-draft")!.click();
    await vi.waitFor(async () => expect((await store.getDrafts(key))[1]).toMatchObject({ body: "Latest feedback", comparisonIdentity: "latest" }));
  });

  it("labels cached session usage and replaces it with the next generation without accumulating", async () => {
    const { root, semanticGroups, requestGroups } = await fixture();
    semanticGroups.mockResolvedValue(groupResult([], {
      sessionId: "old-session", models: ["cached-model"], totalNanoAiu: 3_000_000_000, inputTokens: 100, outputTokens: 20, cacheReadTokens: null, cacheWriteTokens: null
    }, true));
    await requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".copilot-session .status")?.textContent).toBe("Cached"));
    expect(root.querySelector(".copilot-session .status")?.getAttribute("title")).toContain("No new model request");
    expect(root.querySelector(".copilot-session code")?.textContent).toBe("old-session");
    expect(root.querySelectorAll(".copilot-session dd")[2]?.textContent).toBe("3");
    semanticGroups.mockResolvedValue(groupResult([], {
      sessionId: "new-session", models: ["new-model"], totalNanoAiu: 0, inputTokens: 0, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null
    }));
    await requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".copilot-session")?.textContent).toContain("new-model"));
    expect(root.querySelector(".copilot-session .status")).toBeNull();
    expect(root.querySelector(".copilot-session")?.textContent).not.toContain("cached-model");
    expect([...root.querySelectorAll(".copilot-session dd")].map((value) => value.textContent)).toEqual(["new-session", "new-model", "0", "0", "Not reported", "Not reported"]);
  });

  it.each([0, 1, 1_250_000_000, null, undefined])("shows per-session AI credits without inventing unreported usage: %s", async (totalNanoAiu) => {
    const { root, semanticGroups, requestGroups } = await fixture();
    semanticGroups.mockResolvedValue(groupResult([], {
      sessionId: "credit-session", models: ["model"], inputTokens: 10, outputTokens: 2, cacheReadTokens: null, cacheWriteTokens: null,
      ...(totalNanoAiu !== undefined ? { totalNanoAiu } : {})
    }));
    await requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".copilot-session code")?.textContent).toBe("credit-session"));
    const row = [...root.querySelectorAll(".copilot-session dl>div")].find((row) => row.querySelector("dt")?.textContent === "AI credits used");
    expect(row?.querySelector("dd")?.textContent).toBe(totalNanoAiu == null ? "Not reported" : (totalNanoAiu / 1e9).toLocaleString(undefined, { maximumFractionDigits: 9 }));
  });

  it("explains missing telemetry from legacy companions and cached results", async () => {
    const { root, semanticGroups, requestGroups } = await fixture();
    semanticGroups.mockResolvedValue(groupResult([], null, true));
    await requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".copilot-session-unavailable")?.textContent).toBe("Session info unavailable."));
    expect(root.querySelector(".copilot-session .status")?.textContent).toBe("Cached");
    expect(root.querySelector(".copilot-session dl")).toBeNull();
    expect(root.querySelectorAll(".copilot-session-unavailable")).toHaveLength(1);
  });

  it("renders the full session ID as selectable text without interpreting HTML", async () => {
    const { root, semanticGroups, requestGroups } = await fixture();
    const sessionId = 'session-12345678-1234-1234-1234-123456789012"><img src=x>';
    semanticGroups.mockResolvedValue(groupResult([], {
      sessionId, models: [], inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null
    }));
    await requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".copilot-session code")?.textContent).toBe(sessionId));
    expect(root.querySelector(".copilot-session img")).toBeNull();
  });

  it("shows original generation iteration and timestamp in a top session card", async () => {
    const generation = { iterationId: 3, generatedAt: "2026-10-21T20:15:00.000Z" };
    const cached = vi.fn<CopilotGateway["cachedSemanticGroups"]>().mockResolvedValue(groupResult([], null, true, generation));
    const { root } = await fixture(false, true, vi.fn(), cached);
    await vi.waitFor(() => expect(root.querySelector("time")?.getAttribute("datetime")).toBe(generation.generatedAt));
    expect(root.querySelector(".copilot-generation")?.textContent).toContain("Iteration 3");
    expect(root.querySelector(".copilot-generation time")?.textContent).toBe(new Date(generation.generatedAt).toLocaleString());
    const groups = root.querySelector(".copilot-panel")!;
    expect(groups.firstElementChild?.className).toBe("copilot-session");
    expect(groups.querySelector(".copilot-health")).toBeNull();
    expect(groups.textContent).not.toContain("Local Copilot companion");
    const rail = root.querySelector(".rail")!;
    expect([...rail.children].map((element) => element.className)).toEqual(["header", "summary", "panel-tabs", "workspace"]);
    const metadata = root.querySelector(".header-meta")!;
    expect(metadata.querySelector(".subtitle")?.textContent).toBe("Iteration 3");
    expect(metadata.querySelector(".companion-toggle")).not.toBeNull();
  });

  it("keeps the connection status in the header while switching sidebar tabs", async () => {
    const { root } = await fixture(false, true);
    for (const tab of ["discussions", "groups", "discussions"]) {
      root.querySelector<HTMLButtonElement>(`[data-panel-tab="${tab}"]`)!.click();
      expect(root.querySelector(`[data-panel-tab="${tab}"]`)?.getAttribute("aria-selected")).toBe("true");
      expect(root.querySelector(`#${tab}-panel`)?.hasAttribute("hidden")).toBe(false);
      expect(root.querySelectorAll(".companion-toggle")).toHaveLength(1);
      expect(root.querySelector(".header-meta .companion-toggle")).not.toBeNull();
      expect(root.querySelector(".rail")?.children).toHaveLength(4);
    }
  });

  it("opens the Groups sidebar at the session details without generating or changing the group view", async () => {
    const cached = vi.fn<CopilotGateway["cachedSemanticGroups"]>().mockResolvedValue(groupResult([], null, true));
    const { root, semanticGroups, state, settings } = await fixture(false, true, vi.fn(), cached);
    await vi.waitFor(() => expect(root.querySelector(".copilot-session")).not.toBeNull());
    const originalView = { ...state.view };
    const workspace = root.querySelector<HTMLElement>(".workspace")!;
    workspace.scrollTop = 350;
    workspace.dispatchEvent(new Event("scroll"));
    panel!.openDiscussions();
    root.querySelector<HTMLButtonElement>(".close")!.click();
    panel!.openCopilotGroups();
    expect(root.querySelector(".rail")?.getAttribute("data-open")).toBe("true");
    expect(root.querySelector("#groups-tab")?.getAttribute("aria-selected")).toBe("true");
    expect(root.activeElement?.id).toBe("groups-tab");
    expect(root.querySelector(".workspace")!.scrollTop).toBe(0);
    expect(state.view).toEqual(originalView);
    expect(semanticGroups).not.toHaveBeenCalled();
    expect(cached).toHaveBeenCalledOnce();
    expect(root.querySelector(".dialog")).toBeNull();
    root.querySelector<HTMLButtonElement>(".close")!.click();
    panel!.updateSettings({ ...settings, features: { ...settings.features, copilotSemanticGroups: false } });
    panel!.openCopilotGroups();
    expect(root.querySelector(".rail")?.getAttribute("data-open")).toBe("false");
  });
});
