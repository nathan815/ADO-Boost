import type { FileStat, PullRequestAnalysis } from "../core/types";
import { totalStats } from "../core/diff";
import type { FeatureSettings } from "../features/registry";
import { resolveFeature } from "../features/registry";
import { navigateToAdoFile } from "../ui/ado-navigation";

interface NativePrEnhancerActions {
  openDiscussions(): void;
  startReviewing(): void;
  isReviewAnnounced(): boolean;
  openSettings(): void;
}

interface NativeFileRow {
  file: FileStat;
  row: HTMLElement;
  label: HTMLElement;
}

const STYLE_ID = "adopp-native-styles";
const ADO_FILE_TREE_SELECTOR = [
  "table.repos-changes-explorer.repos-file-explorer-tree",
  "table.repos-file-explorer-tree",
  '[role="treegrid"].repos-file-explorer-tree',
  '[role="tree"].repos-file-explorer-tree'
].join(",");

export class NativePrEnhancer {
  private observer: MutationObserver | null = null;
  private scheduled = 0;
  private reviewRefreshScheduled = 0;
  private headerWrapContainer: HTMLElement | null = null;
  private headerActionItem: HTMLElement | null = null;
  private headerTitleInput: HTMLInputElement | null = null;
  private query = "";
  private changeKind = "all";
  private extension = "all";
  private hideViewed = false;
  private hideGenerated: boolean;
  private hideLockfiles: boolean;
  private rows: NativeFileRow[] = [];

  constructor(
    private readonly analysis: PullRequestAnalysis,
    private settings: FeatureSettings,
    private readonly actions: NativePrEnhancerActions
  ) {
    this.hideGenerated = settings.features.hideGenerated;
    this.hideLockfiles = settings.features.hideLockfiles;
  }

