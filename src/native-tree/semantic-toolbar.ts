import { createPortal } from "react-dom";
import type { NativeHost } from "./host";
import type { BoltComponents, NativeSelection } from "./semantic-host";
import { record } from "./protocol";
import type { TreeConfiguration, TreeGroup } from "./protocol";

interface GroupOption {
  id: string;
  text: string;
  description: string;
  view: { mode: "all" | "inline" | "group"; groupId: string | null };
}

export type SemanticAction = (action: "select" | "regenerate", view: GroupOption["view"]) => void;

export class SemanticToolbar {
  readonly element: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly selection: NativeSelection;
  private selectedIndex = -1;
  private dropdown: { collapse(): void } | null = null;
  private scroll: HTMLElement | null = null;
  private readonly resizeObserver: ResizeObserver | null;

  constructor(
    private readonly host: NativeHost,
    private readonly components: BoltComponents,
    private readonly action: SemanticAction
  ) {
    const document = host.element.ownerDocument;
    this.element = document.createElement("div");
    this.element.dataset.adoppSemanticToolbar = "";
    this.style = document.createElement("style");
    this.style.textContent = `
      [data-adopp-semantic-toolbar] { padding: 8px 12px; flex-shrink: 0; min-width: 0; background: var(--background-color); font: 12px "Segoe UI",sans-serif; }
      [data-adopp-semantic-scroll] { background-image: linear-gradient(to bottom, transparent var(--adopp-semantic-background-start), var(--background-color) var(--adopp-semantic-background-start), var(--background-color) var(--adopp-semantic-background-end), transparent var(--adopp-semantic-background-end)); background-origin: border-box; background-repeat: no-repeat; }
      .adopp-semantic-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; color: var(--text-primary-color); }
      .adopp-semantic-heading strong { font-size: 12px; font-weight: 600; }
      .adopp-semantic-regenerate { color: var(--communication-foreground, var(--text-link-color)); background: none; border: 0; padding: 0; font: inherit; cursor: pointer; }
      .adopp-semantic-regenerate:disabled { color: var(--text-disabled-color); cursor: default; }
      .adopp-semantic-spinner { display:inline-block; width:10px; height:10px; margin-right:6px; border:2px solid var(--text-disabled-color); border-top-color:var(--communication-foreground); border-radius:50%; animation:adopp-semantic-spin 1s linear infinite!important; }
      @keyframes adopp-semantic-spin { to { transform:rotate(360deg); } }
      .adopp-semantic-dropdown { width: 100%; height: 24px; min-height: 24px; font-size: 12px; }
      .adopp-semantic-dropdown > button { width: 100%; min-height: 24px; padding: 0 8px; font-size: 12px; }
      .adopp-semantic-options .bolt-table-cell-content { min-width: 0; }
      .adopp-semantic-option { white-space: normal; min-width: 0; }
      .adopp-semantic-option-title { font-size: 12px; line-height: 18px; font-weight: 600; }
      .adopp-semantic-option-description { margin-top: 3px; font-size: 12px; line-height: 17px; color: var(--text-secondary-color); white-space: normal; overflow-wrap: anywhere; }
      .adopp-semantic-description, .adopp-semantic-message { margin: 6px 0 0; line-height: 1.5; color: var(--text-secondary-color); overflow-wrap: anywhere; }
      .adopp-semantic-message[role="alert"] { color: var(--status-error-foreground); }
      .repos-file-explorer-tree[data-adopp-compact-groups] .bolt-tree-cell { overflow: visible; }
      .repos-file-explorer-tree[data-adopp-compact-groups] .bolt-tree-cell > .bolt-table-cell-content { margin-inline-start: -16px; }
    `;
    document.head.append(this.style);
    this.selection = new components.Selection();
    this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(this.updateBackground) : null;
  }

  mount(): void {
    const scroll = this.host.element.parentElement;
    if (!scroll?.parentElement) throw new Error("The native file-tree toolbar mount is unavailable.");
    if (this.element.parentElement !== scroll.parentElement || this.element.nextElementSibling !== scroll) {
      scroll.parentElement.insertBefore(this.element, scroll);
    }
    const container = scroll.parentElement;
    if (this.scroll !== container) {
      this.releaseBackground();
      this.scroll = container;
      container.dataset.adoppSemanticScroll = "";
      container.addEventListener("scroll", this.updateBackground, { passive: true });
      this.resizeObserver?.observe(container);
      this.resizeObserver?.observe(this.element);
    }
    this.updateBackground();
  }

