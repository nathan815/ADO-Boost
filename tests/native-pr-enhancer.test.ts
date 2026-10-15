// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequest/7?_a=files"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativePrEnhancer } from "../src/content/native-pr-enhancer";
import type { PullRequestAnalysis } from "../src/core/types";
import { defaultSettings } from "../src/features/registry";
import type { TreeStatus } from "../src/native-tree/protocol";

const analysis: PullRequestAnalysis = {
  context: {
    origin: "https://dev.azure.com",
    organization: "org",
    project: "project",
    repository: "repo",
    repositoryId: "repo-id",
    pullRequestId: 7,
    title: "PR",
    sourceCommit: "source",
    targetCommit: "target",
    mergeBaseCommit: "base",
    iterationId: 3,
    identity: "identity",
    reviewer: { id: "me", displayName: "Me" }
  },
  files: [
    { trackingId: 1, path: "/src/app.ts", changeType: "edit", additions: 5, deletions: 2, state: "exact", generated: false, lockfile: false },
    { trackingId: 2, path: "/src/new.ts", changeType: "add", additions: 3, deletions: 1, state: "exact", generated: false, lockfile: false }
  ],
  groups: [],
  threads: { state: "available", active: 2, resolved: 1, total: 3 },
  completedTrackingIds: new Set()
};

let enhancer: NativePrEnhancer | null = null;