  start(): void {
    this.ensureStyles();
    this.observer = new MutationObserver((records) => {
      if (records.some((record) => !isOwnedMutationRecord(record))) this.schedule();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("pointerdown", this.onPointerDown, true);
    document.addEventListener("change", this.onNativeTreeInteraction, true);
    document.addEventListener("click", this.onNativeTreeInteraction, true);
    window.addEventListener("resize", this.onHeaderLayoutChanged);
    window.addEventListener("adopp:announcement-changed", this.onAnnouncementChanged);
    this.scan();
  }

  updateSettings(settings: FeatureSettings): void {
    this.settings = settings;
    this.hideGenerated = settings.features.hideGenerated;
    this.hideLockfiles = settings.features.hideLockfiles;
    this.scan(true);
  }

  refresh(): void {
    this.scan();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.clearTimeout(this.scheduled);
    window.clearTimeout(this.reviewRefreshScheduled);
    document.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("change", this.onNativeTreeInteraction, true);
    document.removeEventListener("click", this.onNativeTreeInteraction, true);
    window.removeEventListener("resize", this.onHeaderLayoutChanged);
    this.headerTitleInput?.removeEventListener("input", this.onHeaderLayoutChanged);
    this.clearHeaderWrapping();
    window.removeEventListener("adopp:announcement-changed", this.onAnnouncementChanged);
    closeAllNativeMenus();
    closeActionMenu();
    document.querySelector("[data-adopp-native-toolbar]")?.remove();
    document.querySelector("[data-adopp-action-group]")?.remove();
    for (const stat of document.querySelectorAll("[data-adopp-inline-stat]")) stat.remove();
    for (const row of document.querySelectorAll(".adopp-native-hidden")) row.classList.remove("adopp-native-hidden");
  }

  private schedule(): void {
    window.clearTimeout(this.scheduled);
    this.scheduled = window.setTimeout(() => this.scan(), 80);
  }

  private scan(forceToolbar = false): void {
    if (!this.settings.masterEnabled) {
      this.destroy();
      return;
    }
    this.rows = this.findFileRows();
    this.renderInlineStats();
    this.renderToolbar(forceToolbar);
    this.renderActionGroup();
    this.applyFilters();
  }

  private findFileRows(): NativeFileRow[] {
    const tree = findNativeFileTree(this.analysis.files);
    if (!tree) return [];
    const found = new Map<string, NativeFileRow>();
    const rows = [...tree.querySelectorAll<HTMLElement>('tr,[role="row"]')];
    for (const file of this.analysis.files) {
      const basename = basenameOf(file.path);
      const matching = rows.filter((row) => rowMatchesFile(row, basename));
      const rootMatches = matching.filter((row) =>
        !matching.some((candidate) => candidate !== row && candidate.contains(row))
      );
      if (rootMatches.length !== 1) continue;
      const row = rootMatches[0]!;
      const label = findRowLabel(row, basename) ?? row;
      found.set(file.path, { file, row, label });
    }
    return [...found.values()].sort((left, right) => {
      if (left.row === right.row) return 0;
      const position = left.row.compareDocumentPosition(right.row);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  private renderInlineStats(): void {
    if (!resolveFeature(this.settings, "prOverview").enabled) return;
    for (const { file, row, label } of this.rows) {
      const stats = [...row.querySelectorAll<HTMLElement>("[data-adopp-inline-stat]")];
      const existing = stats.find((candidate) => candidate.dataset.adoppInlineStat === file.path);
      for (const stat of stats) {
        if (stat !== existing) stat.remove();
      }
      if (existing) {
        renderStat(existing, file);
        existing.dataset.state = file.state;
        continue;
      }
      const stat = document.createElement("span");
      stat.className = "adopp-native-stat";
      stat.dataset.adoppInlineStat = file.path;
      stat.dataset.state = file.state;
      stat.title = file.detail ?? file.state;
      renderStat(stat, file);
      label.insertAdjacentElement("afterend", stat);
    }
  }

  private renderToolbar(force = false): void {
    const enabled = resolveFeature(this.settings, "groupedNavigation").enabled
      || resolveFeature(this.settings, "fileSearch").enabled
      || resolveFeature(this.settings, "fileFilters").enabled;
    if (!enabled || !this.rows.length) {
      document.querySelector("[data-adopp-native-toolbar]")?.remove();
      return;
    }
    const tree = this.rows[0]?.row.closest<HTMLElement>(`${ADO_FILE_TREE_SELECTOR},table,[role="treegrid"],[role="tree"]`);
    const mount = tree ? findToolbarMount(tree) : null;
    if (!tree || !mount) {
      document.querySelector("[data-adopp-native-toolbar]")?.remove();
      return;
    }
    let toolbar = document.querySelector<HTMLElement>("[data-adopp-native-toolbar]");
    if (toolbar && !force) {
      if (toolbar.parentElement !== mount.host || toolbar.nextElementSibling !== mount.before) {
        mount.host.insertBefore(toolbar, mount.before);
      }
      return;
    }
    if (!toolbar) {
      toolbar = document.createElement("section");
      toolbar.dataset.adoppNativeToolbar = "true";
      toolbar.className = "adopp-native-toolbar";
      mount.host.insertBefore(toolbar, mount.before);
    } else if (toolbar.parentElement !== mount.host || toolbar.nextElementSibling !== mount.before) {
      mount.host.insertBefore(toolbar, mount.before);
    }
    const extensions = [...new Set(this.analysis.files.map((file) => extensionOf(file.path)).filter(Boolean))].sort();
    const activeFilterCount = [this.hideViewed, this.hideGenerated, this.hideLockfiles].filter(Boolean).length;
    const dropdownButton = findNativeDropdownButton();
    document.querySelector('[data-adopp-filter-portal="true"]')?.remove();
    toolbar.innerHTML = `
      <div class="adopp-native-toolbar-row">
        <input class="adopp-native-search" type="search" value="${escapeHtml(this.query)}" placeholder="Search changed files" aria-label="Search changed files">
        <div class="adopp-native-nav-controls">
          <button class="adopp-native-nav bolt-button bolt-icon-button enabled icon-only bolt-focus-treatment" data-nav="previous" type="button" title="Previous file" aria-label="Previous file"><svg class="adopp-nav-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8.5 6 4.5 10 8.5"></path></svg></button>
          <button class="adopp-native-nav bolt-button bolt-icon-button enabled icon-only bolt-focus-treatment" data-nav="next" type="button" title="Next file" aria-label="Next file"><svg class="adopp-nav-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3.5 6 7.5 10 3.5"></path></svg></button>
          <button class="adopp-native-nav bolt-button bolt-icon-button enabled icon-only bolt-focus-treatment" data-nav="unreviewed" type="button" title="Next unreviewed file" aria-label="Next unreviewed file"><svg class="adopp-nav-icon adopp-nav-double-icon" viewBox="0 0 12 15" aria-hidden="true"><path d="M2 2.5 6 6.5 10 2.5"></path><path d="M2 7.5 6 11.5 10 7.5"></path></svg></button>
        </div>
      </div>
      <div class="adopp-native-toolbar-row adopp-native-filters">
        <div class="adopp-native-dropdown" data-dropdown="change">
          ${nativeDropdownTrigger(dropdownButton, changeKindLabel(this.changeKind), "Filter by change kind")}
          ${nativeMenuShell("adopp-native-change-menu", [
            nativeChoiceMenuItem("change", "all", "Any change", this.changeKind === "all"),
            ...["add", "edit", "delete", "rename"].map((kind) => nativeChoiceMenuItem("change", kind, capitalize(kind), this.changeKind === kind))
          ].join(""))}
        </div>
        <div class="adopp-native-dropdown" data-dropdown="extension">
          ${nativeDropdownTrigger(dropdownButton, this.extension === "all" ? "File type" : `.${this.extension}`, "Filter by extension")}
          ${nativeMenuShell("adopp-native-extension-menu", [
            nativeChoiceMenuItem("extension", "all", "All types", this.extension === "all"),
            ...extensions.map((value) => nativeChoiceMenuItem("extension", value, `.${value}`, this.extension === value))
          ].join(""))}
        </div>
        <div class="adopp-native-dropdown" data-dropdown="filters">
          ${nativeDropdownTrigger(dropdownButton, `More${activeFilterCount ? ` (${activeFilterCount})` : ""}`, "Additional file options", "adopp-native-filter-trigger")}
          ${nativeMenuShell("adopp-native-filter-menu", `
              ${nativeToggleMenuItem("viewed", "Hide viewed files", this.hideViewed)}
              ${nativeToggleMenuItem("generated", "Hide generated files", this.hideGenerated)}
              ${nativeToggleMenuItem("lockfiles", "Hide lockfiles", this.hideLockfiles)}
          `)}
        </div>
      </div>
      <div class="adopp-native-summary">
        <span class="adopp-native-visible-count"></span>
        <span class="adopp-native-reviewed-count"></span>
      </div>`;
    toolbar.querySelector<HTMLInputElement>(".adopp-native-search")?.addEventListener("input", (event) => {
      this.query = (event.currentTarget as HTMLInputElement).value;
      this.applyFilters();
    });
    for (const dropdown of toolbar.querySelectorAll<HTMLElement>(".adopp-native-dropdown")) {
      const trigger = dropdown.querySelector<HTMLButtonElement>(".adopp-native-dropdown-trigger");
      const menu = dropdown.querySelector<HTMLElement>(".adopp-native-menu");
      trigger?.addEventListener("click", () => toggleNativeMenu(trigger, menu, dropdown));
    }
    for (const choice of toolbar.querySelectorAll<HTMLButtonElement>("[data-choice-kind]")) {
      choice.addEventListener("click", () => {
        if (choice.dataset.choiceKind === "change") this.changeKind = choice.dataset.choiceValue ?? "all";
        if (choice.dataset.choiceKind === "extension") this.extension = choice.dataset.choiceValue ?? "all";
        choice.closest(".adopp-native-menu")?.remove();
        this.renderToolbar(true);
        this.applyFilters();
      });
    }
    for (const toggle of toolbar.querySelectorAll<HTMLButtonElement>("[data-toggle]")) {
      toggle.addEventListener("click", () => {
        if (toggle.dataset.toggle === "viewed") this.hideViewed = !this.hideViewed;
        if (toggle.dataset.toggle === "generated") this.hideGenerated = !this.hideGenerated;
        if (toggle.dataset.toggle === "lockfiles") this.hideLockfiles = !this.hideLockfiles;
        toggle.closest(".adopp-native-menu")?.remove();
        this.renderToolbar(true);
        this.applyFilters();
      });
    }
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>("[data-nav]")) {
      button.addEventListener("click", () => this.navigate(button.dataset.nav as "previous" | "next" | "unreviewed"));
    }
  }

  private renderActionGroup(): void {
    const approve = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => normalize(button.textContent) === "approve");
    if (!approve) {
      document.querySelector("[data-adopp-action-group]")?.remove();
      return;
    }
    const approveSplit = approve.closest<HTMLElement>(".bolt-split-button") ?? approve.parentElement;
    const actionHost = approveSplit?.parentElement;
    if (!approveSplit || !actionHost) return;
    let group = document.querySelector<HTMLElement>("[data-adopp-action-group]");
    if (!group) {
      group = document.createElement("span");
      group.dataset.adoppActionGroup = "true";
      group.className = "adopp-action-group";
      actionHost.insertBefore(group, approveSplit);
    } else if (group.parentElement !== actionHost || group.nextElementSibling !== approveSplit) {
      actionHost.insertBefore(group, approveSplit);
    }
    closeActionMenu();
    group.innerHTML = "";
    const totals = totalStats(this.analysis.files);
    const total = document.createElement("span");
    total.className = "adopp-total-diff";
    total.dataset.exact = String(totals.exact);
    total.title = totals.exact
      ? `Merge-base comparison across ${this.analysis.files.length} files`
      : `Known merge-base comparison totals. ${totals.incomplete} file counts are incomplete.`;
    total.innerHTML = `<span class="adopp-total-plus">+${totals.additions}</span><span class="adopp-total-minus">−${totals.deletions}</span>${totals.exact ? "" : '<span class="adopp-total-partial">partial</span>'}`;
    const panel = document.createElement("button");
    panel.type = "button";
    panel.className = stableNativeClassName(approve);
    panel.classList.add("adopp-panel-button");
    panel.textContent = this.analysis.threads.active > 0 ? `ADO++ (${this.analysis.threads.active})` : "ADO++";
    panel.title = "Open AzureDevOps++ discussions and review tools";
    panel.addEventListener("click", () => this.actions.openDiscussions());
    const startEnabled = resolveFeature(this.settings, "startReviewing").enabled;
    const start = document.createElement("button");
    start.type = "button";
    start.className = stableNativeClassName(approve);
    start.classList.add("adopp-start-button");
    start.textContent = this.actions.isReviewAnnounced() ? "Review started" : "Start Reviewing";
    start.disabled = this.actions.isReviewAnnounced();
    start.hidden = !startEnabled;
    start.addEventListener("click", () => this.actions.startReviewing());
    const nativeMenuButton = [...approveSplit.querySelectorAll<HTMLButtonElement>("button")].find((button) => button !== approve);
    const menuButton = nativeMenuButton?.cloneNode(true) as HTMLButtonElement | undefined ?? document.createElement("button");
    sanitizeClonedNativeControl(menuButton);
    menuButton.type = "button";
    if (!nativeMenuButton) {
      menuButton.className = "bolt-split-button-option flex-self-stretch body-s bolt-button bolt-icon-button enabled icon-only bolt-focus-treatment";
      menuButton.innerHTML = '<span class="fabric-icon ms-Icon--ChevronDownSmall" aria-hidden="true"></span>';
    }
    menuButton.classList.add("adopp-action-menu-button");
    menuButton.setAttribute("aria-label", "More AzureDevOps++ actions");
    for (const eventName of ["pointerdown", "mousedown"]) {
      menuButton.addEventListener(eventName, (event) => event.stopPropagation());
    }
    menuButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const wasOpen = Boolean(document.querySelector(".adopp-action-menu"));
      closeAllNativeMenus();
      closeActionMenu();
      if (wasOpen) return;
      const menu = document.createElement("div");
      menu.className = "adopp-action-menu adopp-native-menu bolt-callout bolt-callout-shadow";
      menu.setAttribute("role", "menu");
      menu.innerHTML = nativeMenuContent(`${nativeMenuItem("discussions", "Open discussion sidebar")}${nativeMenuItem("unreviewed", "Next unreviewed file")}${nativeMenuItem("settings", "AzureDevOps++ settings")}`);
      menu.querySelector('[data-action="discussions"]')?.addEventListener("click", () => {
        closeActionMenu();
        this.actions.openDiscussions();
      });
      menu.querySelector('[data-action="unreviewed"]')?.addEventListener("click", () => {
        closeActionMenu();
        this.navigate("unreviewed");
      });
      menu.querySelector('[data-action="settings"]')?.addEventListener("click", () => {
        closeActionMenu();
        this.actions.openSettings();
      });
      startSplit.dataset.menuOpen = "true";
      menuButton.classList.add("active");
      menuButton.setAttribute("aria-expanded", "true");
      const rect = startSplit.getBoundingClientRect();
      openPortalMenu(menu, rect);
    });
    const startSplit = document.createElement("span");
    startSplit.className = stableNativeClassNames(approveSplit)
      .filter((className) => className !== "repos-pr-header-vote-button")
      .concat("adopp-start-split")
      .join(" ");
    startSplit.append(start, menuButton);
    group.append(total, panel, startSplit);
    this.configureHeaderWrapping(actionHost);
  }

  private applyFilters(): void {
    let visible = 0;
    const visibleRows = new Set<HTMLElement>();
    for (const item of this.rows) {
      const matches = (!this.query || item.file.path.toLowerCase().includes(this.query.toLowerCase()))
        && (this.changeKind === "all" || item.file.changeType.toLowerCase().includes(this.changeKind))
        && (this.extension === "all" || extensionOf(item.file.path) === this.extension)
        && (!this.hideViewed || !isReviewed(item.row))
        && (!this.hideGenerated || !item.file.generated)
        && (!this.hideLockfiles || !item.file.lockfile);
      item.row.classList.toggle("adopp-native-hidden", !matches);
      if (matches) {
        visible++;
        visibleRows.add(item.row);
      }
    }
    updateTreeStructureVisibility(this.rows, visibleRows);
    const comparisonTotal = this.rows.length;
    const prTotal = this.analysis.files.length;
    const hasActiveFilters = Boolean(this.query)
      || this.changeKind !== "all"
      || this.extension !== "all"
      || this.hideViewed
      || this.hideGenerated
      || this.hideLockfiles;
    const count = document.querySelector<HTMLElement>(".adopp-native-visible-count");
    if (count) {
      if (comparisonTotal < prTotal) {
        count.textContent = hasActiveFilters
          ? `${visible}/${comparisonTotal} shown · ${prTotal} PR`
          : `${comparisonTotal} comparison · ${prTotal} PR`;
        count.title = hasActiveFilters
          ? `${visible} of ${comparisonTotal} files in the selected ADO comparison match AzureDevOps++ filters; ${prTotal} files changed across the full pull request.`
          : `${comparisonTotal} files are in the selected ADO comparison; ${prTotal} files changed across the full pull request.`;
      } else {
        count.textContent = `${visible}/${comparisonTotal} files`;
        count.removeAttribute("title");
      }
    }
    const reviewedCount = document.querySelector<HTMLElement>(".adopp-native-reviewed-count");
    if (reviewedCount) {
      const reviewed = this.rows.filter((item) => isReviewed(item.row)).length;
      reviewedCount.textContent = `${reviewed}/${comparisonTotal} reviewed`;
      reviewedCount.title = `${reviewed} of ${comparisonTotal} files in the selected ADO comparison are marked reviewed.`;
    }
  }

  private navigate(direction: "previous" | "next" | "unreviewed"): void {
    const visible = this.rows.filter((item) => !item.row.classList.contains("adopp-native-hidden"));
    const candidates = direction === "unreviewed" ? visible.filter((item) => !isReviewed(item.row)) : visible;
    if (!candidates.length) return;
    const currentPath = new URL(location.href).searchParams.get("path");
    const pathIndex = candidates.findIndex((item) => item.file.path === currentPath);
    const currentIndex = pathIndex >= 0 ? pathIndex : candidates.findIndex((item) => isSelectedFileRow(item.row));
    const index = direction === "previous"
      ? Math.max(0, currentIndex <= 0 ? candidates.length - 1 : currentIndex - 1)
      : Math.min(candidates.length - 1, currentIndex < 0 || currentIndex === candidates.length - 1 ? 0 : currentIndex + 1);
    const target = candidates[index];
    if (!target) return;
    const nativeTarget = target.label.closest<HTMLElement>('[role="row"]')
      ?? target.label.closest<HTMLElement>("button,[role=button]")
      ?? target.label;
    if (nativeTarget) nativeTarget.click();
    else navigateToAdoFile(target.file.path);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      closeAllNativeMenus();
      closeActionMenu();
      return;
    }
    if (!resolveFeature(this.settings, "keyboardShortcuts").enabled || isTyping(event.target)) return;
    const key = event.key.toLowerCase();
    if (!["j", "k", "n"].includes(key)) return;
    event.preventDefault();
    this.navigate(key === "k" ? "previous" : key === "n" ? "unreviewed" : "next");
  };