  render(config: TreeConfiguration, counts: ReadonlyMap<string, number>, total: number): unknown {
    const semantic = config.semantic!;
    const hasGroups = semantic.groups.length > 0;
    const emptyLabel = "Copilot groups not yet generated for this PR";
    const react = this.host.react;
    const item = (group: TreeGroup): GroupOption => {
      const visible = counts.get(group.id) ?? 0;
      return { id: group.id, text: `${group.title} (${visible === group.paths.length ? visible : `${visible} of ${group.paths.length}`})`,
        description: group.rationale, view: { mode: "group", groupId: group.id } };
    };
    const items: GroupOption[] = [
      { id: "adopp:all", text: `All files (${total})`, description: "", view: { mode: "all", groupId: null } },
      ...(semantic.groups.length ? [
        { id: "adopp:inline", text: `All files (${total}) with groups inline`, description: "Show Copilot groups within the file tree", view: { mode: "inline" as const, groupId: null } },
        ...semantic.groups.map(item)
      ] : [])
    ];
    const index = Math.max(0, items.findIndex((option) => option.view.mode === semantic.view.mode && option.view.groupId === semantic.view.groupId));
    if (this.selectedIndex !== index) {
      this.selectedIndex = index;
      this.selection.select(index);
    }
    const selected = semantic.groups.find((group) => group.id === semantic.view.groupId);
    const notice = semantic.error || (semantic.view.mode === "group" && selected && !counts.get(selected.id)
      ? "No files in this group match the current filters." : "");
    const dropdown = react.createElement(this.components.Dropdown, {
      ref: this.setDropdown,
      ariaLabel: hasGroups ? "Copilot Groups" : emptyLabel,
      disabled: !hasGroups,
      className: "adopp-semantic-dropdown",
      calloutContentClassName: "adopp-semantic-options",
      items: items.map((option) => ({ ...option, ariaLabel: [option.text, option.description].filter(Boolean).join(". ") })),
      selection: this.selection, showFilterBox: false, showChecksColumn: true, dismissOnSelect: true,
      width: Math.max(240, Math.min(360, (this.host.element.ownerDocument.defaultView?.innerWidth ?? 392) - 32)),
      renderExpandable: (props: Record<string, unknown>) => {
        const { expandableRef, items, selection, renderSelectedItems, ...rest } = props;
        return react.createElement(this.components.Expandable, { ...rest, ref: expandableRef },
          react.createElement("div", { className: "bolt-dropdown-expandable-button-label justify-start flex-grow text-ellipsis", title: hasGroups ? undefined : emptyLabel },
            !hasGroups ? emptyLabel : typeof renderSelectedItems === "function" ? renderSelectedItems(selection, items) : ""));
      },
      renderItem: (_row: unknown, columnIndex: unknown, tableColumn: unknown, option: GroupOption) =>
        react.createElement(this.components.Cell, { key: option.id, columnIndex, tableColumn },
          react.createElement("div", { className: "adopp-semantic-option" },
            react.createElement("div", { className: "adopp-semantic-option-title" }, option.text),
            option.description ? react.createElement("div", { className: "adopp-semantic-option-description" }, option.description) : null)),
      onSelect: (_event: unknown, option: GroupOption) => this.action("select", option.view)
    });
    const content = react.createElement("div", {},
      react.createElement("div", { className: "adopp-semantic-heading", "aria-busy": semantic.busy },
        react.createElement("strong", {}, "Copilot Groups"),
        react.createElement("button", { type: "button", className: "adopp-semantic-regenerate bolt-focus-treatment",
          disabled: semantic.busy, onClick: () => this.action("regenerate", semantic.view),
          title: semantic.groups.length ? "Regenerate semantic groups" : "Generate semantic groups" }, semantic.busy ? "Grouping..." : semantic.groups.length ? "Regenerate" : "Generate")),
      dropdown,
      semantic.view.mode === "group" && selected
        ? react.createElement("p", { className: "adopp-semantic-description" }, selected.rationale) : null,
      semantic.busy ? react.createElement("p", { className: "adopp-semantic-message", role: "status" },
        react.createElement("span", { className: "adopp-semantic-spinner", "aria-hidden": true }), "Generating Copilot groups...") : null,
      notice ? react.createElement("p", { className: "adopp-semantic-message", role: semantic.error ? "alert" : "status" }, notice) : null);
    // The public portal factory only creates the portal descriptor; ADO's renderer owns all host elements.
    const portal: unknown = Reflect.apply(createPortal, undefined, [content, this.element, "adopp-semantic-toolbar"]);
    return portal;
  }

  dispose(): void {
    this.dropdown?.collapse();
    this.releaseBackground();
    this.element.remove();
    this.style.remove();
  }

  private readonly updateBackground = (): void => {
    if (!this.scroll) return;
    // A child background is clipped before the native scrollbar's transparent track.
    const toolbar = this.element.getBoundingClientRect();
    const top = toolbar.top - this.scroll.getBoundingClientRect().top;
    for (const [property, value] of [
      ["--adopp-semantic-background-start", `${top}px`],
      ["--adopp-semantic-background-end", `${top + toolbar.height}px`]
    ] as const) {
      if (this.scroll.style.getPropertyValue(property) !== value) this.scroll.style.setProperty(property, value);
    }
  };

  private releaseBackground(): void {
    this.resizeObserver?.disconnect();
    if (!this.scroll) return;
    this.scroll.removeEventListener("scroll", this.updateBackground);
    delete this.scroll.dataset.adoppSemanticScroll;
    this.scroll.style.removeProperty("--adopp-semantic-background-start");
    this.scroll.style.removeProperty("--adopp-semantic-background-end");
    this.scroll = null;
  }

  private readonly setDropdown = (value: unknown): void => {
    const collapse = record(value) ? value.collapse : null;
    this.dropdown = typeof collapse === "function" ? { collapse: () => collapse.call(value) } : null;
  };
}
