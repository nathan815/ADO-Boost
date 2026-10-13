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
      <div class="pr-header-row">
        <div class="title-slot"><input aria-label="Pull request title" value="PR title"></div>
        <div class="actions">
          <div class="repos-pr-header-vote-button bolt-split-button flex-stretch inline-flex-row">
            <button class="bolt-button enabled bolt-focus-treatment"><span class="bolt-button-text">Approve</span></button>
            <button class="bolt-split-button-option bolt-button bolt-icon-button enabled icon-only bolt-focus-treatment" aria-label="More vote options" aria-controls="approve-menu" data-command="approve-options"><span class="fabric-icon ms-Icon--ChevronDownSmall"></span></button>
          </div>
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

  it("integrates overall totals and the panel trigger beside Approve", () => {
    const openDiscussions = vi.fn();
    enhancer = createEnhancer({ openDiscussions });
    enhancer.start();

    const actions = document.querySelector(".actions")!;
    expect(actions.textContent).toContain("+8");
    expect(actions.textContent).toContain("−3");
    expect(actions.textContent).toContain("ADO++ (2)");
    expect(actions.textContent).toContain("Start Reviewing");
    expect([...actions.children].at(-1)?.textContent?.trim()).toBe("Approve");
    expect(document.querySelector(".adopp-start-split")?.classList.contains("bolt-split-button")).toBe(true);
    expect(document.querySelector(".adopp-start-split")?.classList.contains("repos-pr-header-vote-button")).toBe(false);
    expect(document.querySelector(".adopp-action-menu-button .ms-Icon--ChevronDownSmall")).not.toBeNull();
    expect(document.querySelector(".adopp-action-menu-button")?.hasAttribute("aria-controls")).toBe(false);
    expect(document.querySelector(".adopp-action-menu-button")?.hasAttribute("data-command")).toBe(false);

    document.querySelector<HTMLButtonElement>(".adopp-panel-button")?.click();
    expect(openDiscussions).toHaveBeenCalledOnce();

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
    expect(document.querySelector('[data-choice-kind="change"][data-choice-value="all"]')?.textContent).toContain("Any change");
    expect(document.querySelectorAll('[data-dropdown="change"] .adopp-native-dropdown-chevron')).toHaveLength(1);
    expect(document.querySelector('[data-nav="previous"] path')?.getAttribute("d")).toBe("M2 8.5 6 4.5 10 8.5");
    expect(document.querySelector('[data-nav="next"] path')?.getAttribute("d")).toBe("M2 3.5 6 7.5 10 3.5");
    expect(document.querySelector(".adopp-native-visible-count")?.textContent).toBe("2/2 files");
    expect(document.querySelector(".adopp-native-reviewed-count")?.textContent).toBe("1/2 reviewed");
    expect(document.querySelector(".adopp-native-summary")?.parentElement).toBe(document.querySelector("[data-adopp-native-toolbar]"));
    expect([...document.querySelectorAll<HTMLElement>("[data-nav]")].map((button) => button.dataset.nav)).toEqual(["previous", "next", "unreviewed"]);
    expect(document.querySelectorAll('[data-nav="unreviewed"] .adopp-nav-double-icon path')).toHaveLength(2);

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
    expect(document.querySelector(".adopp-native-visible-count")?.textContent).toBe("1/2 files");
    expect(document.querySelector(".adopp-native-reviewed-count")?.textContent).toBe("1/2 reviewed");
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

  it("distinguishes selected-comparison files from full pull-request files", () => {
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

    expect(document.querySelector(".adopp-native-visible-count")?.textContent).toBe("2/2 shown · 3 total in PR");
    expect(document.querySelector(".adopp-native-visible-count")?.getAttribute("title")).toContain("selected ADO comparison");
    expect(document.querySelector(".adopp-native-reviewed-count")?.textContent).toBe("1/2 reviewed");
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

    document.querySelector<HTMLButtonElement>('[data-nav="unreviewed"]')?.click();

    expect(navigated).toHaveBeenCalledOnce();
  });

  it("uses the native selected row when the URL has no file path", () => {
    const appRow = document.querySelector<HTMLElement>('[data-row="app"]')!;
    const newRow = document.querySelector<HTMLElement>('[data-row="new"]')!;
    const nextNavigated = vi.fn();
    const previousNavigated = vi.fn();
    appRow.setAttribute("aria-selected", "true");
    newRow.querySelector<HTMLElement>('[role="row"]')?.addEventListener("click", nextNavigated);
    appRow.querySelector<HTMLElement>('[role="row"]')?.addEventListener("click", previousNavigated);
    enhancer = createEnhancer();
    enhancer.start();

    document.querySelector<HTMLButtonElement>('[data-nav="next"]')?.click();
    expect(nextNavigated).toHaveBeenCalledOnce();

    appRow.removeAttribute("aria-selected");
    newRow.setAttribute("aria-selected", "true");
    document.querySelector<HTMLButtonElement>('[data-nav="previous"]')?.click();
    expect(previousNavigated).toHaveBeenCalledOnce();
  });

  it("navigates in the file tree's rendered order instead of API order", () => {
    const appRow = document.querySelector<HTMLElement>('[data-row="app"]')!;
    const newRow = document.querySelector<HTMLElement>('[data-row="new"]')!;
    const appNavigated = vi.fn();
    newRow.after(appRow);
    newRow.setAttribute("aria-selected", "true");
    appRow.querySelector<HTMLElement>('[role="row"]')?.addEventListener("click", appNavigated);
    enhancer = createEnhancer();
    enhancer.start();

    document.querySelector<HTMLButtonElement>('[data-nav="next"]')?.click();

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

    expect(document.querySelector(".adopp-native-reviewed-count")?.textContent).toBe("2/2 reviewed");
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
