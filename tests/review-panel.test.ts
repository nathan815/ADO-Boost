// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AdoApi } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import { RuntimeCopilotGateway } from "../src/core/copilot-gateway";
import { AnnouncementService } from "../src/core/announcement";
import type { AnnouncementRecord, PullRequestAnalysis } from "../src/core/types";
import { RuntimeWriteGateway, type WriteGateway } from "../src/core/write-gateway";
import { defaultSettings } from "../src/features/registry";
import { MemorySettingsStorage, SettingsService } from "../src/features/settings-service";
import { ReviewPanel } from "../src/ui/review-panel";
import type { CopilotGateway } from "../src/core/copilot-gateway";
import type { SemanticGroupProposal } from "../src/core/types";
import * as adoNavigation from "../src/ui/ado-navigation";

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
      expect(error).toHaveBeenCalledWith("ADO Boost review completion check failed:", "Reviewer lookup failed (400)");
      expect(panel!.isReviewAnnounced()).toBe(true);
      expect(panel!.isReviewFinished()).toBe(false);
    } finally {
      error.mockRestore();
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
  async function fixture() {
    document.body.innerHTML = '<div class="region-content"><main class="repos-pr-details-page">Native PR content</main></div>';
    const settings = defaultSettings();
    settings.features.startReviewing = false;
    settings.features.threadNavigator = false;
    settings.features.copilotSemanticGroups = true;
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
    const semanticGroups = vi.fn<CopilotGateway["semanticGroups"]>();
    panel = new ReviewPanel({
      analysis, api, settings, store: new MemoryBrowserStore(),
      settingsService: new SettingsService(new MemorySettingsStorage()), reviewKey: "org/project/repo-id/7",
      writes: new RuntimeWriteGateway(),
      copilot: { semanticGroups, health: vi.fn(), chat: vi.fn() }, openSettings: vi.fn()
    });
    panel.openDiscussions();
    await vi.waitFor(() => expect(document.querySelector("[data-adopp-review-panel]")).not.toBeNull());
    await Promise.resolve();
    const root = document.querySelector("[data-adopp-review-panel]")!.shadowRoot!;
    const requestGroups = () => {
      root.querySelector<HTMLButtonElement>(".copilot-groups")!.click();
      root.querySelector<HTMLButtonElement>(".confirm-context")!.click();
    };
    return { root, analysis, semanticGroups, settings, requestGroups };
  }

  it("shows progress, renders safe group results including omitted files, and opens native files", async () => {
    const { root, semanticGroups, requestGroups, analysis } = await fixture();
    let complete!: (groups: SemanticGroupProposal[]) => void;
    semanticGroups.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    requestGroups();
    expect(root.querySelector(".copilot-groups")?.textContent).toBe("Grouping changes...");
    expect(root.querySelector<HTMLButtonElement>(".copilot-groups")?.disabled).toBe(true);
    await vi.waitFor(() => expect(semanticGroups).toHaveBeenCalledOnce());
    complete([{ title: "<img src=x>", rationale: "<script>explanation</script>", paths: ["/src/first.ts"] }]);
    await vi.waitFor(() => expect(root.querySelector(".copilot-results")).not.toBeNull());
    expect(root.querySelector(".copilot-results [role=status]")?.textContent).toContain("2 groups covering 2 changed files");
    expect(root.querySelectorAll(".copilot-result")).toHaveLength(2);
    expect(root.querySelector(".copilot-result summary")?.textContent).toContain("<img src=x>");
    expect(root.querySelector(".group-note")?.textContent).toBe("<script>explanation</script>");
    expect(root.querySelectorAll(".copilot-results script,.copilot-results img")).toHaveLength(0);
    expect(root.querySelector(".copilot-results")?.textContent).toContain("Unassigned changes");
    expect(root.querySelector(".copilot-groups")?.textContent).toBe("Regenerate semantic groups");
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

    semanticGroups.mockResolvedValue([{ title: "Updated", rationale: "New grouping", paths: analysis.files.map((file) => file.path) }]);
    requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".copilot-result summary")?.textContent).toContain("Updated"));
    expect(semanticGroups.mock.calls[1]?.[3]).toBe(true);
  });

  it("shows regeneration errors without losing previous results and hides groups when disabled", async () => {
    const { root, semanticGroups, requestGroups, settings } = await fixture();
    semanticGroups.mockResolvedValue([{ title: "Changes", rationale: "Related", paths: ["/src/first.ts"] }]);
    requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".copilot-results")).not.toBeNull());
    semanticGroups.mockRejectedValue(new Error("Companion disconnected"));
    requestGroups();
    await vi.waitFor(() => expect(root.querySelector(".delivery.error")?.textContent).toBe("Companion disconnected"));
    expect(root.querySelectorAll("[data-copilot-path]")).toHaveLength(2);
    expect(root.querySelector<HTMLButtonElement>(".copilot-groups")?.disabled).toBe(false);
    panel!.updateSettings({ ...settings, features: { ...settings.features, copilotSemanticGroups: false } });
    expect(root.querySelector(".copilot-results")).toBeNull();
  });
});