describe("NativePrEnhancer", () => {
  it("uses the native bridge by default without inserting badges or hiding native rows", () => {
    const settings = defaultSettings();
    settings.features.hideGenerated = true;
    const port = { status: null, configure: vi.fn(), stop: vi.fn(), subscribe: vi.fn(() => vi.fn()) };
    enhancer = new NativePrEnhancer(analysis, settings, {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    }, port);
    enhancer.start();
    expect(port.configure).toHaveBeenCalledWith({
      changeKind: "all", extension: "all", hideGenerated: true, hideLockfiles: false
    }, true);
    expect(document.querySelectorAll("[data-adopp-inline-stat],.adopp-native-hidden")).toHaveLength(0);
    expect(document.querySelector(".adopp-native-search")).toBeNull();
    expect(document.querySelector('[data-toggle="viewed"]')).toBeNull();
    expect(document.querySelector<HTMLElement>("[data-adopp-native-status]")?.hidden).toBe(true);
    expect(document.querySelector(".repos-compare-filter")?.nextElementSibling).toBe(document.querySelector("[data-adopp-native-toolbar]"));
    expect(document.querySelector(".file-tree-pane [data-adopp-native-toolbar]")).toBeNull();
    expect(document.querySelector("[data-adopp-total-file-count]")?.textContent).toBe("2 changed files");
    expect(document.querySelector(".adopp-native-summary")).toBeNull();
    settings.features.groupedNavigation = false;
    enhancer.updateSettings(settings);
    expect(port.stop).toHaveBeenCalled();
    expect(document.querySelectorAll("[data-adopp-inline-stat],.adopp-native-hidden")).toHaveLength(0);
    expect(document.querySelector("[data-adopp-native-toolbar]")).toBeNull();
    expect(document.querySelector("[data-adopp-next-unreviewed]")).toBeNull();
    expect(document.querySelector("[data-adopp-total-file-count]")).toBeNull();
    expect(document.querySelector("[data-adopp-original-file-count]")).toBeNull();
    settings.features.groupedNavigation = true;
    enhancer.updateSettings(settings);
    expect(port.configure).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".repos-compare-filter")?.nextElementSibling).toBe(document.querySelector("[data-adopp-native-toolbar]"));
  });

  it("shows matching and total PR counts through filtering, clearing, and empty results", () => {
    const settings = defaultSettings();
    const status: TreeStatus = {
      channel: "adopp-native-tree-v1", kind: "status", session: "16748ae6-f0a9-4dad-ac76-88e2bafc32c1",
      state: "active", detail: "Native model filtering and React-rendered counts are active.", fileCount: 2
    };
    let notify = () => {};
    const port = { status, configure: vi.fn(), stop: vi.fn(), subscribe: (listener: () => void) => {
      notify = listener;
      return vi.fn();
    } };
    enhancer = new NativePrEnhancer(analysis, settings, {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    }, port);
    enhancer.start();
    expect(document.querySelector("[data-adopp-total-file-count]")?.textContent).toBe("2 changed files");
    document.querySelector<HTMLButtonElement>('[data-choice-kind="change"][data-choice-value="add"]')!.click();
    expect(port.configure).toHaveBeenLastCalledWith({
      changeKind: "add", extension: "all", hideGenerated: false, hideLockfiles: false
    }, true);
    const original = document.querySelector<HTMLElement>(".native-changed-file-count")!;
    original.textContent = "1 changed file";
    status.fileCount = 1;
    notify();
    expect(original.hasAttribute("data-adopp-original-file-count")).toBe(true);
    expect(document.querySelector("[data-adopp-total-file-count]")?.textContent).toBe("1/2 changed files");
    expect(document.querySelector("[data-adopp-native-status]")?.textContent).toBe("");

    original.textContent = "0 changed files";
    status.fileCount = 0;
    document.querySelector(".repos-file-explorer-tree")?.remove();
    enhancer.refresh();
    notify();
    expect(document.querySelector(".repos-compare-filter")?.nextElementSibling).toBe(document.querySelector("[data-adopp-native-toolbar]"));
    expect(document.querySelector("[data-adopp-total-file-count]")?.textContent).toBe("0/2 changed files");
    expect(document.querySelectorAll('[data-choice-kind="change"]')).toHaveLength(5);

    status.fileCount = 2;
    notify();
    expect(document.querySelector("[data-adopp-total-file-count]")?.textContent).toBe("2/2 changed files");
    document.querySelector<HTMLButtonElement>('[data-choice-kind="change"][data-choice-value="all"]')!.click();
    expect(document.querySelector("[data-adopp-total-file-count]")?.textContent).toBe("2 changed files");
    status.filtersActive = true;
    notify();
    expect(document.querySelector("[data-adopp-total-file-count]")?.textContent).toBe("2/2 changed files");
    status.filtersActive = false;
    notify();
    expect(document.querySelector("[data-adopp-total-file-count]")?.textContent).toBe("2 changed files");

    enhancer.destroy();
    expect(original.hasAttribute("data-adopp-original-file-count")).toBe(false);
    expect(original.textContent).toBe("0 changed files");
    expect(document.querySelector("[data-adopp-total-file-count]")).toBeNull();
  });

  it("keeps normal native status quiet but exposes actionable compatibility failures", () => {
    const settings = defaultSettings();
    const status: TreeStatus = {
      channel: "adopp-native-tree-v1", kind: "status", session: "16748ae6-f0a9-4dad-ac76-88e2bafc32c1",
      state: "active", detail: "Native model filtering and React-rendered counts are active.", fileCount: 2
    };
    enhancer = new NativePrEnhancer(analysis, settings, {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    }, { status, configure: vi.fn(), stop: vi.fn(), subscribe: () => vi.fn() });
    enhancer.start();
    expect(document.querySelector<HTMLElement>("[data-adopp-native-status]")?.hidden).toBe(true);
    status.state = "comparison-mismatch";
    enhancer.refresh();
    const message = document.querySelector<HTMLElement>("[data-adopp-native-status]")!;
    expect(message.hidden).toBe(false);
    expect(message.textContent).toBe("Choose All Changes to use these filters");
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Filter by extension"]')?.disabled).toBe(true);
    status.state = "active";
    enhancer.refresh();
    expect(message.hidden).toBe(true);
    expect(message.textContent).toBe("");
  });

  it("reattaches inline controls and the total when ADO replaces the header", () => {
    const settings = defaultSettings();
    enhancer = new NativePrEnhancer(analysis, settings, {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    }, { status: null, configure: vi.fn(), stop: vi.fn(), subscribe: () => vi.fn() });
    enhancer.start();
    const header = document.querySelector<HTMLElement>(".native-file-controls")!;
    const replacement = header.cloneNode(true) as HTMLElement;
    replacement.querySelector("[data-adopp-native-toolbar]")?.remove();
    replacement.querySelector("[data-adopp-total-file-count]")?.remove();
    replacement.querySelector("[data-adopp-original-file-count]")?.removeAttribute("data-adopp-original-file-count");
    header.replaceWith(replacement);
    enhancer.refresh();
    expect(document.querySelectorAll("[data-adopp-native-toolbar]")).toHaveLength(1);
    expect(replacement.querySelector(".repos-compare-filter")?.nextElementSibling).toBe(replacement.querySelector("[data-adopp-native-toolbar]"));
    expect(replacement.querySelector("[data-adopp-total-file-count]")?.textContent).toBe("2 changed files");
    enhancer.destroy();
    expect(replacement.querySelector("[data-adopp-original-file-count]")).toBeNull();
  });

  beforeEach(() => {
    history.replaceState({}, "", "/org/project/_git/repo/pullrequest/7?_a=files");
    document.head.innerHTML = "";
    document.body.innerHTML = `
      <div class="pr-header-shell">
        <div class="pr-header-row">
          <div class="title-slot"><input aria-label="Pull request title" value="PR title"></div>
          <div class="actions">
            <div class="repos-pr-header-vote-button bolt-split-button flex-stretch inline-flex-row">
              <button class="bolt-button enabled bolt-focus-treatment"><span class="bolt-button-text">Approve</span></button>
              <div class="bolt-split-button-divider flex-noshrink" style="width: 1px; background-color: rgb(91, 95, 102); opacity: 0.8"></div>
              <div class="inline-flex-row">
                <button class="bolt-split-button-option bolt-button bolt-icon-button enabled icon-only bolt-focus-treatment" aria-label="More vote options" aria-controls="approve-menu" data-command="approve-options"><span class="fabric-icon ms-Icon--ChevronDownSmall"></span></button>
              </div>
            </div>
          </div>
        </div>
        <div class="pr-metadata">
          <span class="status">Active</span>
          <span class="pr-id">!7</span>
          <span class="proposal">Me proposes to merge source into main</span>
        </div>
      </div>
      <div class="page-layout">
        <aside class="project-navigation">Project navigation</aside>
        <section data-file-pane>
          <div class="native-file-controls">
            <button class="bolt-button enabled subtle flex-row flex-center bolt-focus-treatment body-s">
              <span class="bolt-button-text">All Changes</span>
              <span class="fabric-icon ms-Icon--ChevronDownSmall native-chevron"></span>
            </button>
            <div class="repos-compare-filter"><button class="bolt-button">Filter</button></div>
            <span class="native-changed-file-count body-m">2 changed files</span>
            <div class="native-difference-navigation">
              <button class="bolt-button bolt-icon-button enabled icon-only bolt-focus-treatment" aria-label="Previous difference"><span class="fabric-icon ms-Icon--ChevronUpSmall"></span></button>
              <button class="bolt-button bolt-icon-button enabled icon-only bolt-focus-treatment" aria-label="Next difference"><span class="fabric-icon ms-Icon--ChevronDownSmall"></span></button>
            </div>
            <div class="overview-actions">
              <div class="bolt-split-button view-mode"><button class="bolt-button"><span class="bolt-button-text">Side-by-side</span></button><button class="bolt-button bolt-icon-button"><span class="fabric-icon ms-Icon--ChevronDownSmall"></span></button></div>
              <button class="bolt-button bolt-icon-button enabled icon-only bolt-focus-treatment" aria-label="Full screen"><span class="fabric-icon ms-Icon--FullScreen"></span></button>
            </div>
          </div>
          <div class="file-tree-pane" data-file-tree-pane>
            <label><input type="checkbox" aria-label="Mark as reviewed"></label>
            <div class="bolt-table-container flex-grow v-scroll-auto">
              <table class="repos-changes-explorer tree repos-file-explorer-tree body bolt-table bolt-list">
                <tbody>
                  <tr role="row" data-row="app"><td><div role="row"><input type="checkbox" checked><button>app.ts</button></div></td></tr>
                  <tr role="row" data-row="new"><td><div role="row"><input type="checkbox"><button>new.ts</button></div></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>`;
  });

  afterEach(() => {
    enhancer?.destroy();
    enhancer = null;
  });

  it("copies only the numeric PR ID and preserves the native label on cleanup", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const host = document.querySelector(".pr-id")!;
    const original = host.firstChild;
    enhancer = new NativePrEnhancer(analysis, defaultSettings(), {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    }, createNativePort(), clipboard);
    enhancer.start();
    enhancer.refresh();
    const button = host.querySelector<HTMLButtonElement>("button")!;
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(button.textContent).toBe("!7");
    expect(button.getAttribute("aria-label")).toBe("Copy PR ID 7");
    button.click();
    expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith("7");
    await vi.waitFor(() => expect(host.querySelector('[role="status"]')?.textContent).toBe(" Copied"));
    expect(button.disabled).toBe(false);
    enhancer.destroy();
    expect(host.firstChild).toBe(original);
    expect(host.textContent).toBe("!7");
    expect(host.querySelector("button")).toBeNull();
  });

  it("reports clipboard errors and allows retrying", async () => {
    const error = new Error("Clipboard access denied");
    const clipboard = { writeText: vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined) };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      enhancer = new NativePrEnhancer(analysis, defaultSettings(), {
        openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
      }, createNativePort(), clipboard);
      enhancer.start();
      const button = document.querySelector<HTMLButtonElement>("[data-adopp-copy-pr-id]")!;
      button.click();
      await vi.waitFor(() => expect(document.querySelector("[data-adopp-copy-pr-feedback]")?.textContent).toContain("Could not copy"));
      expect(log).toHaveBeenCalledWith("ADO Boost could not copy PR ID", error);
      button.click();
      await vi.waitFor(() => expect(document.querySelector("[data-adopp-copy-pr-feedback]")?.textContent).toBe(" Copied"));
      expect(clipboard.writeText).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });

  it("reattaches the copy control when ADO replaces PR metadata", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    enhancer = new NativePrEnhancer(analysis, defaultSettings(), {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    }, createNativePort(), clipboard);
    enhancer.start();
    document.querySelector(".pr-metadata")!.innerHTML = '<span class="status">Completed</span><span class="pr-id">!7</span>';
    enhancer.refresh();
    const button = document.querySelector<HTMLButtonElement>("[data-adopp-copy-pr-id]")!;
    button.click();
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith("7"));
    expect(document.querySelectorAll("[data-adopp-copy-pr-id]")).toHaveLength(1);
  });

  it("shows partial totals and retained unresolved changes without blocking the native UI", () => {
    enhancer = new NativePrEnhancer({
      ...analysis,
      unresolvedChanges: Array.from({ length: 6 }, () => ({ unresolved: true, raw: { item: { path: null } }, detail: "No usable file path" }))
    }, defaultSettings(), {
      openDiscussions: vi.fn(),
      startReviewing: vi.fn(),
      isReviewAnnounced: () => false,
      openSettings: vi.fn()
    });
    enhancer.start();
    const total = document.querySelector<HTMLElement>("[data-adopp-total-diff]")!;
    expect(total.dataset.exact).toBe("false");
    expect(total.textContent).toContain("+8");
    expect(total.textContent).toContain("partial");
    expect(total.getAttribute("aria-label")).toContain("6 file counts are incomplete");
    total.dispatchEvent(new MouseEvent("mouseenter"));
    expect(document.querySelector("[data-adopp-total-diff-popover]")?.textContent).toContain("Unresolved changes (retained)");
    expect(document.querySelector(".adopp-start-split")).not.toBeNull();
    expect(document.querySelector("[data-adopp-total-file-count]")?.textContent).toBe("8 changed files");
  });

  it("integrates totals into PR metadata and review actions beside Approve", () => {
    const openDiscussions = vi.fn();
    enhancer = createEnhancer({ openDiscussions });
    enhancer.start();

    const actions = document.querySelector(".actions")!;
    const status = document.querySelector(".status")!;
    const total = document.querySelector("[data-adopp-total-diff]")!;
    expect(total.previousElementSibling).toBe(status);
    expect(total.textContent).toContain("+8");
    expect(total.textContent).toContain("−3");
    expect(getComputedStyle(total).borderRadius).toBe("5px");
    (total as HTMLElement).getBoundingClientRect = () => ({ x: 80, y: 40, top: 40, right: 148, bottom: 64, left: 80, width: 68, height: 24, toJSON: () => ({}) });
    total.dispatchEvent(new MouseEvent("mouseenter"));
    const diffPopover = document.querySelector<HTMLElement>("[data-adopp-total-diff-popover]")!;
    expect(diffPopover.textContent).toContain("2 files changed");
    expect(diffPopover.textContent).toContain("Added");
    expect(diffPopover.textContent).toContain("1");
    expect(diffPopover.textContent).toContain("Removed");
    expect(diffPopover.textContent).toContain("0");
    expect(diffPopover.textContent).toContain("Edited");
    expect(diffPopover.textContent).toContain("Renamed");
    expect(diffPopover.getAttribute("role")).toBe("tooltip");
    total.dispatchEvent(new MouseEvent("mouseleave"));
    expect(document.querySelector("[data-adopp-total-diff-popover]")).toBeNull();
    expect(actions.textContent).not.toContain("ADO Boost");
    expect(actions.textContent).toContain("Start Review");
    expect(document.querySelector(".adopp-start-split")?.getAttribute("data-review-started")).toBe("false");
    expect(document.querySelectorAll(".adopp-start-review-icon path")).toHaveLength(1);
    expect(document.querySelectorAll(".adopp-start-review-icon circle")).toHaveLength(1);
    expect([...actions.children].at(-1)?.textContent?.trim()).toBe("Approve");
    const hiddenProposalText = document.querySelector<HTMLElement>("[data-adopp-merge-proposal-text]")!;
    expect(hiddenProposalText.textContent).toBe("·");
    expect(hiddenProposalText.dataset.adoppOriginalText).toBe("proposes to merge");
    expect(getComputedStyle(hiddenProposalText).display).toBe("inline-block");
    expect(document.querySelector(".adopp-start-split")?.classList.contains("bolt-split-button")).toBe(true);
    expect(document.querySelector(".adopp-start-split")?.classList.contains("repos-pr-header-vote-button")).toBe(true);
    expect(document.querySelectorAll(".adopp-start-split > .bolt-split-button-divider")).toHaveLength(1);
    const clonedDivider = document.querySelector<HTMLElement>(".adopp-start-split > .bolt-split-button-divider")!;
    expect(Number.parseFloat(getComputedStyle(clonedDivider).width)).toBe(0.5);
    expect(Number.parseFloat(getComputedStyle(clonedDivider).flexBasis)).toBe(0.5);
    expect(document.querySelector(".adopp-start-split > .inline-flex-row > .adopp-action-menu-button")).not.toBeNull();
    expect(document.querySelector(".adopp-action-menu-button .ms-Icon--ChevronDownSmall")).not.toBeNull();
    expect(document.querySelector(".adopp-action-menu-button")?.hasAttribute("aria-controls")).toBe(false);
    expect(document.querySelector(".adopp-action-menu-button")?.hasAttribute("data-command")).toBe(false);

    const startSplit = document.querySelector<HTMLElement>(".adopp-start-split")!;
    startSplit.getBoundingClientRect = () => ({ x: 100, y: 50, top: 50, right: 333, bottom: 98, left: 100, width: 233, height: 48, toJSON: () => ({}) });
    document.querySelector<HTMLButtonElement>(".adopp-action-menu-button")?.click();
    const actionMenu = document.querySelector<HTMLElement>(".adopp-action-menu")!;
    expect(actionMenu.querySelector(".bolt-menu .bolt-list")).not.toBeNull();
    expect(Number.parseFloat(actionMenu.style.width)).toBeGreaterThan(233);
    expect(Number.parseFloat(actionMenu.style.width)).toBeLessThanOrEqual(320);
    expect(actionMenu.style.maxWidth).toBe(actionMenu.style.width);
    expect(startSplit.dataset.menuOpen).toBe("true");
    expect(startSplit.querySelector(".adopp-start-button")?.classList.contains("active")).toBe(false);
    expect(startSplit.querySelector(".adopp-action-menu-button")?.classList.contains("active")).toBe(true);
    expect(startSplit.querySelector(".adopp-action-menu-button")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("replaces stale injected styles when the extension remounts", () => {
    const staleStyle = document.createElement("style");
    staleStyle.id = "adopp-native-styles";
    staleStyle.textContent = ".adopp-action-menu-button::before{width:1px}";
    document.head.append(staleStyle);

    enhancer = createEnhancer();
    enhancer.start();

    expect(staleStyle.textContent).not.toContain(".adopp-action-menu-button::before");
    expect(staleStyle.textContent).toContain(".adopp-total-diff");
  });

  it("starts an unannounced review, then opens the assistant after the announcement", () => {
    let announced = false;
    const startReviewing = vi.fn();
    const openDiscussions = vi.fn();
    enhancer = createEnhancer({ startReviewing, openDiscussions, isReviewAnnounced: () => announced });
    enhancer.start();

    document.querySelector<HTMLButtonElement>(".adopp-start-button")!.click();
    expect(startReviewing).toHaveBeenCalledOnce();
    expect(openDiscussions).not.toHaveBeenCalled();

    announced = true;
    window.dispatchEvent(new CustomEvent("adopp:announcement-changed"));

    const button = document.querySelector<HTMLButtonElement>(".adopp-start-button")!;
    expect(button.textContent).toContain("Review Assistant");
    expect(button.getAttribute("aria-label")).toBe("Review Assistant");
    expect(button.disabled).toBe(false);
    expect(document.querySelector<HTMLElement>(".adopp-start-split")!.dataset.reviewStarted).toBe("true");
    button.click();
    expect(openDiscussions).toHaveBeenCalledOnce();
    expect(startReviewing).toHaveBeenCalledOnce();
    expect(getComputedStyle(document.querySelector(".adopp-start-split")!).boxShadow).toContain("0 1px 2px");
  });

  it.each([false, true])("opens the assistant for an already-started review when announcements are enabled=%s", (enabled) => {
    const openDiscussions = vi.fn();
    enhancer = createEnhancer({ isReviewAnnounced: () => true, openDiscussions });
    const settings = defaultSettings();
    settings.features.startReviewing = enabled;
    enhancer.updateSettings(settings);
    enhancer.start();

    const button = document.querySelector<HTMLButtonElement>(".adopp-start-button")!;
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("Review Assistant");
    button.click();
    expect(openDiscussions).toHaveBeenCalledOnce();
  });

  it.each([false, true])("shows an elevated assistant on completed PRs without Approve when announced=%s", (announced) => {
    document.querySelector(".status")!.textContent = "Completed";
    document.querySelector(".actions")!.innerHTML = '<button class="bolt-button enabled bolt-focus-treatment">Reactivate</button>';
    const startReviewing = vi.fn();
    const openDiscussions = vi.fn();
    enhancer = createEnhancer({ startReviewing, openDiscussions, isReviewAnnounced: () => announced });
    const settings = defaultSettings();
    settings.features.startReviewing = false;
    enhancer.updateSettings(settings);
    enhancer.start();
    enhancer.refresh();

    const button = document.querySelector<HTMLButtonElement>(".adopp-start-button")!;
    expect(document.querySelectorAll("[data-adopp-action-group]")).toHaveLength(1);
    expect(button.textContent).toContain("Review Assistant");
    expect(button.disabled).toBe(false);
    expect(button.hidden).toBe(false);
    button.click();
    expect(openDiscussions).toHaveBeenCalledOnce();
    expect(startReviewing).not.toHaveBeenCalled();
    expect(document.querySelector(".actions")!.textContent).toContain("Reactivate");
    expect(document.querySelectorAll(".adopp-start-split > .bolt-split-button-divider")).toHaveLength(1);
    expect(getComputedStyle(document.querySelector(".adopp-start-split")!).boxShadow).toContain("0 1px 2px");
    document.querySelector<HTMLButtonElement>(".adopp-action-menu-button")!.click();
    expect(document.querySelector(".adopp-action-menu")).not.toBeNull();
  });

  it("mounts on completed PRs with an empty native header command bar", () => {
    document.querySelector(".status")!.textContent = "Completed";
    const actions = document.querySelector<HTMLElement>(".actions")!;
    actions.replaceChildren();
    actions.classList.add("bolt-header-commandbar");
    enhancer = createEnhancer();
    enhancer.start();
    enhancer.refresh();

    expect(actions.querySelector(".adopp-start-button")!.textContent).toContain("Review Assistant");
    expect(actions.querySelectorAll("[data-adopp-action-group]")).toHaveLength(1);
  });

  it("switches to the assistant when a PR completes and Approve is removed", () => {
    enhancer = createEnhancer();
    enhancer.start();
    document.querySelector(".status")!.textContent = "Completed";
    document.querySelector(".actions > .repos-pr-header-vote-button")!.remove();
    document.querySelector(".actions")!.insertAdjacentHTML("beforeend", '<button class="bolt-button">Reactivate</button>');
    enhancer.refresh();

    expect(document.querySelector(".adopp-start-button")!.textContent).toContain("Review Assistant");
    expect(document.querySelectorAll("[data-adopp-action-group]")).toHaveLength(1);
  });

  it("does not mount into unrelated page actions when the native PR header is absent", () => {
    document.querySelector(".pr-header-shell")!.remove();
    enhancer = createEnhancer();
    enhancer.start();

    expect(document.querySelector("[data-adopp-action-group]")).toBeNull();
  });

  it("overrides the native blue divider with a theme-aware neutral color", () => {
    const nativeDivider = document.querySelector<HTMLElement>(".bolt-split-button-divider")!;
    nativeDivider.style.backgroundColor = "rgb(0, 120, 212)";
    enhancer = createEnhancer();
    enhancer.start();

    const style = document.querySelector<HTMLStyleElement>("#adopp-native-styles")!;
    const dividerRule = [...style.sheet!.cssRules].find((rule): rule is CSSStyleRule =>
      rule instanceof CSSStyleRule
      && rule.selectorText === ".adopp-start-split>.bolt-split-button-divider"
      && rule.style.getPropertyValue("background") !== ""
    )!;
    expect(dividerRule.style.getPropertyValue("background")).toBe("rgba(var(--palette-neutral-100,0,0,0),.18)");
    expect(style.textContent).toContain("background:rgba(var(--palette-neutral-100,0,0,0),.18) !important");
    expect(dividerRule.style.getPropertyValue("opacity")).toBe("1");
    expect(dividerRule.style.getPropertyPriority("opacity")).toBe("important");
    expect(nativeDivider.style.backgroundColor).toBe("rgb(0, 120, 212)");
  });

  it("shows renamed files and relevant review-risk details in the diff popover", () => {
    const detailedAnalysis: PullRequestAnalysis = {
      ...analysis,
      files: [
        ...analysis.files,
        { trackingId: 3, path: "/src/renamed.ts", originalPath: "/src/old.ts", changeType: "rename, edit", additions: 2, deletions: 1, state: "exact", generated: false, lockfile: false },
        { trackingId: 4, path: "/dist/app.js", changeType: "edit", additions: null, deletions: null, state: "binary", generated: true, lockfile: false },
        { trackingId: 5, path: "/package-lock.json", changeType: "edit", additions: 1, deletions: 1, state: "exact", generated: false, lockfile: true }
      ]
    };
    enhancer = new NativePrEnhancer(detailedAnalysis, defaultSettings(), {
      openDiscussions: vi.fn(),
      startReviewing: vi.fn(),
      isReviewAnnounced: () => false,
      openSettings: vi.fn()
    });
    enhancer.start();

    const total = document.querySelector<HTMLElement>("[data-adopp-total-diff]")!;
    total.dispatchEvent(new MouseEvent("mouseenter"));
    const rows = [...document.querySelectorAll<HTMLElement>(".adopp-total-popover-row")]
      .map((row) => row.textContent?.replace(/\s+/g, " ").trim());
    expect(rows).toEqual([
      "Added1",
      "Removed0",
      "Edited3",
      "Renamed1",
      "Generated1",
      "Lockfiles1",
      "Binary1"
    ]);
  });

  it("moves the complete action bar to a second row when the title cannot fit", () => {
    const header = document.querySelector<HTMLElement>(".pr-header-row")!;
    const title = document.querySelector<HTMLInputElement>('[aria-label="Pull request title"]')!;
    const titleSlot = document.querySelector<HTMLElement>(".title-slot")!;
    const actions = document.querySelector<HTMLElement>(".actions")!;
    Object.defineProperty(header, "clientWidth", { configurable: true, value: 700 });
    Object.defineProperty(title, "scrollWidth", { configurable: true, value: 420 });
    Object.defineProperty(titleSlot, "scrollWidth", { configurable: true, value: 420 });
    Object.defineProperty(actions, "scrollWidth", { configurable: true, value: 360 });

    enhancer = createEnhancer();
    enhancer.start();

    expect(header.classList.contains("adopp-header-wrap")).toBe(true);
    expect(header.classList.contains("adopp-header-actions-wrapped")).toBe(true);
    expect(actions.classList.contains("adopp-header-action-item")).toBe(true);
    expect(actions.querySelector("[data-adopp-action-group]")).not.toBeNull();
    expect(actions.querySelector(".repos-pr-header-vote-button")).not.toBeNull();
  });

  it("renders regular inline filter controls and forwards options to the native model", () => {
    const port = createNativePort();
    enhancer = createEnhancer({}, port);
    enhancer.start();
    enhancer.refresh();

    expect(document.querySelectorAll("[data-adopp-inline-stat],.adopp-native-hidden")).toHaveLength(0);
    expect(document.querySelector(".repos-compare-filter")?.nextElementSibling).toBe(document.querySelector("[data-adopp-native-toolbar]"));
    expect(document.querySelector("select.adopp-native-change")).toBeNull();
    expect(document.querySelector('[data-dropdown="change"] .bolt-button')).not.toBeNull();
    expect(document.querySelector('[data-dropdown="extension"] .bolt-button')).not.toBeNull();
    expect(document.querySelector('[data-dropdown="change"] .adopp-native-dropdown-trigger')?.textContent).toContain("Change type");
    expect(document.querySelector('[data-dropdown="change"] .adopp-native-dropdown-trigger')?.getAttribute("title")).toBe("Change type");
    expect(document.querySelector('[data-choice-kind="change"][data-choice-value="all"]')?.textContent).toContain("Any change");
    expect(document.querySelectorAll('[data-dropdown="change"] .adopp-native-dropdown-chevron')).toHaveLength(1);
    expect(document.querySelector('[data-adopp-native-toolbar] [data-adopp-next-unreviewed]')).toBeNull();
    const nextDifference = document.querySelector<HTMLButtonElement>('[aria-label="Next difference"]')!;
    const nextUnreviewed = document.querySelector<HTMLButtonElement>("[data-adopp-next-unreviewed]")!;
    expect(nextUnreviewed.previousElementSibling).toBe(nextDifference);
    expect(nextUnreviewed.parentElement).toBe(nextDifference.parentElement);
    expect(nextUnreviewed.hasAttribute("title")).toBe(false);
    nextUnreviewed.dispatchEvent(new MouseEvent("mouseenter"));
    expect(document.querySelector(".bolt-tooltip .bolt-tooltip-content")?.textContent).toBe("Next unreviewed file");
    expect(document.querySelector(".bolt-tooltip [role='tooltip']")).not.toBeNull();
    nextUnreviewed.dispatchEvent(new MouseEvent("mouseleave"));
    expect(document.querySelector("[data-adopp-tooltip]")).toBeNull();
    expect(document.querySelector("[data-adopp-total-file-count]")?.textContent).toBe("2 changed files");
    expect(document.querySelector(".adopp-native-summary")).toBeNull();
    expect(document.querySelectorAll("[data-adopp-next-unreviewed]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-adopp-next-unreviewed] .adopp-nav-double-icon path")).toHaveLength(2);

    const filterTrigger = document.querySelector<HTMLButtonElement>(".adopp-native-filter-trigger");
    filterTrigger!.getBoundingClientRect = () => ({ x: 100, y: 50, top: 50, right: 218, bottom: 94, left: 100, width: 118, height: 44, toJSON: () => ({}) });
    filterTrigger?.click();
    expect(filterTrigger?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector<HTMLElement>(".adopp-native-filter-menu")?.hidden).toBe(false);
    expect(document.querySelector(".adopp-native-filter-menu")?.parentElement).toBe(document.body);
    expect(document.querySelector(".adopp-native-filter-menu")?.getAttribute("data-adopp-filter-portal")).toBe("true");
    expect(Number.parseFloat(document.querySelector<HTMLElement>(".adopp-native-filter-menu")!.style.width)).toBeGreaterThan(118);
    expect(Number.parseFloat(document.querySelector<HTMLElement>(".adopp-native-filter-menu")!.style.width)).toBeLessThanOrEqual(320);
    expect(getComputedStyle(document.querySelector<HTMLElement>(".adopp-native-filter-menu")!).overflow).toBe("hidden");

    expect(document.querySelector('[data-toggle="viewed"]')).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-toggle="generated"]')!.click();
    expect(port.configure).toHaveBeenLastCalledWith({
      changeKind: "all", extension: "all", hideGenerated: true, hideLockfiles: false
    }, true);
    expect(document.querySelector(".adopp-native-filter-trigger")?.textContent).toContain("Options (1)");
    expect(document.querySelectorAll(".adopp-native-hidden")).toHaveLength(0);
  });

  it("does not copy transient iteration-button styling into filter triggers", () => {
    const nativeButton = document.querySelector<HTMLButtonElement>(".native-file-controls .bolt-button")!;
    nativeButton.classList.add("active", "primary", "selected");
    nativeButton.style.backgroundColor = "white";
    nativeButton.style.color = "white";
    nativeButton.setAttribute("aria-pressed", "true");
    nativeButton.querySelector(".ms-Icon--ChevronDownSmall")?.remove();
    enhancer = createEnhancer();
    enhancer.start();

    for (const trigger of document.querySelectorAll<HTMLButtonElement>(".adopp-native-dropdown-trigger")) {
      expect(trigger.classList.contains("active")).toBe(false);
      expect(trigger.classList.contains("primary")).toBe(false);
      expect(trigger.classList.contains("selected")).toBe(false);
      expect(trigger.getAttribute("style")).toBeNull();
      expect(trigger.hasAttribute("aria-pressed")).toBe(false);
      expect(trigger.classList.contains("bolt-button")).toBe(true);
      expect(trigger.classList.contains("subtle")).toBe(false);
      expect(trigger.querySelectorAll(".adopp-native-dropdown-chevron")).toHaveLength(1);
    }
  });

  it("counts the complete analyzed file list rather than currently rendered rows", () => {
    const comparisonAnalysis: PullRequestAnalysis = {
      ...analysis,
      files: [
        ...analysis.files,
        { trackingId: 3, path: "/src/later.ts", changeType: "add", additions: 4, deletions: 0, state: "exact", generated: false, lockfile: false }
      ]
    };
    enhancer = new NativePrEnhancer(comparisonAnalysis, defaultSettings(), {
      openDiscussions: vi.fn(),
      startReviewing: vi.fn(),
      isReviewAnnounced: () => false,
      openSettings: vi.fn()
    });
    enhancer.start();

    expect(document.querySelector("[data-adopp-total-file-count]")?.textContent).toBe("3 changed files");
    expect(document.querySelector(".adopp-native-reviewed-count")).toBeNull();
  });

  it("keeps full-PR counts stable regardless of virtualized rows", () => {
    const files = Array.from({ length: 422 }, (_, index) => ({
      ...analysis.files[0]!, trackingId: index + 1, path: `/src/file-${index}.ts`
    }));
    const tbody = document.querySelector("tbody")!;
    const port = createNativePort(files.length);
    enhancer = new NativePrEnhancer({ ...analysis, files }, defaultSettings(), {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    }, port);
    enhancer.start();
    const toolbar = document.querySelector("[data-adopp-native-toolbar]");
    const count = document.querySelector("[data-adopp-total-file-count]")!;
    const totals = document.querySelector("[data-adopp-total-diff]")?.textContent;
    expect(count.textContent).toBe("422 changed files");
    document.querySelector<HTMLButtonElement>('[data-choice-kind="extension"][data-choice-value="ts"]')!.click();
    expect(port.configure).toHaveBeenLastCalledWith({
      changeKind: "all", extension: "ts", hideGenerated: false, hideLockfiles: false
    }, true);
    port.status.fileCount = 1;
    tbody.replaceChildren();
    enhancer.refresh();
    expect(document.querySelector("[data-adopp-native-toolbar]")).toBe(toolbar);
    expect(count.textContent).toBe("1/422 changed files");
    tbody.innerHTML = '<tr role="row"><td><button>file-421.ts</button></td></tr>';
    const nativeMarkup = tbody.innerHTML;
    enhancer.refresh();
    expect(tbody.innerHTML).toBe(nativeMarkup);
    expect(count.textContent).toBe("1/422 changed files");
    expect(document.querySelector("[data-adopp-total-diff]")?.textContent).toBe(totals);
  });

  it("leaves file rows, discussions, and collapsed folders untouched when filters change", () => {
    const appRow = document.querySelector<HTMLElement>('[data-row="app"]')!;
    appRow.insertAdjacentHTML("afterend", `
      <tr role="row" aria-level="2" aria-expanded="true" data-row="unmatched"><td>main.yml</td></tr>
      <tr role="row" aria-level="3" data-annotation="unmatched"><td>Review discussion</td></tr>
      <tr role="row" aria-level="1" aria-expanded="false" data-folder="collapsed"><td>other</td></tr>
    `);
    const nativeMarkup = document.querySelector("tbody")!.innerHTML;
    const port = createNativePort();
    enhancer = createEnhancer({}, port);
    enhancer.start();
    document.querySelector<HTMLButtonElement>('[data-choice-kind="change"][data-choice-value="add"]')!.click();
    enhancer.refresh();
    expect(document.querySelector("tbody")!.innerHTML).toBe(nativeMarkup);
    expect(port.configure).toHaveBeenLastCalledWith({
      changeKind: "add", extension: "all", hideGenerated: false, hideLockfiles: false
    }, true);
    enhancer.destroy();
    expect(document.querySelector("tbody")!.innerHTML).toBe(nativeMarkup);
  });

  it("disables extra controls without a DOM fallback when native integration is unavailable", () => {
    const port = createNativePort();
    port.status.state = "unavailable";
    const nativeMarkup = document.querySelector("tbody")!.innerHTML;
    enhancer = createEnhancer({}, port);
    enhancer.start();
    enhancer.refresh();
    expect(document.querySelector("[data-adopp-native-status]")?.textContent).toBe("File filters unavailable");
    for (const trigger of document.querySelectorAll<HTMLButtonElement>(".adopp-native-dropdown-trigger")) {
      expect(trigger.disabled).toBe(true);
    }
    expect(document.querySelector("tbody")!.innerHTML).toBe(nativeMarkup);
    expect(document.querySelectorAll("[data-adopp-inline-stat]")).toHaveLength(0);
    expect(document.querySelectorAll(".adopp-native-hidden")).toHaveLength(0);
  });

  it("uses native folder hierarchy for read-only navigation between repeated filenames", () => {
    document.querySelector("tbody")!.innerHTML = `
      <tr role="row" aria-level="1" aria-expanded="true"><td>src</td></tr>
      <tr role="row" aria-level="2" aria-expanded="true"><td>one/tasks</td></tr>
      <tr role="row" aria-level="3" aria-selected="true" data-row="first"><td><button><span>main.yml</span><span data-adopp-react-stat="/src/one/tasks/main.yml">+5 −2</span></button></td></tr>
      <tr role="row" aria-level="2" aria-expanded="true"><td>two</td></tr>
      <tr role="row" aria-level="3" data-row="second"><td><button><span>main.yml</span><span data-adopp-react-stat="/src/two/main.yml">+3 −1</span></button></td></tr>
    `;
    const navigated = vi.fn();
    document.querySelector('[data-row="second"]')!.addEventListener("click", navigated);
    enhancer = new NativePrEnhancer({
      ...analysis,
      files: [
        { ...analysis.files[0]!, path: "/src/one/tasks/main.yml" },
        { ...analysis.files[1]!, path: "/src/two/main.yml" }
      ]
    }, defaultSettings(), {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    });
    enhancer.start();
    document.querySelector<HTMLButtonElement>("[data-adopp-next-unreviewed]")!.click();
    expect(navigated).toHaveBeenCalledOnce();
    expect(document.querySelectorAll("[data-adopp-inline-stat],.adopp-native-hidden")).toHaveLength(0);
  });

  it("matches repeated and truncated filenames using full-path labels", () => {
    document.querySelector("tbody")!.innerHTML = `
      <tr role="row" aria-selected="true" data-row="first"><td><button title="/src/one/main.yml">main.yml</button></td></tr>
      <tr role="row" data-row="second"><td><button title="/src/two/main.yml">main...</button></td></tr>
    `;
    const navigated = vi.fn();
    document.querySelector('[data-row="second"]')!.addEventListener("click", navigated);
    enhancer = new NativePrEnhancer({
      ...analysis,
      files: [
        { ...analysis.files[0]!, path: "/src/one/main.yml" },
        { ...analysis.files[1]!, path: "/src/two/main.yml" }
      ]
    }, defaultSettings(), {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    });
    enhancer.start();
    enhancer.refresh();
    document.querySelector<HTMLButtonElement>("[data-adopp-next-unreviewed]")!.click();
    expect(navigated).toHaveBeenCalledOnce();
    expect(document.querySelectorAll("[data-adopp-inline-stat],.adopp-native-hidden")).toHaveLength(0);
  });

  it("navigates to the next unreviewed file through the native row button", () => {
    const navigated = vi.fn();
    document.querySelector<HTMLElement>('[data-row="new"] [role="row"]')?.addEventListener("click", navigated);
    enhancer = createEnhancer();
    enhancer.start();

    document.querySelector<HTMLButtonElement>("[data-adopp-next-unreviewed]")?.click();

    expect(navigated).toHaveBeenCalledOnce();
  });

  it("places next unreviewed beside the view mode control when no file is selected", () => {
    document.querySelector(".native-difference-navigation")?.remove();
    enhancer = createEnhancer();
    enhancer.start();

    const viewMode = document.querySelector<HTMLElement>(".view-mode")!;
    const nextUnreviewed = document.querySelector<HTMLElement>("[data-adopp-next-unreviewed]")!;
    expect(nextUnreviewed.previousElementSibling).toBe(viewMode);
    expect(nextUnreviewed.nextElementSibling?.getAttribute("aria-label")).toBe("Full screen");
    expect(nextUnreviewed.dataset.adoppMount).toBe("overview");
  });

  it("uses the native selected row when finding the next unreviewed file", () => {
    const appRow = document.querySelector<HTMLElement>('[data-row="app"]')!;
    const newRow = document.querySelector<HTMLElement>('[data-row="new"]')!;
    const nextNavigated = vi.fn();
    const appCheckbox = appRow.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    appCheckbox.checked = false;
    appRow.setAttribute("aria-selected", "true");
    newRow.querySelector<HTMLElement>('[role="row"]')?.addEventListener("click", nextNavigated);
    enhancer = createEnhancer();
    enhancer.start();

    document.querySelector<HTMLButtonElement>("[data-adopp-next-unreviewed]")?.click();
    expect(nextNavigated).toHaveBeenCalledOnce();
  });

  it("navigates in the file tree's rendered order instead of API order", () => {
    const appRow = document.querySelector<HTMLElement>('[data-row="app"]')!;
    const newRow = document.querySelector<HTMLElement>('[data-row="new"]')!;
    const appNavigated = vi.fn();
    appRow.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = false;
    newRow.after(appRow);
    newRow.setAttribute("aria-selected", "true");
    appRow.querySelector<HTMLElement>('[role="row"]')?.addEventListener("click", appNavigated);
    enhancer = createEnhancer();
    enhancer.start();

    document.querySelector<HTMLButtonElement>("[data-adopp-next-unreviewed]")?.click();

    expect(appNavigated).toHaveBeenCalledOnce();
  });

  it("dismisses native menus on outside pointer input and Escape", () => {
    enhancer = createEnhancer();
    enhancer.start();

    const trigger = document.querySelector<HTMLButtonElement>(".adopp-native-filter-trigger")!;
    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector<HTMLElement>(".adopp-native-filter-menu")?.hidden).toBe(true);
    expect(document.querySelector(".adopp-native-filter-menu")?.parentElement?.dataset.dropdown).toBe("filters");

    trigger.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector<HTMLElement>(".adopp-native-filter-menu")?.hidden).toBe(true);
  });

  it("does not copy Approve's transient open state onto Start Reviewing", () => {
    document.querySelector<HTMLButtonElement>(".repos-pr-header-vote-button > button")?.classList.add("active", "selected");
    enhancer = createEnhancer();
    enhancer.start();

    expect(document.querySelector(".adopp-start-button")?.classList.contains("active")).toBe(false);
    expect(document.querySelector(".adopp-start-button")?.classList.contains("selected")).toBe(false);
    expect(document.querySelector(".adopp-action-menu-button")?.classList.contains("active")).toBe(false);
  });

  it.each([false, true])("keeps Start Review neutral when Approve is primary=%s", (primary) => {
    const approveSplit = document.querySelector<HTMLElement>(".repos-pr-header-vote-button")!;
    for (const control of [approveSplit, ...approveSplit.querySelectorAll<HTMLElement>("button")]) {
      control.classList.toggle("primary", primary);
    }
    enhancer = createEnhancer();
    enhancer.start();

    const startSplit = document.querySelector<HTMLElement>(".adopp-start-split")!;
    expect(startSplit.classList.contains("primary")).toBe(false);
    expect(startSplit.querySelector(".primary")).toBeNull();
    expect(approveSplit.classList.contains("primary")).toBe(primary);
    for (const button of approveSplit.querySelectorAll("button")) {
      expect(button.classList.contains("primary")).toBe(primary);
    }
  });

  it("prefers the verified ADO file tree over unrelated tables with matching text", () => {
    const unrelated = document.createElement("table");
    unrelated.innerHTML = `
      <tbody>
        <tr role="row"><td>app.ts unrelated result</td></tr>
        <tr role="row"><td>new.ts unrelated result</td></tr>
      </tbody>`;
    document.body.prepend(unrelated);

    enhancer = createEnhancer();
    enhancer.start();

    expect(unrelated.querySelector("[data-adopp-inline-stat]")).toBeNull();
    const navigated = vi.fn();
    document.querySelector('[data-row="new"] [role="row"]')!.addEventListener("click", navigated);
    document.querySelector<HTMLButtonElement>("[data-adopp-next-unreviewed]")!.click();
    expect(navigated).toHaveBeenCalledOnce();
    expect(document.querySelectorAll("[data-adopp-inline-stat]")).toHaveLength(0);
    expect(document.querySelector(".repos-compare-filter")?.nextElementSibling).toBe(document.querySelector("[data-adopp-native-toolbar]"));
  });

  it("does not mount the file toolbar into a full-page fallback container", () => {
    document.querySelector(".repos-compare-filter")?.remove();

    enhancer = createEnhancer();
    enhancer.start();

    expect(document.querySelector("[data-adopp-native-toolbar]")).toBeNull();
    expect(document.querySelectorAll("[data-adopp-inline-stat]")).toHaveLength(0);
  });

  it("preserves native search focus during routine ADO rescans", () => {
    const search = document.createElement("input");
    search.type = "search";
    document.querySelector(".native-file-controls")!.append(search);
    enhancer = createEnhancer();
    enhancer.start();
    search.focus();
    search.value = "app";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    enhancer.refresh();

    expect(document.activeElement).toBe(search);
    expect(search.value).toBe("app");
  });

  it("reads current reviewed state only when navigating without rewriting native checkboxes", () => {
    enhancer = createEnhancer();
    enhancer.start();
    const checkbox = document.querySelector<HTMLInputElement>('[data-row="new"] input[type="checkbox"]')!;

    checkbox.checked = true;
    const navigated = vi.fn();
    document.querySelector('[data-row="new"] [role="row"]')!.addEventListener("click", navigated);
    document.querySelector<HTMLButtonElement>("[data-adopp-next-unreviewed]")!.click();
    expect(navigated).not.toHaveBeenCalled();
    expect(checkbox.checked).toBe(true);
    expect(document.querySelector(".adopp-native-reviewed-count")).toBeNull();
  });

  it("clears extra predicates when file filters are disabled while keeping native counts active", () => {
    const settings = defaultSettings();
    const port = createNativePort();
    enhancer = new NativePrEnhancer(analysis, settings, {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    }, port);
    enhancer.start();
    document.querySelector<HTMLButtonElement>('[data-choice-kind="change"][data-choice-value="add"]')!.click();
    settings.features.fileFilters = false;
    enhancer.updateSettings(settings);
    expect(port.configure).toHaveBeenLastCalledWith({
      changeKind: "all", extension: "all", hideGenerated: false, hideLockfiles: false
    }, true);
    expect(port.stop).not.toHaveBeenCalled();
    expect(document.querySelector(".adopp-native-dropdown-trigger")).toBeNull();
    expect(document.querySelector("[data-adopp-total-file-count]")).not.toBeNull();
  });

  it("stops native integration and restores the count when the extension is disabled", () => {
    const settings = defaultSettings();
    const port = createNativePort();
    enhancer = new NativePrEnhancer(analysis, settings, {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    }, port);
    enhancer.start();
    settings.masterEnabled = false;
    enhancer.updateSettings(settings);
    expect(port.stop).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-adopp-total-file-count]")).toBeNull();
    expect(document.querySelector("[data-adopp-original-file-count]")).toBeNull();
    expect(document.querySelector("[data-adopp-native-toolbar]")).toBeNull();
  });
});

function createNativePort(fileCount = analysis.files.length) {
  const status: TreeStatus = {
    channel: "adopp-native-tree-v1", kind: "status", session: "16748ae6-f0a9-4dad-ac76-88e2bafc32c1",
    state: "active", detail: "Native integration active.", fileCount
  };
  return { status, configure: vi.fn(), stop: vi.fn(), subscribe: vi.fn(() => vi.fn()) };
}

function createEnhancer(overrides: Partial<ConstructorParameters<typeof NativePrEnhancer>[2]> = {}, port = createNativePort()): NativePrEnhancer {
  return new NativePrEnhancer(analysis, defaultSettings(), {
    openDiscussions: vi.fn(),
    startReviewing: vi.fn(),
    isReviewAnnounced: () => false,
    openSettings: vi.fn(),
    ...overrides
  }, port);
}