  private readonly onAnnouncementChanged = (): void => {
    this.renderActionGroup();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".adopp-native-menu,.adopp-native-dropdown-trigger,.adopp-action-menu-button")) return;
    closeAllNativeMenus();
    closeActionMenu();
  };

  private readonly onNativeTreeInteraction = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(ADO_FILE_TREE_SELECTOR)) return;
    if (!target.closest('input[type="checkbox"],[role="checkbox"],[role="row"],tr')) return;
    window.clearTimeout(this.reviewRefreshScheduled);
    this.reviewRefreshScheduled = window.setTimeout(() => {
      this.rows = this.findFileRows();
      this.applyFilters();
    }, 0);
  };

  private readonly onHeaderLayoutChanged = (): void => {
    window.requestAnimationFrame(() => {
      const actionHost = document.querySelector<HTMLElement>("[data-adopp-action-group]")?.parentElement;
      if (actionHost) this.configureHeaderWrapping(actionHost, true);
    });
  };

  private configureHeaderWrapping(actionHost: HTMLElement, force = false): void {
    const title = document.querySelector<HTMLInputElement>('input[aria-label="Pull request title"]');
    const layout = title ? findHeaderLayout(title, actionHost) : null;
    if (!title || !layout) {
      this.clearHeaderWrapping();
      return;
    }
    if (this.headerTitleInput !== title) {
      this.headerTitleInput?.removeEventListener("input", this.onHeaderLayoutChanged);
      this.headerTitleInput = title;
      title.addEventListener("input", this.onHeaderLayoutChanged);
    }
    const layoutChanged = this.headerWrapContainer !== layout.container || this.headerActionItem !== layout.actionItem;
    if (layoutChanged) {
      this.clearHeaderWrapping(false);
      this.headerWrapContainer = layout.container;
      this.headerActionItem = layout.actionItem;
      layout.container.classList.add("adopp-header-wrap");
      layout.actionItem.classList.add("adopp-header-action-item");
    }
    if (!force && !layoutChanged && layout.container.classList.contains("adopp-header-actions-wrapped")) return;
    const availableWidth = layout.container.clientWidth || layout.container.getBoundingClientRect().width;
    const titleRect = title.getBoundingClientRect();
    const titleItemRect = layout.titleItem.getBoundingClientRect();
    const titleViewportWidth = title.clientWidth || titleRect.width;
    const titleChromeWidth = Math.max(0, titleItemRect.width - titleRect.width);
    const intrinsicTitleWidth = Math.max(title.scrollWidth, measureInputTextWidth(title));
    const actionWidth = Math.max(layout.actionItem.scrollWidth, layout.actionItem.getBoundingClientRect().width);
    const titleIsClipped = titleViewportWidth > 0 && intrinsicTitleWidth > titleViewportWidth + 1;
    const shouldWrap = availableWidth > 0
      && (titleIsClipped || intrinsicTitleWidth + titleChromeWidth + actionWidth + 24 > availableWidth);
    layout.container.classList.toggle("adopp-header-actions-wrapped", shouldWrap);
  }

  private clearHeaderWrapping(clearTitle = true): void {
    this.headerWrapContainer?.classList.remove("adopp-header-wrap", "adopp-header-actions-wrapped");
    this.headerActionItem?.classList.remove("adopp-header-action-item");
    this.headerWrapContainer = null;
    this.headerActionItem = null;
    if (clearTitle) {
      this.headerTitleInput?.removeEventListener("input", this.onHeaderLayoutChanged);
      this.headerTitleInput = null;
    }
  }

  private ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = nativeStyles;
    document.head.append(style);
  }
}

