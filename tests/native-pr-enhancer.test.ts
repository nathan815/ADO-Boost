// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequest/7?_a=files"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativePrEnhancer } from "../src/content/native-pr-enhancer";
import type { PullRequestAnalysis } from "../src/core/types";
import { defaultSettings } from "../src/features/registry";

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
    expect(document.querySelector(".adopp-native-visible-count")?.textContent).toBe("2 files analyzed · 6 unresolved");
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

  it("adds per-file counts once and filters using native reviewed checkboxes", () => {
    enhancer = createEnhancer();
    enhancer.start();
    enhancer.refresh();

    expect(document.querySelectorAll("[data-adopp-inline-stat]")).toHaveLength(2);
    expect(document.querySelector('[data-row="app"]')?.textContent).toContain("+5 −2");
    expect(document.querySelector('[data-row="new"]')?.textContent).toContain("+3 −1");
    expect(document.querySelector('[data-row="app"] .adopp-native-stat-plus')?.textContent).toBe("+5");
    expect(document.querySelector('[data-row="app"] .adopp-native-stat-minus')?.textContent).toBe("−2");
    expect(document.querySelector("[data-adopp-native-toolbar]")?.parentElement?.classList.contains("file-tree-pane")).toBe(true);
    expect(document.querySelector("[data-adopp-native-toolbar]")?.nextElementSibling?.classList.contains("bolt-table-container")).toBe(true);
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
    expect(document.querySelector(".adopp-native-visible-count")?.textContent).toBe("2 files analyzed");
    expect(document.querySelector(".adopp-native-reviewed-count")?.textContent).toBe("1/2 reviewed in view");
    expect(document.querySelector(".adopp-native-summary")?.parentElement).toBe(document.querySelector("[data-adopp-native-toolbar]"));
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

    document.querySelector<HTMLButtonElement>('[data-toggle="viewed"]')?.click();
    expect(document.querySelector('[data-row="app"]')?.classList.contains("adopp-native-hidden")).toBe(true);
    expect(document.querySelector('[data-row="new"]')?.classList.contains("adopp-native-hidden")).toBe(false);
    expect(document.querySelector(".adopp-native-filter-trigger")?.textContent).toContain("More (1)");
    expect(document.querySelector(".adopp-native-visible-count")?.textContent).toBe("2 files analyzed");
    expect(document.querySelector(".adopp-native-reviewed-count")?.textContent).toBe("1/2 reviewed in view");
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
      expect(trigger.classList.contains("subtle")).toBe(true);
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

    expect(document.querySelector(".adopp-native-visible-count")?.textContent).toBe("3 files analyzed");
    expect(document.querySelector(".adopp-native-visible-count")?.getAttribute("title")).toContain("including offscreen and collapsed files");
    expect(document.querySelector(".adopp-native-reviewed-count")?.textContent).toBe("1/2 reviewed in view");
  });

  it("keeps 422-file coverage and filter counts stable as a virtualized tree recycles rows", () => {
    const files = Array.from({ length: 422 }, (_, index) => ({
      ...analysis.files[0]!, trackingId: index + 1, path: `/src/file-${index}.ts`
    }));
    const tbody = document.querySelector("tbody")!;
    const renderRows = (start: number, count: number) => {
      tbody.innerHTML = files.slice(start, start + count).map((file) =>
        `<tr role="row"><td><input type="checkbox"><button title="${file.path}">${file.path.split("/").at(-1)}</button></td></tr>`
      ).join("");
    };
    renderRows(0, 29);
    enhancer = new NativePrEnhancer({ ...analysis, files }, defaultSettings(), {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    });
    enhancer.start();
    const toolbar = document.querySelector("[data-adopp-native-toolbar]");
    const count = document.querySelector(".adopp-native-visible-count")!;
    const totals = document.querySelector("[data-adopp-total-diff]")?.textContent;
    expect(count.textContent).toBe("422 files analyzed");
    expect(document.querySelectorAll("[data-adopp-inline-stat]")).toHaveLength(29);

    renderRows(290, 8);
    enhancer.refresh();
    expect(count.textContent).toBe("422 files analyzed");
    expect(document.querySelector("[data-adopp-total-diff]")?.textContent).toBe(totals);
    expect(document.querySelectorAll("[data-adopp-inline-stat]")).toHaveLength(8);
    expect(document.querySelector("[data-adopp-inline-stat]")?.getAttribute("data-adopp-inline-stat")).toBe("/src/file-290.ts");
    expect(document.querySelector(".adopp-native-reviewed-count")?.textContent).toBe("0/8 reviewed in view");

    const search = document.querySelector<HTMLInputElement>(".adopp-native-search")!;
    search.value = "file-421.ts";
    search.dispatchEvent(new Event("input"));
    expect(count.textContent).toBe("1/422 matching files");
    renderRows(0, 0);
    enhancer.refresh();
    expect(document.querySelector("[data-adopp-native-toolbar]")).toBe(toolbar);
    expect(count.textContent).toBe("1/422 matching files");
    renderRows(421, 1);
    enhancer.refresh();
    expect(count.textContent).toBe("1/422 matching files");
    expect(document.querySelector("tbody tr")?.classList.contains("adopp-native-hidden")).toBe(false);
    expect(document.querySelector("[data-adopp-total-diff]")?.textContent).toBe(totals);

    search.value = "";
    search.dispatchEvent(new Event("input"));
    expect(count.textContent).toBe("422 files analyzed");
  });

  it("leaves unmatched files, their discussions, and collapsed folders visible without filters", () => {
    const appRow = document.querySelector<HTMLElement>('[data-row="app"]')!;
    appRow.insertAdjacentHTML("afterend", `
      <tr role="row" aria-level="2" aria-expanded="true" data-row="unmatched"><td>main.yml</td></tr>
      <tr role="row" aria-level="3" data-annotation="unmatched"><td>Review discussion</td></tr>
      <tr role="row" aria-level="1" aria-expanded="false" data-folder="collapsed"><td>other</td></tr>
    `);
    const otherFiles = Array.from({ length: 7 }, (_, index) => ({
      ...analysis.files[0]!, trackingId: index + 3, path: `/src/file${index}.ts`
    }));
    document.querySelector("tbody")!.insertAdjacentHTML("beforeend", otherFiles.map((file) =>
      `<tr role="row"><td><button>${file.path.split("/").at(-1)}</button></td></tr>`
    ).join(""));
    document.querySelector("tbody")!.insertAdjacentHTML("beforeend", Array.from({ length: 4 }, () =>
      '<tr role="row" aria-level="2" aria-expanded="true"><td><button>main.yml</button></td></tr>'
    ).join(""));
    const unmatchedAnalysis: PullRequestAnalysis = {
      ...analysis,
      files: [
        ...analysis.files,
        ...otherFiles,
        ...["one", "two", "three", "four", "five"].map((folder, index) => ({
          ...analysis.files[0]!, trackingId: index + 10, path: `/${folder}/main.yml`
        }))
      ]
    };
    enhancer = new NativePrEnhancer(unmatchedAnalysis, defaultSettings(), {
      openDiscussions: vi.fn(), startReviewing: vi.fn(), isReviewAnnounced: () => false, openSettings: vi.fn()
    });
    enhancer.start();
    expect(document.querySelectorAll(".adopp-native-hidden")).toHaveLength(0);
    expect(document.querySelector(".adopp-native-visible-count")?.textContent).toBe("14 files analyzed");

    const search = document.querySelector<HTMLInputElement>(".adopp-native-search")!;
    search.value = "no-match";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector('[data-row="unmatched"]')?.classList.contains("adopp-native-hidden")).toBe(false);
    expect(document.querySelector('[data-folder="collapsed"]')?.classList.contains("adopp-native-hidden")).toBe(false);
    search.value = "";
    search.dispatchEvent(new Event("input"));
    enhancer.refresh();
    expect(document.querySelectorAll(".adopp-native-hidden")).toHaveLength(0);
  });

  it("restores the native tree when refreshed rows can no longer be recognized", () => {
    enhancer = createEnhancer();
    enhancer.start();
    const search = document.querySelector<HTMLInputElement>(".adopp-native-search")!;
    search.value = "no-match";
    search.dispatchEvent(new Event("input"));
    for (const button of document.querySelectorAll("tbody button")) button.textContent = "unknown";
    search.value = "";
    search.dispatchEvent(new Event("input"));
    enhancer.refresh();
    expect(document.querySelectorAll(".adopp-native-hidden")).toHaveLength(0);
  });

  it("matches repeated filenames by their native folder hierarchy", () => {
    document.querySelector("tbody")!.innerHTML = `
      <tr role="row" aria-level="1" aria-expanded="true"><td>src</td></tr>
      <tr role="row" aria-level="2" aria-expanded="true"><td>one/tasks</td></tr>
      <tr role="row" aria-level="3" data-row="first"><td><button>main.yml</button></td></tr>
      <tr role="row" aria-level="2" aria-expanded="true"><td>two</td></tr>
      <tr role="row" aria-level="3" data-row="second"><td><button>main.yml</button></td></tr>
    `;
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
    expect(document.querySelector('[data-row="first"] [data-adopp-inline-stat]')?.getAttribute("data-adopp-inline-stat")).toBe("/src/one/tasks/main.yml");
    expect(document.querySelector('[data-row="second"] [data-adopp-inline-stat]')?.getAttribute("data-adopp-inline-stat")).toBe("/src/two/main.yml");
    expect(document.querySelector(".adopp-native-visible-count")?.textContent).toBe("2 files analyzed");

    const search = document.querySelector<HTMLInputElement>(".adopp-native-search")!;
    search.value = "/two/";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector('[data-row="first"]')?.classList.contains("adopp-native-hidden")).toBe(true);
    expect(document.querySelector('[data-row="second"]')?.classList.contains("adopp-native-hidden")).toBe(false);
  });

  it("matches repeated and truncated filenames using full-path labels", () => {
    document.querySelector("tbody")!.innerHTML = `
      <tr role="row" data-row="first"><td><button title="/src/one/main.yml">main.yml</button></td></tr>
      <tr role="row" data-row="second"><td><button title="/src/two/main.yml">main...</button></td></tr>
    `;
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
    expect(document.querySelector('[data-row="first"] [data-adopp-inline-stat]')?.getAttribute("data-adopp-inline-stat")).toBe("/src/one/main.yml");
    expect(document.querySelector('[data-row="second"] [data-adopp-inline-stat]')?.getAttribute("data-adopp-inline-stat")).toBe("/src/two/main.yml");
    expect(document.querySelectorAll(".adopp-native-hidden")).toHaveLength(0);
  });

  it("removes stale diff badges when ADO recycles a file row", () => {
    enhancer = createEnhancer();
    enhancer.start();
    const row = document.querySelector<HTMLElement>('[data-row="new"]')!;
    const stale = document.createElement("span");
    stale.dataset.adoppInlineStat = "/src/previous.ts";
    stale.textContent = "+99 −4";
    row.querySelector("button")?.after(stale);

    enhancer.refresh();

    expect(row.querySelectorAll("[data-adopp-inline-stat]")).toHaveLength(1);
    expect(row.querySelector("[data-adopp-inline-stat]")?.getAttribute("data-adopp-inline-stat")).toBe("/src/new.ts");
    expect(row.textContent).not.toContain("+99");
  });

  it("hides empty folders and annotations when their files are filtered out", () => {
    const appRow = document.querySelector<HTMLElement>('[data-row="app"]')!;
    const newRow = document.querySelector<HTMLElement>('[data-row="new"]')!;
    appRow.setAttribute("aria-level", "3");
    newRow.setAttribute("aria-level", "2");
    appRow.insertAdjacentHTML("beforebegin", `
      <tr role="row" aria-level="1" aria-expanded="true" data-folder="src"><td><div role="row">src</div></td></tr>
      <tr role="row" aria-level="2" aria-expanded="true" data-folder="nested"><td><div role="row">nested</div></td></tr>
    `);
    appRow.insertAdjacentHTML("afterend", '<tr role="row" aria-level="4" data-annotation="app"><td>Review annotation</td></tr>');
    newRow.insertAdjacentHTML("beforebegin", '<tr role="row" aria-level="1" aria-expanded="true" data-folder="added"><td><div role="row">added</div></td></tr>');

    enhancer = createEnhancer();
    enhancer.start();
    document.querySelector<HTMLButtonElement>('[data-dropdown="change"] .adopp-native-dropdown-trigger')?.click();
    document.querySelector<HTMLButtonElement>('[data-choice-kind="change"][data-choice-value="add"]')?.click();

    expect(document.querySelector('[data-folder="src"]')?.classList.contains("adopp-native-hidden")).toBe(true);
    expect(document.querySelector('[data-folder="nested"]')?.classList.contains("adopp-native-hidden")).toBe(true);
    expect(document.querySelector('[data-row="app"]')?.classList.contains("adopp-native-hidden")).toBe(true);
    expect(document.querySelector('[data-annotation="app"]')?.classList.contains("adopp-native-hidden")).toBe(true);
    expect(document.querySelector('[data-folder="added"]')?.classList.contains("adopp-native-hidden")).toBe(false);
    expect(document.querySelector('[data-row="new"]')?.classList.contains("adopp-native-hidden")).toBe(false);
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
    expect(document.querySelector('[data-row="app"] [data-adopp-inline-stat]')).not.toBeNull();
    expect(document.querySelector("[data-adopp-native-toolbar]")?.parentElement?.classList.contains("file-tree-pane")).toBe(true);
  });

  it("does not mount the file toolbar into a full-page fallback container", () => {
    document.querySelector('[aria-label="Mark as reviewed"]')?.remove();
    document.querySelector(".file-tree-pane")?.removeAttribute("data-file-tree-pane");
    document.querySelector(".file-tree-pane")?.classList.remove("file-tree-pane");

    enhancer = createEnhancer();
    enhancer.start();

    expect(document.querySelector("[data-adopp-native-toolbar]")).toBeNull();
    expect(document.querySelectorAll("[data-adopp-inline-stat]")).toHaveLength(2);
  });

  it("preserves search focus during routine ADO rescans", () => {
    enhancer = createEnhancer();
    enhancer.start();
    const search = document.querySelector<HTMLInputElement>(".adopp-native-search")!;
    search.focus();
    search.value = "app";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    enhancer.refresh();

    expect(document.activeElement).toBe(search);
    expect(search.value).toBe("app");
  });

  it("updates reviewed progress when ADO changes a native checkbox property", async () => {
    enhancer = createEnhancer();
    enhancer.start();
    const checkbox = document.querySelector<HTMLInputElement>('[data-row="new"] input[type="checkbox"]')!;

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(document.querySelector(".adopp-native-reviewed-count")?.textContent).toBe("2/2 reviewed in view");
  });
});

function createEnhancer(overrides: Partial<ConstructorParameters<typeof NativePrEnhancer>[2]> = {}): NativePrEnhancer {
  return new NativePrEnhancer(analysis, defaultSettings(), {
    openDiscussions: vi.fn(),
    startReviewing: vi.fn(),
    isReviewAnnounced: () => false,
    openSettings: vi.fn(),
    ...overrides
  });
}
