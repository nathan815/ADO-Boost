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
      if (records.some((record) => !isOwnedMutation(record.target))) this.schedule();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", this.onKeyDown, true);
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
    document.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("adopp:announcement-changed", this.onAnnouncementChanged);
    document.querySelector("[data-adopp-native-toolbar]")?.remove();
    document.querySelector("[data-adopp-action-group]")?.remove();
    document.querySelector('[data-adopp-filter-portal="true"]')?.remove();
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
    return [...found.values()];
  }

  private renderInlineStats(): void {
    if (!resolveFeature(this.settings, "prOverview").enabled) return;
    for (const { file, row, label } of this.rows) {
      const existing = [...row.querySelectorAll<HTMLElement>("[data-adopp-inline-stat]")]
        .find((candidate) => candidate.dataset.adoppInlineStat === file.path);
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
    document.querySelector('[data-adopp-filter-portal="true"]')?.remove();
    toolbar.innerHTML = `
      <div class="adopp-native-toolbar-row">
        <input class="adopp-native-search" type="search" value="${escapeHtml(this.query)}" placeholder="Search changed files" aria-label="Search changed files">
        <button class="adopp-native-nav" data-nav="previous" type="button" title="Previous file">↑</button>
        <button class="adopp-native-nav" data-nav="next" type="button" title="Next file">↓</button>
        <button class="adopp-native-nav adopp-native-next-unreviewed" data-nav="unreviewed" type="button"><span class="adopp-native-next-long">Next unreviewed</span><span class="adopp-native-next-short">Next</span></button>
      </div>
      <div class="adopp-native-toolbar-row adopp-native-filters">
        <select class="adopp-native-change" aria-label="Filter by change kind"><option value="all">All changes</option>${["add", "edit", "delete", "rename"].map((kind) => `<option value="${kind}" ${this.changeKind === kind ? "selected" : ""}>${kind}</option>`).join("")}</select>
        <select class="adopp-native-extension" aria-label="Filter by extension"><option value="all">All types</option>${extensions.map((value) => `<option value="${escapeHtml(value)}" ${this.extension === value ? "selected" : ""}>.${escapeHtml(value)}</option>`).join("")}</select>
        <div class="adopp-native-filter-wrap">
          <button class="adopp-native-filter-trigger bolt-button enabled subtle" type="button" aria-expanded="false">Filters${activeFilterCount ? ` (${activeFilterCount})` : ""} <span aria-hidden="true">▾</span></button>
          <div class="adopp-native-filter-menu bolt-callout bolt-callout-shadow" role="menu" hidden>
            <div class="bolt-menu flex-column custom-scrollbar"><div class="bolt-list" role="presentation">
              ${nativeToggleMenuItem("viewed", "Hide viewed files", this.hideViewed)}
              ${nativeToggleMenuItem("generated", "Hide generated files", this.hideGenerated)}
              ${nativeToggleMenuItem("lockfiles", "Hide lockfiles", this.hideLockfiles)}
            </div></div>
          </div>
        </div>
        <span class="adopp-native-visible-count"></span>
      </div>`;
    toolbar.querySelector<HTMLInputElement>(".adopp-native-search")?.addEventListener("input", (event) => {
      this.query = (event.currentTarget as HTMLInputElement).value;
      this.applyFilters();
    });
    toolbar.querySelector<HTMLSelectElement>(".adopp-native-change")?.addEventListener("change", (event) => {
      this.changeKind = (event.currentTarget as HTMLSelectElement).value;
      this.applyFilters();
    });
    toolbar.querySelector<HTMLSelectElement>(".adopp-native-extension")?.addEventListener("change", (event) => {
      this.extension = (event.currentTarget as HTMLSelectElement).value;
      this.applyFilters();
    });
    const filterTrigger = toolbar.querySelector<HTMLButtonElement>(".adopp-native-filter-trigger");
    const filterMenu = toolbar.querySelector<HTMLElement>(".adopp-native-filter-menu");
    const filterWrap = toolbar.querySelector<HTMLElement>(".adopp-native-filter-wrap");
    filterTrigger?.addEventListener("click", () => {
      if (!filterMenu || !filterWrap) return;
      const opening = filterMenu.hidden;
      if (opening) {
        const rect = filterTrigger.getBoundingClientRect();
        const width = Math.max(248, rect.width);
        filterMenu.hidden = false;
        filterMenu.dataset.adoppFilterPortal = "true";
        document.body.append(filterMenu);
        filterMenu.style.width = `${width}px`;
        filterMenu.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
        filterMenu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - filterMenu.offsetHeight - 8)}px`;
      } else {
        filterMenu.hidden = true;
        filterMenu.removeAttribute("data-adopp-filter-portal");
        filterMenu.removeAttribute("style");
        filterWrap.append(filterMenu);
      }
      filterTrigger.setAttribute("aria-expanded", String(opening));
    });
    for (const toggle of toolbar.querySelectorAll<HTMLButtonElement>("[data-toggle]")) {
      toggle.addEventListener("click", () => {
        if (toggle.dataset.toggle === "viewed") this.hideViewed = !this.hideViewed;
        if (toggle.dataset.toggle === "generated") this.hideGenerated = !this.hideGenerated;
        if (toggle.dataset.toggle === "lockfiles") this.hideLockfiles = !this.hideLockfiles;
        filterMenu?.remove();
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
    let group = document.querySelector<HTMLElement>("[data-adopp-action-group]");
    if (!group) {
      group = document.createElement("span");
      group.dataset.adoppActionGroup = "true";
      group.className = "adopp-action-group";
      approve.parentElement?.insertBefore(group, approve);
    }
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
    panel.className = approve.className;
    panel.classList.add("adopp-panel-button");
    panel.textContent = this.analysis.threads.active > 0 ? `ADO++ (${this.analysis.threads.active})` : "ADO++";
    panel.title = "Open AzureDevOps++ discussions and review tools";
    panel.addEventListener("click", () => this.actions.openDiscussions());
    const startEnabled = resolveFeature(this.settings, "startReviewing").enabled;
    const start = document.createElement("button");
    start.type = "button";
    start.className = approve.className;
    start.classList.add("adopp-start-button");
    start.textContent = this.actions.isReviewAnnounced() ? "Review started" : "Start Reviewing";
    start.disabled = this.actions.isReviewAnnounced();
    start.hidden = !startEnabled;
    start.addEventListener("click", () => this.actions.startReviewing());
    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = approve.className;
    menuButton.classList.add("adopp-action-menu-button");
    menuButton.textContent = "▾";
    menuButton.setAttribute("aria-label", "More AzureDevOps++ actions");
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      group!.querySelector(".adopp-action-menu")?.remove();
      const menu = document.createElement("div");
      menu.className = "adopp-action-menu bolt-callout bolt-callout-shadow";
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div class="bolt-menu flex-column custom-scrollbar"><div class="bolt-list" role="presentation">${nativeMenuItem("discussions", "Open discussion sidebar")}${nativeMenuItem("unreviewed", "Next unreviewed file")}${nativeMenuItem("settings", "AzureDevOps++ settings")}</div></div>`;
      menu.querySelector('[data-action="discussions"]')?.addEventListener("click", () => {
        menu.remove();
        this.actions.openDiscussions();
      });
      menu.querySelector('[data-action="unreviewed"]')?.addEventListener("click", () => {
        menu.remove();
        this.navigate("unreviewed");
      });
      menu.querySelector('[data-action="settings"]')?.addEventListener("click", () => {
        menu.remove();
        this.actions.openSettings();
      });
      group!.append(menu);
    });
    group.append(total, panel, start, menuButton);
  }

  private applyFilters(): void {
    let visible = 0;
    for (const item of this.rows) {
      const matches = (!this.query || item.file.path.toLowerCase().includes(this.query.toLowerCase()))
        && (this.changeKind === "all" || item.file.changeType.toLowerCase().includes(this.changeKind))
        && (this.extension === "all" || extensionOf(item.file.path) === this.extension)
        && (!this.hideViewed || !isReviewed(item.row))
        && (!this.hideGenerated || !item.file.generated)
        && (!this.hideLockfiles || !item.file.lockfile);
      item.row.classList.toggle("adopp-native-hidden", !matches);
      if (matches) visible++;
    }
    const count = document.querySelector<HTMLElement>(".adopp-native-visible-count");
    if (count) count.textContent = `${visible}/${this.analysis.files.length} files`;
  }

  private navigate(direction: "previous" | "next" | "unreviewed"): void {
    const visible = this.rows.filter((item) => !item.row.classList.contains("adopp-native-hidden"));
    const candidates = direction === "unreviewed" ? visible.filter((item) => !isReviewed(item.row)) : visible;
    if (!candidates.length) return;
    const currentPath = new URL(location.href).searchParams.get("path");
    const currentIndex = candidates.findIndex((item) => item.file.path === currentPath);
    const index = direction === "previous"
      ? Math.max(0, currentIndex <= 0 ? candidates.length - 1 : currentIndex - 1)
      : Math.min(candidates.length - 1, currentIndex < 0 || currentIndex === candidates.length - 1 ? 0 : currentIndex + 1);
    const target = candidates[index];
    if (target) navigateToAdoFile(target.file.path);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!resolveFeature(this.settings, "keyboardShortcuts").enabled || isTyping(event.target)) return;
    const key = event.key.toLowerCase();
    if (!["j", "k", "n"].includes(key)) return;
    event.preventDefault();
    this.navigate(key === "k" ? "previous" : key === "n" ? "unreviewed" : "next");
  };

  private readonly onAnnouncementChanged = (): void => {
    this.renderActionGroup();
  };

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
  return Boolean(element?.closest("[data-adopp-native-toolbar],[data-adopp-action-group],[data-adopp-inline-stat]"));
}

