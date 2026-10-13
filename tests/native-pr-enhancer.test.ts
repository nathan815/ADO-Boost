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
      <div class="actions"><button class="bolt-button">Approve</button></div>
      <div class="page-layout">
        <aside class="project-navigation">Project navigation</aside>
        <section data-file-pane>
          <div class="native-file-controls">All Changes</div>
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
    expect([...actions.children].at(-1)?.textContent).toBe("Approve");

    document.querySelector<HTMLButtonElement>(".adopp-panel-button")?.click();
    expect(openDiscussions).toHaveBeenCalledOnce();

    document.querySelector<HTMLButtonElement>(".adopp-action-menu-button")?.click();
    expect(document.querySelector(".adopp-action-menu .bolt-menu .bolt-list")).not.toBeNull();
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

    const filterTrigger = document.querySelector<HTMLButtonElement>(".adopp-native-filter-trigger");
    filterTrigger?.click();
    expect(filterTrigger?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector<HTMLElement>(".adopp-native-filter-menu")?.hidden).toBe(false);
    expect(document.querySelector(".adopp-native-filter-menu")?.parentElement).toBe(document.body);
    expect(document.querySelector(".adopp-native-filter-menu")?.getAttribute("data-adopp-filter-portal")).toBe("true");

    document.querySelector<HTMLButtonElement>('[data-toggle="viewed"]')?.click();
    expect(document.querySelector('[data-row="app"]')?.classList.contains("adopp-native-hidden")).toBe(true);
    expect(document.querySelector('[data-row="new"]')?.classList.contains("adopp-native-hidden")).toBe(false);
    expect(document.querySelector(".adopp-native-filter-trigger")?.textContent).toContain("Filters (1)");
  });

  it("navigates to the next unreviewed file through the native link", () => {
    const navigated = vi.fn();
    window.addEventListener("popstate", navigated, { once: true });
    enhancer = createEnhancer();
    enhancer.start();

    document.querySelector<HTMLButtonElement>('[data-nav="unreviewed"]')?.click();

    expect(navigated).toHaveBeenCalledOnce();
    expect(new URLSearchParams(location.search).get("path")).toBe("/src/new.ts");
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