function isReviewed(row: HTMLElement): boolean {
  const input = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (input) return input.checked;
  const checkbox = row.querySelector<HTMLElement>('[role="checkbox"]');
  return checkbox?.getAttribute("aria-checked") === "true";
}

function isSelectedFileRow(row: HTMLElement): boolean {
  return row.getAttribute("aria-selected") === "true"
    || Boolean(row.querySelector('[aria-selected="true"]'))
    || row.classList.contains("selected");
}

function findNativeFileTree(files: FileStat[]): HTMLElement | null {
  const basenames = new Set(files.map((file) => basenameOf(file.path).toLowerCase()));
  const nativeTrees = [...document.querySelectorAll<HTMLElement>(ADO_FILE_TREE_SELECTOR)];
  for (const tree of nativeTrees) {
    if (scoreFileTree(tree, basenames) > 0) return tree;
  }

  let best: { element: HTMLElement; score: number } | null = null;
  for (const element of document.querySelectorAll<HTMLElement>('table,[role="treegrid"],[role="tree"]')) {
    const score = scoreFileTree(element, basenames);
    if (score > 0 && (!best || score > best.score)) best = { element, score };
  }
  return best?.element ?? null;
}

function scoreFileTree(tree: HTMLElement, basenames: Set<string>): number {
  const rows = [...tree.querySelectorAll<HTMLElement>('tr,[role="row"]')];
  return [...basenames].filter((basename) => rows.some((row) => rowMatchesFile(row, basename))).length;
}