function nativeMenuItem(action: string, label: string): string {
  return `<div class="bolt-list-row bolt-menu-item" role="presentation"><div class="bolt-list-cell"><button class="bolt-button bolt-menu-button enabled subtle flex-row flex-center" type="button" role="menuitem" data-action="${action}"><span class="bolt-button-text">${label}</span></button></div></div>`;
}

function nativeToggleMenuItem(toggle: string, label: string, active: boolean): string {
  return `<div class="bolt-list-row bolt-menu-item" role="presentation"><div class="bolt-list-cell"><button class="bolt-button bolt-menu-button enabled subtle flex-row flex-center adopp-native-toggle" type="button" role="menuitemcheckbox" aria-checked="${active}" aria-pressed="${active}" data-toggle="${toggle}"><span class="adopp-native-filter-check" data-active="${active}" aria-hidden="true">${active ? "✓" : ""}</span><span class="bolt-button-text">${label}</span></button></div></div>`;
}

const nativeStyles = `
.adopp-native-stat{display:inline-flex;margin-left:8px;white-space:nowrap;font:600 11px/1.4 Consolas,"Cascadia Mono",monospace;color:var(--palette-neutral-60,#8a8886)}
.adopp-native-stat[data-state="exact"]{color:var(--palette-neutral-70,#605e5c)}
.adopp-native-stat-plus{color:var(--status-success-foreground,#107c10)}.adopp-native-stat-minus{color:var(--status-error-foreground,#a4262c)}
.adopp-native-toolbar{display:grid;gap:6px;width:100%;box-sizing:border-box;padding:8px 10px;border-bottom:1px solid var(--palette-neutral-20,#edebe9);background:var(--background-color,#fff);font:12px "Segoe UI",sans-serif}
.adopp-native-toolbar-row{display:grid;grid-template-columns:minmax(0,1fr) 30px 30px auto;align-items:center;gap:5px;min-width:0}.adopp-native-search{min-width:0;width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid var(--palette-neutral-30,#c8c6c4);background:transparent;color:inherit}
.adopp-native-toolbar select,.adopp-native-toolbar button{min-height:28px;padding:4px 7px;border:1px solid var(--palette-neutral-30,#c8c6c4);border-radius:2px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.adopp-native-toolbar button:hover,.adopp-native-toolbar button[aria-pressed="true"]{background:var(--palette-neutral-10,#f3f2f1)}.adopp-native-next-unreviewed{white-space:nowrap}.adopp-native-next-short{display:none}.adopp-native-filters{grid-template-columns:minmax(92px,1fr) minmax(78px,1fr) auto auto}.adopp-native-filters select{min-width:0;width:100%;overflow:hidden;text-overflow:ellipsis}.adopp-native-filter-wrap{position:relative;min-width:0}.adopp-native-filter-trigger{white-space:nowrap}.adopp-native-filter-menu{z-index:100000;min-width:248px}.adopp-native-filter-menu[data-adopp-filter-portal="true"]{position:fixed!important}.adopp-native-filter-menu[hidden]{display:none!important}.adopp-native-filter-check{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;box-sizing:border-box;border:2px solid var(--palette-neutral-50,#a19f9d);border-radius:50%;flex:none;color:#fff;font-weight:700}.adopp-native-filter-check[data-active="true"]{border-color:var(--status-success-foreground,#107c10);background:var(--status-success-foreground,#107c10)}.adopp-native-visible-count{color:var(--palette-neutral-60,#8a8886);white-space:nowrap}
.adopp-native-hidden{display:none!important}.adopp-action-group{position:relative;display:inline-flex;align-items:center;gap:0;margin-right:8px}.adopp-total-diff{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 9px;margin-right:8px;border:1px solid var(--palette-neutral-30,#c8c6c4);border-radius:2px;background:var(--background-color,#fff);font:600 12px Consolas,"Cascadia Mono",monospace;white-space:nowrap}.adopp-total-plus{color:var(--status-success-foreground,#107c10)}.adopp-total-minus{color:var(--status-error-foreground,#a4262c)}.adopp-total-partial{font:10px "Segoe UI",sans-serif;color:var(--palette-neutral-60,#8a8886)}.adopp-panel-button{margin-right:8px!important}.adopp-start-button{border-top-right-radius:0!important;border-bottom-right-radius:0!important}.adopp-action-menu-button{min-width:30px!important;padding-left:7px!important;padding-right:7px!important;border-left-width:1px!important;border-top-left-radius:0!important;border-bottom-left-radius:0!important}
.adopp-action-menu{position:absolute!important;z-index:100000;top:calc(100% + 3px);right:0;min-width:240px}.adopp-action-menu,.adopp-native-filter-menu{box-sizing:border-box;padding:8px 0;border:1px solid var(--palette-neutral-20,#edebe9);border-radius:4px;background:var(--background-color,#25282f);box-shadow:0 6px 18px rgba(0,0,0,.35);overflow:hidden}.adopp-action-menu .bolt-menu,.adopp-native-filter-menu .bolt-menu,.adopp-action-menu .bolt-list,.adopp-native-filter-menu .bolt-list,.adopp-action-menu .bolt-list-row,.adopp-native-filter-menu .bolt-list-row,.adopp-action-menu .bolt-list-cell,.adopp-native-filter-menu .bolt-list-cell{width:100%;box-sizing:border-box}.adopp-action-menu .bolt-menu-button,.adopp-native-filter-menu .bolt-menu-button{display:grid!important;grid-template-columns:22px minmax(0,1fr);align-items:center;gap:10px;width:100%;height:44px;padding:0 20px!important;border:0!important;border-radius:0!important;justify-content:flex-start!important;text-align:left}.adopp-action-menu .bolt-menu-button{grid-template-columns:minmax(0,1fr)}.adopp-action-menu .bolt-menu-button:hover,.adopp-native-filter-menu .bolt-menu-button:hover,.adopp-action-menu .bolt-menu-button:focus-visible,.adopp-native-filter-menu .bolt-menu-button:focus-visible{background:var(--palette-neutral-10,#343942)!important;outline:0}.adopp-action-menu .bolt-button-text,.adopp-native-filter-menu .bolt-button-text{width:100%;min-width:0;text-align:left;white-space:nowrap}
@media(max-width:440px){.adopp-native-toolbar{padding-left:7px;padding-right:7px}.adopp-native-next-long{display:none}.adopp-native-next-short{display:inline}.adopp-native-visible-count{display:none}.adopp-native-filters{grid-template-columns:minmax(86px,1fr) minmax(72px,1fr) auto}}
`;