function findToolbarMount(tree: HTMLElement): { host: HTMLElement; before: HTMLElement } | null {
  const reviewedControl = [...document.querySelectorAll<HTMLElement>('input[type="checkbox"],[role="checkbox"]')]
    .find((element) => normalize(element.getAttribute("aria-label")) === "mark as reviewed");
  if (reviewedControl) {
    const common = lowestCommonAncestor(tree, reviewedControl);
    const branch = common ? directChildContaining(common, tree) : null;
    if (common && branch && isFilePaneSized(common, tree)) return { host: common, before: branch };
  }

  let candidate: { host: HTMLElement; before: HTMLElement } | null = null;
  for (let ancestor = tree.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    const branch = directChildContaining(ancestor, tree);
    if (branch && isFilePaneSized(ancestor, tree)) candidate = { host: ancestor, before: branch };
  }
  return candidate;
}

function findHeaderLayout(
  title: HTMLInputElement,
  actionHost: HTMLElement
): { container: HTMLElement; titleItem: HTMLElement; actionItem: HTMLElement } | null {
  for (let container = title.parentElement; container; container = container.parentElement) {
    if (!container.contains(actionHost)) continue;
    const titleItem = directChildContaining(container, title);
    const actionItem = directChildContaining(container, actionHost);
    if (titleItem && actionItem && titleItem !== actionItem) return { container, titleItem, actionItem };
  }
  return null;
}

function measureInputTextWidth(input: HTMLInputElement): number {
  const style = getComputedStyle(input);
  const probe = document.createElement("span");
  probe.textContent = input.value || input.placeholder;
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.whiteSpace = "pre";
  probe.style.font = style.font;
  probe.style.fontKerning = style.fontKerning;
  probe.style.letterSpacing = style.letterSpacing;
  document.body.append(probe);
  const measured = probe.getBoundingClientRect().width;
  probe.remove();
  const horizontalPadding = Number.parseFloat(style.paddingLeft || "0") + Number.parseFloat(style.paddingRight || "0");
  return Math.max(measured + horizontalPadding, input.value.length * 8.5 + horizontalPadding);
}

function lowestCommonAncestor(first: HTMLElement, second: HTMLElement): HTMLElement | null {
  const ancestors = new Set<HTMLElement>();
  for (let current: HTMLElement | null = first; current; current = current.parentElement) ancestors.add(current);
  for (let current: HTMLElement | null = second; current; current = current.parentElement) {
    if (ancestors.has(current)) return current;
  }
  return null;
}

function directChildContaining(parent: HTMLElement, descendant: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = descendant;
  while (current?.parentElement && current.parentElement !== parent) current = current.parentElement;
  return current?.parentElement === parent ? current : null;
}

function isFilePaneSized(candidate: HTMLElement, tree: HTMLElement): boolean {
  const candidateRect = candidate.getBoundingClientRect();
  const treeRect = tree.getBoundingClientRect();
  if (candidateRect.width === 0 || treeRect.width === 0) {
    return candidate.classList.contains("file-tree-pane") || candidate.hasAttribute("data-file-tree-pane");
  }
  return Math.abs(candidateRect.left - treeRect.left) <= 40
    && candidateRect.width >= treeRect.width * 0.8
    && candidateRect.width <= treeRect.width + 160;
}

function rowMatchesFile(row: HTMLElement, basename: string): boolean {
  if (findRowLabel(row, basename)) return true;
  const text = nativeRowText(row);
  const normalizedName = basename.toLowerCase();
  return text === normalizedName || text.startsWith(`${normalizedName} `);
}

function findRowLabel(row: HTMLElement, basename: string): HTMLElement | null {
  const normalizedName = basename.toLowerCase();
  const candidates = [...row.querySelectorAll<HTMLElement>("button,[role=button],span,div")];
  for (const candidate of candidates.reverse()) {
    if (normalize(candidate.textContent).replace(/\s+\+$/, "") === normalizedName) return candidate;
  }
  return null;
}

function updateTreeStructureVisibility(fileRows: NativeFileRow[], visibleFileRows: Set<HTMLElement>): void {
  const tree = fileRows[0]?.row.closest<HTMLElement>(ADO_FILE_TREE_SELECTOR);
  if (!tree) return;
  const fileRowSet = new Set(fileRows.map((item) => item.row));
  const outerRows = [...tree.querySelectorAll<HTMLElement>('tr,[role="row"]')]
    .filter((row) => !row.parentElement?.closest('tr,[role="row"]'));
  const levels = outerRows.map((row) => treeRowLevel(row));

  if (visibleFileRows.size === 0) {
    for (const row of outerRows) row.classList.add("adopp-native-hidden");
    return;
  }

  let precedingFileVisible: boolean | null = null;
  for (let index = 0; index < outerRows.length; index++) {
    const row = outerRows[index]!;
    if (fileRowSet.has(row)) {
      precedingFileVisible = visibleFileRows.has(row);
      continue;
    }
    if (isFolderRow(row)) {
      precedingFileVisible = null;
      const level = levels[index] ?? null;
      const hasVisibleDescendant = level === null
        ? folderMatchesVisiblePath(row, fileRows, visibleFileRows)
        : hasVisibleTreeDescendant(outerRows, levels, index, level, visibleFileRows);
      row.classList.toggle("adopp-native-hidden", !hasVisibleDescendant);
      continue;
    }
    if (precedingFileVisible !== null) {
      row.classList.toggle("adopp-native-hidden", !precedingFileVisible);
    } else {
      row.classList.remove("adopp-native-hidden");
    }
  }
}

function hasVisibleTreeDescendant(
  rows: HTMLElement[],
  levels: Array<number | null>,
  folderIndex: number,
  folderLevel: number,
  visibleFileRows: Set<HTMLElement>
): boolean {
  for (let index = folderIndex + 1; index < rows.length; index++) {
    const level = levels[index] ?? null;
    if (level !== null && level <= folderLevel) break;
    if (visibleFileRows.has(rows[index]!)) return true;
  }
  return false;
}

function treeRowLevel(row: HTMLElement): number | null {
  const value = row.getAttribute("aria-level") ?? row.querySelector<HTMLElement>("[aria-level]")?.getAttribute("aria-level");
  const level = Number.parseInt(value ?? "", 10);
  return Number.isFinite(level) ? level : null;
}

function isFolderRow(row: HTMLElement): boolean {
  return row.hasAttribute("aria-expanded") || Boolean(row.querySelector("[aria-expanded]"));
}

function folderMatchesVisiblePath(row: HTMLElement, fileRows: NativeFileRow[], visibleFileRows: Set<HTMLElement>): boolean {
  const label = nativeRowText(row).replace(/^[⌄>]+\s*/, "").replace(/\\/g, "/").replace(/^\/|\/$/g, "");
  if (!label) return false;
  const normalized = label.toLowerCase();
  return fileRows.some(({ file, row: fileRow }) => {
    if (!visibleFileRows.has(fileRow)) return false;
    const path = file.path.toLowerCase().replace(/^\/|\/$/g, "");
    return normalized.includes("/")
      ? path === normalized || path.startsWith(`${normalized}/`) || path.includes(`/${normalized}/`)
      : path.split("/").slice(0, -1).includes(normalized);
  });
}

function basenameOf(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function nativeRowText(row: HTMLElement): string {
  const clone = row.cloneNode(true) as HTMLElement;
  for (const stat of clone.querySelectorAll("[data-adopp-inline-stat]")) stat.remove();
  return normalize(clone.textContent);
}

function renderStat(element: HTMLElement, file: FileStat): void {
  if (file.state !== "exact") {
    element.textContent = file.state;
    return;
  }
  element.innerHTML = `<span class="adopp-native-stat-plus">+${file.additions}</span> <span class="adopp-native-stat-minus">−${file.deletions}</span>`;
}

function extensionOf(path: string): string {
  const name = path.split("/").at(-1) ?? "";
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

function normalize(value: string | null): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] as string);
}

function isOwnedMutation(target: Node): boolean {
  const element = target instanceof Element ? target : target.parentElement;
  return Boolean(element?.closest("[data-adopp-native-toolbar],[data-adopp-action-group],[data-adopp-inline-stat],.adopp-native-menu,.adopp-action-menu"));
}

function isOwnedMutationRecord(record: MutationRecord): boolean {
  if (isOwnedMutation(record.target)) return true;
  const changedNodes = [...record.addedNodes, ...record.removedNodes];
  return changedNodes.length > 0 && changedNodes.every((node) => isOwnedMutation(node));
}

function nativeMenuItem(action: string, label: string): string {
  return `<div class="bolt-list-row bolt-menu-item" role="presentation"><div class="bolt-list-cell"><button class="bolt-button bolt-menu-button enabled subtle flex-row flex-center bolt-focus-treatment body-m" type="button" role="menuitem" data-action="${action}"><span class="bolt-button-text">${label}</span></button></div></div>`;
}

function sanitizeClonedNativeControl(element: HTMLElement): void {
  for (const candidate of [element, ...element.querySelectorAll<HTMLElement>("*")]) {
    candidate.removeAttribute("id");
    candidate.removeAttribute("style");
    candidate.removeAttribute("aria-controls");
    candidate.removeAttribute("aria-owns");
    candidate.removeAttribute("aria-expanded");
    candidate.removeAttribute("aria-pressed");
    for (const attribute of [...candidate.attributes]) {
      if (attribute.name.startsWith("data-")) candidate.removeAttribute(attribute.name);
    }
    for (const className of [...candidate.classList]) {
      if (isTransientNativeClass(className)) candidate.classList.remove(className);
    }
  }
}

function stableNativeClassName(element: HTMLElement): string {
  return stableNativeClassNames(element).join(" ");
}

function stableNativeClassNames(element: HTMLElement): string[] {
  return [...element.classList].filter((className) => !isTransientNativeClass(className));
}

function isTransientNativeClass(className: string): boolean {
  return ["active", "selected", "pressed", "focused", "focus-visible", "expanded", "checked", "bolt-button-active"].includes(className);
}

function nativeToggleMenuItem(toggle: string, label: string, active: boolean): string {
  return `<div class="bolt-list-row bolt-menu-item" role="presentation"><div class="bolt-list-cell"><button class="bolt-button bolt-menu-button enabled subtle flex-row flex-center bolt-focus-treatment body-m adopp-native-toggle" type="button" role="menuitemcheckbox" aria-checked="${active}" data-toggle="${toggle}"><span class="fabric-icon ms-Icon--CheckMark adopp-native-menu-check" data-active="${active}" aria-hidden="true"></span><span class="bolt-button-text">${label}</span></button></div></div>`;
}

function nativeChoiceMenuItem(kind: string, value: string, label: string, selected: boolean): string {
  return `<div class="bolt-list-row bolt-menu-item" role="presentation"><div class="bolt-list-cell"><button class="bolt-button bolt-menu-button enabled subtle flex-row flex-center bolt-focus-treatment body-m" type="button" role="menuitemradio" aria-checked="${selected}" data-choice-kind="${kind}" data-choice-value="${escapeHtml(value)}"><span class="fabric-icon ms-Icon--CheckMark adopp-native-menu-check" data-active="${selected}" aria-hidden="true"></span><span class="bolt-button-text">${escapeHtml(label)}</span></button></div></div>`;
}

function nativeDropdownTrigger(reference: HTMLButtonElement | null, label: string, ariaLabel: string, extraClass = ""): string {
  const button = reference?.cloneNode(true) as HTMLButtonElement | undefined ?? document.createElement("button");
  sanitizeClonedNativeControl(button);
  button.type = "button";
  button.className = "bolt-button enabled subtle flex-row flex-center bolt-focus-treatment body-s adopp-native-dropdown-trigger";
  for (const className of extraClass.split(/\s+/).filter(Boolean)) button.classList.add(className);
  button.setAttribute("aria-label", ariaLabel);
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const text = button.querySelector<HTMLElement>(".bolt-button-text")
    ?? [...button.querySelectorAll<HTMLElement>("span,div")].find((element) => normalize(element.textContent) === "all changes");
  if (text) text.textContent = label;
  else button.prepend(Object.assign(document.createElement("span"), { className: "bolt-button-text", textContent: label }));
  if (!button.querySelector(".ms-Icon--ChevronDownSmall")) {
    const chevron = document.createElement("span");
    chevron.className = "fabric-icon ms-Icon--ChevronDownSmall";
    chevron.setAttribute("aria-hidden", "true");
    button.append(chevron);
  }
  return button.outerHTML;
}

function nativeMenuShell(extraClass: string, items: string): string {
  return `<div class="${extraClass} adopp-native-menu bolt-callout bolt-callout-shadow" role="menu" hidden>${nativeMenuContent(items)}</div>`;
}

function nativeMenuContent(items: string): string {
  return `<div class="bolt-callout-content"><div class="bolt-menu flex-column custom-scrollbar"><div class="bolt-list" role="presentation">${items}</div></div></div>`;
}

function toggleNativeMenu(trigger: HTMLButtonElement, menu: HTMLElement | null, owner: HTMLElement): void {
  if (!menu) return;
  const opening = menu.hidden;
  closeAllNativeMenus();
  if (!opening) return;
  const rect = trigger.getBoundingClientRect();
  menu.hidden = false;
  menu.dataset.adoppFilterPortal = "true";
  menu.dataset.adoppOwner = owner.dataset.dropdown ?? "";
  openPortalMenu(menu, rect);
  trigger.setAttribute("aria-expanded", "true");
}

function closeAllNativeMenus(): void {
  for (const menu of document.querySelectorAll<HTMLElement>('[data-adopp-filter-portal="true"]')) {
    const owner = [...document.querySelectorAll<HTMLElement>(".adopp-native-dropdown")]
      .find((candidate) => candidate.dataset.dropdown === menu.dataset.adoppOwner);
    if (owner) owner.append(menu);
    menu.hidden = true;
    menu.removeAttribute("data-adopp-filter-portal");
    menu.removeAttribute("data-adopp-owner");
    menu.style.cssText = "";
  }
  for (const wrapper of document.querySelectorAll<HTMLElement>(".adopp-native-dropdown")) {
    wrapper.querySelector<HTMLButtonElement>(".adopp-native-dropdown-trigger")?.setAttribute("aria-expanded", "false");
    const menu = wrapper.querySelector<HTMLElement>(".adopp-native-menu");
    if (menu) menu.hidden = true;
  }
}

function closeActionMenu(): void {
  document.querySelector(".adopp-action-menu")?.remove();
  const split = document.querySelector<HTMLElement>(".adopp-start-split");
  split?.removeAttribute("data-menu-open");
  for (const button of split?.querySelectorAll<HTMLButtonElement>(".bolt-button") ?? []) {
    button.classList.remove("active");
  }
  split?.querySelector<HTMLButtonElement>(".adopp-action-menu-button")?.setAttribute("aria-expanded", "false");
}

function openPortalMenu(menu: HTMLElement, rect: DOMRect): void {
  menu.style.position = "fixed";
  menu.style.visibility = "hidden";
  menu.style.width = "max-content";
  menu.style.minWidth = "0";
  menu.style.maxWidth = "none";
  document.body.append(menu);
  const width = preferredMenuWidth(menu, rect.width);
  menu.style.width = `${width}px`;
  menu.style.minWidth = `${width}px`;
  menu.style.maxWidth = `${width}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.zIndex = "2147483647";
  menu.style.visibility = "";
}

function preferredMenuWidth(menu: HTMLElement, triggerWidth: number): number {
  const labels = [...menu.querySelectorAll<HTMLElement>(".bolt-button-text")];
  const estimatedLabelWidth = labels.reduce((width, label) =>
    Math.max(width, Math.ceil((label.textContent?.trim().length ?? 0) * 8.5) + 64), 0);
  const viewportLimit = Math.max(160, window.innerWidth - 16);
  return Math.min(320, viewportLimit, Math.max(1, triggerWidth, estimatedLabelWidth));
}

function findNativeDropdownButton(): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => !button.closest("[data-adopp-native-toolbar]") && normalize(button.textContent) === "all changes") ?? null;
}

function changeKindLabel(kind: string): string {
  return kind === "all" ? "Change type" : capitalize(kind);
}

function capitalize(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

const nativeStyles = `
.adopp-native-stat{display:inline-flex;margin-left:8px;white-space:nowrap;font:600 11px/1.4 Consolas,"Cascadia Mono",monospace;color:var(--palette-neutral-60,#8a8886)}
.adopp-native-stat[data-state="exact"]{color:var(--palette-neutral-70,#605e5c)}
.adopp-native-stat-plus{color:var(--status-success-foreground,#107c10)}.adopp-native-stat-minus{color:var(--status-error-foreground,#a4262c)}
.adopp-native-toolbar{display:grid;gap:6px;width:100%;box-sizing:border-box;padding:8px 10px;border-bottom:1px solid var(--palette-neutral-20,#edebe9);background:var(--background-color,#fff);font:12px "Segoe UI",sans-serif}
.adopp-native-toolbar-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:5px;min-width:0}.adopp-native-search{min-width:0;width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid var(--palette-neutral-30,#c8c6c4);background:transparent;color:inherit}.adopp-native-nav-controls{display:flex;align-items:center;gap:2px}
.adopp-native-nav{width:30px;min-width:30px;min-height:28px;padding:4px 7px;border:1px solid var(--palette-neutral-30,#c8c6c4);border-radius:2px;background:transparent;color:inherit;font:inherit;cursor:pointer}.adopp-native-nav:hover{background:var(--palette-neutral-10,#f3f2f1)}.adopp-nav-icon{display:block;width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round;overflow:visible}.adopp-nav-double-icon{height:16px}.adopp-native-filters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.78fr) minmax(76px,.72fr);align-items:center;gap:5px}.adopp-native-dropdown{position:relative;min-width:0}.adopp-native-dropdown-trigger{width:100%;min-width:0;justify-content:space-between!important;gap:8px!important}.adopp-native-dropdown-trigger .bolt-button-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.adopp-native-dropdown-trigger .ms-Icon--ChevronDownSmall{flex:none}.adopp-native-menu{z-index:100000;box-sizing:border-box!important;overflow:hidden!important}.adopp-native-menu[data-adopp-filter-portal="true"]{position:fixed!important}.adopp-native-menu[hidden]{display:none!important}.adopp-native-menu .bolt-callout-content,.adopp-native-menu .bolt-menu,.adopp-native-menu .bolt-list,.adopp-native-menu .bolt-list-row,.adopp-native-menu .bolt-list-cell{box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:100%!important}.adopp-native-menu .bolt-list-row,.adopp-native-menu .bolt-list-cell{display:block!important}.adopp-native-menu .bolt-menu-button{box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:100%!important;overflow:hidden!important}.adopp-native-menu-check{display:inline-flex;width:16px;flex:none;visibility:hidden}.adopp-native-menu-check[data-active="true"]{visibility:visible}.adopp-native-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:1px 2px 0;color:var(--palette-neutral-60,#8a8886);white-space:nowrap}.adopp-native-visible-count,.adopp-native-reviewed-count{white-space:nowrap}
.adopp-native-hidden{display:none!important}.adopp-header-action-item{white-space:nowrap}.adopp-header-wrap.adopp-header-actions-wrapped{flex-wrap:wrap!important}.adopp-header-wrap.adopp-header-actions-wrapped>.adopp-header-action-item{display:flex!important;flex:0 0 100%!important;width:100%!important;max-width:100%!important;justify-content:flex-end!important;margin-left:0!important;padding-top:8px}.adopp-action-group{position:relative;display:inline-flex;align-items:center;gap:0;margin-right:8px}.adopp-total-diff{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 9px;margin-right:8px;border:1px solid var(--palette-neutral-30,#c8c6c4);border-radius:2px;background:var(--background-color,#fff);font:600 12px Consolas,"Cascadia Mono",monospace;white-space:nowrap}.adopp-total-plus{color:var(--status-success-foreground,#107c10)}.adopp-total-minus{color:var(--status-error-foreground,#a4262c)}.adopp-total-partial{font:10px "Segoe UI",sans-serif;color:var(--palette-neutral-60,#8a8886)}.adopp-panel-button{margin-right:8px!important}.adopp-start-split .adopp-action-menu-button{border-left:1px solid var(--palette-neutral-60,#8a8886)!important}
.adopp-action-menu{position:fixed!important}.adopp-action-menu .bolt-menu-button,.adopp-native-menu .bolt-menu-button{width:100%;justify-content:flex-start!important}.adopp-action-menu .bolt-button-text,.adopp-native-menu .bolt-button-text{min-width:0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(max-width:440px){.adopp-native-toolbar{padding-left:7px;padding-right:7px}}
`;
