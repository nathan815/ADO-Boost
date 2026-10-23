// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuItemType } from "azure-devops-ui/Components/Menu/Menu.Props";
import { SemanticTreeAdapter } from "../src/native-tree/semantic-adapter";
import type { NativeExplorer, NativeNavigation, NativeProvider } from "../src/native-tree/semantic-host";
import type { HostReact, NativeElement, NativeHost } from "../src/native-tree/host";
import { CHANNEL, configurationSchema, record } from "../src/native-tree/protocol";
import type { TreeConfiguration } from "../src/native-tree/protocol";
import { nativeFiles, projectNodes, scopeCollection } from "../src/native-tree/semantic-projection";
import type { NativeData, NativeNode, SemanticCollection } from "../src/native-tree/semantic-projection";

const react: HostReact = {
  createElement: (type, props, ...children) => ({ type, props: {
    ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {})
  } }),
  cloneElement: (element, props, ...children) => ({
    ...element, props: { ...element.props, ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) }
  }),
  isValidElement: (value: unknown): value is NativeElement => record(value) && "type" in value && record(value.props)
};

function node(path: string, children?: NativeNode[]): NativeNode {
  return { expanded: true, data: { path, name: path.split("/").at(-1) || "repo", isFolder: Boolean(children) },
    ...(children ? { childItems: children } : {}) };
}

function collection(): SemanticCollection {
  const rootTreeItem = node("/", [node("/src", [node("/src/a.ts"), node("/src/b.ts")])]);
  const changesByPath = Object.fromEntries(nativeFiles([rootTreeItem]).map((file) => [file.data.path, file.data]));
  return { key: "native", rootTreeItem, changesByPath,
    treeItemsByPath: { "/": rootTreeItem, "/src": rootTreeItem.childItems![0]! },
    sourceVersion: { version: "source" }, targetVersion: { version: "base" }, totalChanges: 2 };
}

function config(): TreeConfiguration {
  return {
    channel: CHANNEL, kind: "configure", session: "16748ae6-f0a9-4dad-ac76-88e2bafc32c1",
    page: "https://dev.azure.com/org/project/_git/repo/pullrequest/7",
    comparison: { iteration: 3, source: "source", base: "base" },
    files: ["/src/a.ts", "/src/b.ts"].map((path, index) => ({
      path, trackingId: index, changeType: "edit", additions: 1, deletions: 0, state: "exact", generated: false, lockfile: false
    })),
    countsEnabled: false, filters: { extension: "all", changeKind: "all", hideGenerated: false, hideLockfiles: false },
    semantic: {
      revision: 1, busy: false, error: "", view: { mode: "inline", groupId: null },
      groups: [
        { id: "one", title: "First", rationale: "First explanation", paths: ["/src/a.ts"] },
        { id: "two", title: "Second", rationale: "Second explanation", paths: ["/src/b.ts"] }
      ]
    }
  };
}

let adapter: SemanticTreeAdapter | undefined;
afterEach(() => { adapter?.dispose(); adapter = undefined; document.body.replaceChildren(); });

function fixture(configuration = config(), changes = collection()) {
  document.body.innerHTML = '<div><div><table class="repos-file-explorer-tree"><td class="bolt-table-cell"></td></table></div></div><div class="repository-selector"></div><button class="native-menu-button" aria-haspopup="true"></button>';
  const element = document.querySelector("table")!;
  const sourceRoots = changes.rootTreeItem.childItems!;
  const flatten = (nodes: NativeNode[]): { underlyingItem: NativeNode }[] =>
    nodes.flatMap((item) => [{ underlyingItem: item }, ...flatten(item.childItems ?? [])]);
  const provider: NativeProvider = {
    roots: sourceRoots, value: flatten(sourceRoots),
    splice: vi.fn((_parent: undefined, removed: NativeNode[], additions: { items: NativeNode[] }[]) => {
      expect(removed).toEqual(provider.roots);
      const old = new Set(flatten(removed).map((row) => row.underlyingItem));
      const items = additions.flatMap((addition) => addition.items);
      expect(flatten(items).some((row) => old.has(row.underlyingItem))).toBe(false);
      provider.roots = items;
      provider.value = flatten(items);
    }),
    expand: vi.fn(), toggle: vi.fn()
  };
  const listeners = new Set<(data: NativeData) => void>();
  let selected = changes.rootTreeItem.data;
  const navigation: NativeNavigation = {
    selectedItem: {
      get value() { return selected; },
      set value(data) { selected = data; for (const listener of listeners) listener(data); },
      subscribe: (listener) => { listeners.add(listener); },
      unsubscribe: (listener) => { listeners.delete(listener); }
    },
    setSelectedItem(data) { this.selectedItem.value = data; },
    findNextFile: vi.fn(() => changes.changesByPath["/src/b.ts"]),
    findPreviousFile: vi.fn(() => changes.changesByPath["/src/a.ts"]),
    onSelectedItemChanged: vi.fn()
  };
  const widget = { findFileItem: (path: string) => nativeFiles(sourceRoots).find((file) => file.data.path === path) };
  const columns = [
    { id: "name", renderCell: (_a: unknown, _b: unknown, _c: unknown, row: { underlyingItem: NativeNode }) =>
      react.createElement("cell", {}, react.createElement("Tooltip", { text: row.underlyingItem.data.path },
        react.createElement("span", {}, row.underlyingItem.data.name)),
      react.createElement("menu", { menuPropsProvider: vi.fn() })) },
    { id: "checkbox", renderCell: () => react.createElement("Observer", { children: () => react.createElement("td", {}, "checkbox") }) }
  ];
  const selectNative = vi.fn();
  const explorer: NativeExplorer = {
    props: { changes }, itemProvider: provider, selection: { select: vi.fn() }, treeRef: { current: { scrollIntoView: vi.fn() } },
    treeDiffIntegration: { widget },
    render: () => react.createElement("Observer", { children: () =>
      react.createElement("div", {}, react.createElement("Tree", { itemProvider: provider, columns })) }),
    onActivate: vi.fn((_event, item: unknown) => {
      if (record(item) && record(item.data) && record(item.data.underlyingItem)) {
        const data = item.data.underlyingItem.data;
        if (record(data)) navigation.setSelectedItem(data as NativeData);
      }
    }),
    setSelectedItemAndThread: selectNative, forceUpdate: vi.fn()
  };
  const splitter = {
    props: { onRenderFarElement: vi.fn(), onRenderNearElement: vi.fn() },
    render: () => react.createElement("Observer", { children: () => react.createElement("div", { className: "vss-Splitter--pane-flexible" },
      react.createElement("Viewer", { changes })) }),
    forceUpdate: vi.fn()
  };
  const view = {
    changes: { value: changes, subscribe: vi.fn(), unsubscribe: vi.fn() },
    selectedIterationId: { value: 3 }, baseIterationId: { value: 0 }, changesCurrentKey: "",
    iterationChangesCache: {}, getFilesFilter: () => ({ hasChangesToReset: () => false }), processChanges: vi.fn(), updateChanges: vi.fn()
  };
  const host: NativeHost = { element, react, view, tree: { props: { columns }, render: vi.fn(), forceUpdate: vi.fn() } };
  Reflect.set(element, "__reactFiber$test", { stateNode: explorer, memoizedProps: {}, return: {
    stateNode: splitter, memoizedProps: {}, return: { memoizedProps: { value: { navigationService: navigation } }, return: null }
  } });
  class Selection { select = vi.fn(); }
  Selection.prototype.select = vi.fn();
  Reflect.set(document.querySelector(".repository-selector")!, "__reactFiber$test", {
    stateNode: { parentSelection: new Selection(), renderCallout: vi.fn() }, type: "Dropdown", memoizedProps: {},
    return: { stateNode: { buttonElement: {}, renderCallout: vi.fn() }, type: "Expandable", memoizedProps: {}, return: null }
  });
  Reflect.set(document.querySelector("td")!, "__reactFiber$test", {
    stateNode: null, memoizedProps: { tableColumn: {}, columnIndex: 0 }, type: function Cell() { return "bolt-table-cell-content"; }, return: null
  });
  Reflect.set(document.querySelector(".native-menu-button")!, "__reactFiber$test", {
    stateNode: { props: { contextualMenuProps: {} }, renderMenu: vi.fn(), expand: vi.fn(), collapse: vi.fn() },
    type: "MenuButton", memoizedProps: {}, return: null
  });
  const action = vi.fn();
  const failed = vi.fn();
  const invalidate = vi.fn();
  adapter = new SemanticTreeAdapter(host, configuration, invalidate, action, failed);
  adapter.start();
  const renderSummary = () => {
    const deferred = splitter.render();
    if (!react.isValidElement(deferred) || typeof deferred.props.children !== "function") throw new Error("Missing native summary callback");
    const pane: unknown = deferred.props.children();
    if (!react.isValidElement(pane)) throw new Error("Missing native summary pane");
    const viewer: unknown = Array.isArray(pane.props.children) ? pane.props.children[0] : pane.props.children;
    if (!react.isValidElement(viewer)) throw new Error("Missing native viewer");
    return viewer.props.changes;
  };
  const activate = (groupIndex: number) => {
    const folder = provider.roots[groupIndex]!.childItems![0]!;
    explorer.onActivate(null, { data: { underlyingItem: folder } });
  };
  return { host, provider, changes, explorer, navigation, widget, configuration, action, failed, invalidate, renderSummary, activate, listeners, selectNative };
}

describe("semantic native projection", () => {
  it("keeps original ancestry, file identities, and independent mutable discussion wrappers", () => {
    const c = collection();
    const file = nativeFiles(c.rootTreeItem.childItems!)[0]!;
    const thread = { ...file.data, thread: { id: 42 } };
    file.childItems = [{ data: thread }];
    const roots = projectNodes(c.rootTreeItem.childItems!, new Set(["/src/a.ts"]));
    expect(roots[0]?.data).toBe(c.rootTreeItem.childItems![0]?.data);
    const projected = nativeFiles(roots)[0]!;
    expect(projected).not.toBe(file);
    expect(projected.data).toBe(file.data);
    expect(projected.childItems?.[0]).not.toBe(file.childItems[0]);
    expect(projected.childItems?.[0]?.data).toBe(thread);
    expect(nativeFiles(c.rootTreeItem.childItems!)).toHaveLength(2);
  });

  it("scopes folder summaries without changing the authoritative comparison or its maps", () => {
    const c = collection();
    const scoped = scopeCollection(c, new Set(["/src/b.ts"]), "two");
    expect(scoped.totalChanges).toBe(1);
    expect(Object.keys(scoped.changesByPath)).toEqual(["/src/b.ts"]);
    expect(scoped.changesByPath["/src/b.ts"]).toBe(c.changesByPath["/src/b.ts"]);
    expect(scoped.treeItemsByPath["/src"]?.childItems?.map((file) => file.data.path)).toEqual(["/src/b.ts"]);
    expect(c.totalChanges).toBe(2);
    expect(nativeFiles(c.rootTreeItem.childItems!)).toHaveLength(2);
    expect(scopeCollection(c, new Set(), "empty").rootTreeItem.childItems).toEqual([]);
  });

  it("rejects cyclic native hierarchies", () => {
    const root = node("/", []);
    root.childItems!.push(root);
    expect(() => projectNodes([root], new Set())).toThrow("incompatible");
  });
});

describe("semantic native adapter", () => {
  it("links native grouping errors to companion setup without starting generation", () => {
    const configuration = config();
    configuration.semantic!.error = "Companion missing";
    const f = fixture(configuration);
    const deferred = f.explorer.render();
    if (!react.isValidElement(deferred) || typeof deferred.props.children !== "function") throw new Error("Missing native tree callback");
    const container: unknown = deferred.props.children();
    if (!react.isValidElement(container) || !Array.isArray(container.props.children)) throw new Error("Missing tree container");
    const portal: unknown = container.props.children[1];
    if (!record(portal) || !react.isValidElement(portal.children) || !Array.isArray(portal.children.props.children)) throw new Error("Missing toolbar");
    const setup: unknown = portal.children.props.children.at(-1);
    if (!react.isValidElement(setup) || typeof setup.props.onClick !== "function") throw new Error("Missing setup action");
    expect(setup.props.children).toBe("Install or troubleshoot companion");
    setup.props.onClick();
    expect(f.action).toHaveBeenLastCalledWith("setup-companion", configuration.semantic!.view);
  });

  it.each([
    [false, false, "Generate"],
    [true, false, null],
    [true, true, null],
    [false, true, "Grouping..."]
  ])("shows the generation action for existing groups=%s, busy=%s", (generated, busy, label) => {
    const configuration = config();
    configuration.semantic!.busy = busy;
    if (!generated) configuration.semantic!.groups = [];
    const f = fixture(configuration);
    const deferred = f.explorer.render();
    if (!react.isValidElement(deferred) || typeof deferred.props.children !== "function") throw new Error("Missing native tree callback");
    const container: unknown = deferred.props.children();
    if (!react.isValidElement(container) || !Array.isArray(container.props.children)) throw new Error("Missing tree container");
    const portal: unknown = container.props.children[1];
    if (!record(portal) || !react.isValidElement(portal.children) || !Array.isArray(portal.children.props.children)) throw new Error("Missing toolbar");
    const heading: unknown = portal.children.props.children[0];
    if (!react.isValidElement(heading) || !Array.isArray(heading.props.children)) throw new Error("Missing heading");
    const actions: unknown = heading.props.children[1];
    if (!react.isValidElement(actions) || !Array.isArray(actions.props.children)) throw new Error("Missing header actions");
    const sidebar: unknown = heading.props.children[0];
    const settings: unknown = actions.props.children[2];
    if (!react.isValidElement(sidebar) || !react.isValidElement(settings)) throw new Error("Missing sidebar and settings controls");
    expect(sidebar.type).toBe("button");
    expect(sidebar.props.children).toBe("Copilot Groups");
    expect(sidebar.props.title).toBe("View details in sidebar");
    expect(sidebar.props.className).toContain("adopp-semantic-title");
    (sidebar.props.onClick as () => void)();
    expect(f.action).toHaveBeenLastCalledWith("view-session", configuration.semantic!.view);
    expect(settings.type).toBe("MenuButton");
    expect(settings.props.disabled).not.toBe(true);
    expect(settings.props.ariaLabel).toBe("Copilot Groups settings");
    expect(settings.props.iconProps).toEqual({ iconName: "Settings" });
    expect(settings.props.hideDropdownIcon).toBe(true);
    const options = settings.props.contextualMenuProps;
    if (!record(options) || !record(options.menuProps) || typeof options.onActivate !== "function") throw new Error("Missing settings popover");
    expect(options.menuProps.items).toEqual([
      { id: "adopp-semantic-session", text: "View details in sidebar", className: "adopp-semantic-menu-action" },
      ...(generated ? [{ id: "adopp-semantic-regenerate", text: "Regenerate", className: "adopp-semantic-menu-action", disabled: busy }] : []),
      { id: "adopp-semantic-settings-divider", itemType: MenuItemType.Divider },
      { id: "adopp-semantic-settings-heading", text: "Settings", itemType: MenuItemType.Header },
      { id: "adopp-semantic-auto-generate", text: "Auto generate on each PR", checked: false, readonly: true },
      { id: "adopp-semantic-confirmation", text: "Show confirmation dialog", checked: true, readonly: true }
    ]);
    const collapse = vi.fn();
    if (typeof settings.props.ref !== "function") throw new Error("Missing menu reference");
    settings.props.ref({ collapse });
    options.onActivate({ id: "adopp-semantic-auto-generate" });
    expect(collapse).toHaveBeenCalledOnce();
    expect(f.action).toHaveBeenLastCalledWith("toggle-auto-generate", configuration.semantic!.view);
    options.onActivate({ id: "adopp-semantic-session" });
    expect(f.action).toHaveBeenLastCalledWith("view-session", configuration.semantic!.view);
    expect(collapse).toHaveBeenCalledTimes(2);
    options.onActivate({ id: "adopp-semantic-confirmation" });
    expect(f.action).toHaveBeenLastCalledWith("toggle-confirmation", configuration.semantic!.view);
    f.action.mockClear();
    options.onActivate({ id: "adopp-semantic-regenerate" });
    if (generated && !busy) expect(f.action).toHaveBeenCalledExactlyOnceWith("regenerate", configuration.semantic!.view);
    else expect(f.action).not.toHaveBeenCalled();
    expect(actions.props.children[0]).toBeNull();
    const generation: unknown = actions.props.children[1];
    if (generated) {
      expect(generation).toBeNull();
    } else {
      if (!react.isValidElement(generation)) throw new Error("Missing generate button");
      expect(generation.props.children).toBe(label);
      expect(generation.props.disabled).toBe(busy);
      if (!busy) {
        (generation.props.onClick as () => void)();
        expect(f.action).toHaveBeenLastCalledWith("regenerate", configuration.semantic!.view);
      }
    }
    expect(heading.props["aria-busy"]).toBe(busy);
    const dropdown: unknown = portal.children.props.children[1];
    if (!react.isValidElement(dropdown)) throw new Error("Missing group dropdown");
    expect(dropdown.props.disabled).toBe(!generated);
    expect(dropdown.props.ariaLabel).toBe(generated ? "Copilot Groups" : "Groups not yet generated for this PR");
    const renderExpandable = dropdown.props.renderExpandable;
    if (typeof renderExpandable !== "function") throw new Error("Missing dropdown renderer");
    const expandable: unknown = renderExpandable({ disabled: dropdown.props.disabled, renderSelectedItems: () => "All files (2)" });
    if (!react.isValidElement(expandable) || !react.isValidElement(expandable.props.children)) throw new Error("Missing dropdown label");
    expect(expandable.props.disabled).toBe(!generated);
    expect(expandable.props.children.props.children).toBe(generated ? "All files (2)" : "Groups not yet generated for this PR");
  });
  it("checks the automatic-generation menu item when enabled", () => {
    const configuration = config();
    configuration.semantic!.autoGenerate = true;
    configuration.semantic!.showConfirmation = false;
    const f = fixture(configuration);
    const deferred = f.explorer.render();
    if (!react.isValidElement(deferred) || typeof deferred.props.children !== "function") throw new Error("Missing native tree callback");
    const container: unknown = deferred.props.children();
    if (!react.isValidElement(container) || !Array.isArray(container.props.children)) throw new Error("Missing native tree container");
    const portal: unknown = container.props.children[1];
    if (!record(portal) || !react.isValidElement(portal.children) || !Array.isArray(portal.children.props.children)) throw new Error("Missing toolbar");
    const heading: unknown = portal.children.props.children[0];
    if (!react.isValidElement(heading) || !Array.isArray(heading.props.children)) throw new Error("Missing heading");
    const actions: unknown = heading.props.children[1];
    if (!react.isValidElement(actions) || !Array.isArray(actions.props.children)) throw new Error("Missing header actions");
    const button: unknown = actions.props.children[2];
    if (!react.isValidElement(button)) throw new Error("Missing settings menu");
    const options = button.props.contextualMenuProps;
    if (!record(options) || !record(options.menuProps)) throw new Error("Missing menu items");
    expect(options.menuProps.items).toContainEqual(expect.objectContaining({ id: "adopp-semantic-auto-generate", checked: true }));
    expect(options.menuProps.items).toContainEqual(expect.objectContaining({ id: "adopp-semantic-confirmation", checked: false }));
  });
  it.each([false, true])("keeps stale groups selectable and exposes direct regeneration with busy=%s", (busy) => {
    const configuration = config();
    configuration.semantic = { ...configuration.semantic!, stale: true, busy };
    const f = fixture(configuration);
    const deferred = f.explorer.render();
    if (!react.isValidElement(deferred) || typeof deferred.props.children !== "function") throw new Error("Missing native tree callback");
    const container: unknown = deferred.props.children();
    if (!react.isValidElement(container) || !Array.isArray(container.props.children)) throw new Error("Missing native tree container");
    const portal: unknown = container.props.children[1];
    if (!record(portal) || !react.isValidElement(portal.children) || !Array.isArray(portal.children.props.children)) throw new Error("Missing toolbar");
    const dropdown: unknown = portal.children.props.children[1];
    const heading: unknown = portal.children.props.children[0];
    if (!react.isValidElement(dropdown) || !react.isValidElement(heading) || !Array.isArray(heading.props.children)) throw new Error("Missing heading");
    const actions: unknown = heading.props.children[1];
    if (!react.isValidElement(actions) || !Array.isArray(actions.props.children)) throw new Error("Missing stale controls");
    expect(dropdown.props.disabled).toBe(false);
    const label: unknown = actions.props.children[0];
    const regenerate: unknown = actions.props.children[1];
    if (!react.isValidElement(label) || !react.isValidElement(regenerate)) throw new Error("Missing regenerate action");
    expect(label.props.children).toBe("Stale");
    expect(label.props.className).toBe("adopp-semantic-stale");
    expect(label.props.role).toBe("status");
    expect(regenerate.props.disabled).toBe(busy);
    expect(regenerate.props.children).toBe(busy ? "Grouping..." : "Regenerate");
    if (!busy) {
      (regenerate.props.onClick as () => void)();
      expect(f.action).toHaveBeenCalledWith("regenerate", configuration.semantic.view);
    }
    expect(nativeFiles(f.provider.roots).map((file) => file.data.path)).toEqual(["/src/a.ts", "/src/b.ts"]);
  });

  it("keeps the header compact despite native icon-button padding", () => {
    const nativeStyle = document.createElement("style");
    nativeStyle.textContent = ".bolt-button.bolt-icon-button { padding: 8px; }";
    document.head.append(nativeStyle);
    try {
      fixture();
      const toolbar = document.querySelector<HTMLElement>("[data-adopp-semantic-toolbar]")!;
      toolbar.innerHTML = '<div class="adopp-semantic-heading"><button class="bolt-button bolt-icon-button adopp-semantic-settings-button"></button></div>';
      const button = getComputedStyle(toolbar.querySelector("button")!);
      expect(button.height).toBe("20px");
      expect(button.minHeight).toBe("20px");
      expect(button.padding).toBe("0px");
      expect(getComputedStyle(toolbar).paddingTop).toBe("4px");
      expect(getComputedStyle(toolbar.firstElementChild!).marginBottom).toBe("6px");
    } finally {
      nativeStyle.remove();
    }
  });

  it("lets the action label extend into the unused checkmark gutter without clipping toggle rows", () => {
    fixture();
    const menu = document.createElement("table");
    menu.className = "adopp-semantic-settings";
    menu.innerHTML = '<tbody><tr class="adopp-semantic-menu-action"><td class="bolt-menuitem-cell"><div class="bolt-menuitem-cell-text">View details in sidebar</div></td></tr><tr class="adopp-semantic-menu-action"><td class="bolt-menuitem-cell"><div class="bolt-menuitem-cell-text">Regenerate</div></td></tr><tr role="menuitemcheckbox"><td class="bolt-menuitem-cell"><div class="bolt-menuitem-cell-text">Show confirmation dialog</div></td></tr></tbody>';
    document.body.append(menu);
    for (const action of menu.querySelectorAll<HTMLElement>(".adopp-semantic-menu-action .bolt-menuitem-cell-text")) {
      expect(getComputedStyle(action).marginInlineStart).toBe("-26px");
      expect(getComputedStyle(action.parentElement!).overflow).toBe("visible");
    }
    const toggle = menu.querySelector<HTMLElement>('[role="menuitemcheckbox"] .bolt-menuitem-cell-text')!;
    expect(getComputedStyle(toggle).marginInlineStart).not.toBe("-26px");
  });

  it("keeps the toolbar sticky and extends its background under the scrollbar through resizing, scrolling, and disposal", () => {
    let resize: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    try {
      fixture();
      const toolbar = document.querySelector<HTMLElement>("[data-adopp-semantic-toolbar]")!;
      const style = getComputedStyle(toolbar);
      expect(style.position).toBe("sticky");
      expect(style.top).toBe("0px");
      expect(style.zIndex).toBe("1");
      const scroll = toolbar.parentElement!;
      scroll.style.color = "red";
      vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 320, 400));
      const bounds = vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 148, 302, 60));
      resize!();
      expect(scroll.hasAttribute("data-adopp-semantic-scroll")).toBe(true);
      expect(scroll.style.getPropertyValue("--adopp-semantic-background-start")).toBe("48px");
      expect(scroll.style.getPropertyValue("--adopp-semantic-background-end")).toBe("108px");
      bounds.mockReturnValue(new DOMRect(0, 148, 302, 100));
      resize!();
      expect(scroll.style.getPropertyValue("--adopp-semantic-background-end")).toBe("148px");
      bounds.mockReturnValue(new DOMRect(0, 118, 302, 100));
      scroll.dispatchEvent(new Event("scroll"));
      expect(scroll.style.getPropertyValue("--adopp-semantic-background-start")).toBe("18px");
      expect(scroll.style.getPropertyValue("--adopp-semantic-background-end")).toBe("118px");
      adapter!.dispose();
      adapter = undefined;
      expect(disconnect).toHaveBeenCalled();
      expect(scroll.hasAttribute("data-adopp-semantic-scroll")).toBe(false);
      expect(scroll.style.getPropertyValue("--adopp-semantic-background-start")).toBe("");
      expect(scroll.style.getPropertyValue("--adopp-semantic-background-end")).toBe("");
      scroll.dispatchEvent(new Event("scroll"));
      expect(scroll.style.getPropertyValue("--adopp-semantic-background-start")).toBe("");
      expect(scroll.style.color).toBe("red");
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("labels the inline view with the total file count and a Copilot-specific menu description", () => {
    const f = fixture();
    const deferred = f.explorer.render();
    if (!react.isValidElement(deferred) || typeof deferred.props.children !== "function") throw new Error("Missing native tree callback");
    const container: unknown = deferred.props.children();
    if (!react.isValidElement(container) || !Array.isArray(container.props.children)) throw new Error("Missing native tree container");
    const portal: unknown = container.props.children[1];
    if (!record(portal) || !react.isValidElement(portal.children) || !Array.isArray(portal.children.props.children)) {
      throw new Error("Missing semantic toolbar portal");
    }
    const content = portal.children.props.children;
    const dropdown: unknown = content[1];
    if (!react.isValidElement(dropdown)) throw new Error("Missing native group dropdown");
    expect(dropdown.props.items).toMatchObject([
      { text: "All files (2)", description: "" },
      { text: "All files (2) with groups inline", description: "Show Copilot groups within the file tree",
        ariaLabel: "All files (2) with groups inline. Show Copilot groups within the file tree" },
      { text: "First (1)" }, { text: "Second (1)" }
    ]);
    expect(content[2]).toBeNull();
  });

  it("scopes the same native folder differently under each inline root without hiding the other group", () => {
    const f = fixture();
    const original = f.changes.rootTreeItem.childItems;
    expect(f.provider.roots).toHaveLength(2);
    f.activate(0);
    expect(f.renderSummary()).toMatchObject({ totalChanges: 1, changesByPath: { "/src/a.ts": f.changes.changesByPath["/src/a.ts"] } });
    f.activate(1);
    const summary = f.renderSummary();
    expect(summary).toMatchObject({ totalChanges: 1, changesByPath: { "/src/b.ts": f.changes.changesByPath["/src/b.ts"] } });
    expect(f.explorer.selection.select).toHaveBeenLastCalledWith(4);
    expect(f.provider.roots).toHaveLength(2);
    expect(f.changes.rootTreeItem.childItems).toBe(original);
    expect(f.host.view.changes.value.totalChanges).toBe(2);
    expect(f.failed).not.toHaveBeenCalled();
    f.navigation.setSelectedItem(f.changes.rootTreeItem.data);
    expect(f.renderSummary()).toBe(f.changes);
  });

  it("filters individual groups including same-sized switches and returns to all files", () => {
    const f = fixture();
    const choose = (id: string) => adapter!.update({ ...f.configuration, semantic: {
      ...f.configuration.semantic!, view: { mode: "group", groupId: id }
    } });
    choose("one");
    expect(nativeFiles(f.provider.roots).map((file) => file.data.path)).toEqual(["/src/a.ts"]);
    expect(f.renderSummary()).toMatchObject({ totalChanges: 1 });
    f.navigation.setSelectedItem(f.changes.changesByPath["/src/a.ts"]!);
    expect(f.navigation.findNextFile()).toBeUndefined();
    choose("two");
    expect(nativeFiles(f.provider.roots).map((file) => file.data.path)).toEqual(["/src/b.ts"]);
    expect(f.navigation.selectedItem.value.isFolder).toBe(true);
    expect(adapter!.fileCount).toBe(1);
    adapter!.update({ ...f.configuration, semantic: { ...f.configuration.semantic!, view: { mode: "all", groupId: null } } });
    expect(nativeFiles(f.provider.roots)).toHaveLength(2);
    expect(f.renderSummary()).toBe(f.changes);
    expect(f.host.element.hasAttribute("data-adopp-compact-groups")).toBe(false);
  });

  it("uses native ordering across inline groups and reveals external selection without losing group context", () => {
    const f = fixture();
    f.navigation.setSelectedItem(f.changes.changesByPath["/src/a.ts"]!);
    expect(f.navigation.findNextFile()).toBe(f.changes.changesByPath["/src/b.ts"]);
    f.navigation.setSelectedItem(f.changes.changesByPath["/src/b.ts"]!);
    expect(f.renderSummary()).toMatchObject({ totalChanges: 1, changesByPath: { "/src/b.ts": f.changes.changesByPath["/src/b.ts"] } });
    expect(f.provider.expand).toHaveBeenCalled();
  });

  it("keeps native discussion lookup on active wrappers and carries updates through switching and cleanup", () => {
    const f = fixture();
    const file = f.widget.findFileItem("/src/a.ts")!;
    expect(file).toBe(nativeFiles(f.provider.roots)[0]);
    expect(file).not.toBe(nativeFiles(f.changes.rootTreeItem.childItems!)[0]);
    file.childItems = [{ data: { ...file.data, thread: { id: 99 } } }];
    adapter!.update({ ...f.configuration, semantic: { ...f.configuration.semantic!, view: { mode: "all", groupId: null } } });
    expect(f.widget.findFileItem("/src/a.ts")?.childItems?.[0]?.data.thread).toEqual({ id: 99 });
    adapter!.dispose();
    expect(f.listeners.size).toBe(0);
    expect(document.querySelector("[data-adopp-semantic-toolbar]")).toBeNull();
    expect(Object.hasOwn(f.navigation, "findNextFile")).toBe(true);
    expect(f.provider.roots[0]).toBe(f.changes.rootTreeItem.childItems![0]);
  });

  it("restores the native hierarchy even when a selected group has no visible files", () => {
    const c = collection();
    c.rootTreeItem.childItems![0]!.childItems!.pop();
    delete c.changesByPath["/src/b.ts"];
    c.totalChanges = 1;
    const configuration = config();
    configuration.semantic!.view = { mode: "group", groupId: "two" };
    const f = fixture(configuration, c);
    expect(f.provider.roots).toEqual([]);
    expect(f.renderSummary()).toMatchObject({ totalChanges: 0 });
    adapter!.dispose();
    expect(nativeFiles(f.provider.roots).map((file) => file.data.path)).toEqual(["/src/a.ts"]);
  });

  it("does not allow fake group paths to activate native navigation", () => {
    const f = fixture();
    f.explorer.onActivate(null, { data: { underlyingItem: f.provider.roots[0] } });
    expect(f.provider.toggle).toHaveBeenCalledWith(f.provider.roots[0]);
    expect(f.navigation.selectedItem.value).toBe(f.changes.rootTreeItem.data);
  });

  it("resets result-scoped expansion on regeneration but preserves it across ordinary view changes", () => {
    const f = fixture();
    f.provider.roots[0]!.expanded = false;
    adapter!.update({ ...f.configuration, semantic: { ...f.configuration.semantic!, view: { mode: "all", groupId: null } } });
    adapter!.update(f.configuration);
    expect(f.provider.roots[0]!.expanded).toBe(false);
    adapter!.update({ ...f.configuration, semantic: { ...f.configuration.semantic!, revision: 2 } });
    expect(f.provider.roots[0]!.expanded).toBe(true);
  });

  it("preserves selected-thread context while revealing its native projected file", () => {
    const f = fixture();
    f.explorer.props.selectedThreadId = { value: 42 };
    f.navigation.setSelectedItem(f.changes.changesByPath["/src/a.ts"]!);
    expect(f.selectNative).toHaveBeenLastCalledWith(f.changes.changesByPath["/src/a.ts"], 42);
    expect(f.failed).not.toHaveBeenCalled();
  });

  it("restores ordinary browsing instead of silently dropping partially loaded or unknown native files", () => {
    const c = collection();
    c.loadMoreChanges = vi.fn();
    expect(() => fixture(config(), c)).toThrow("not fully loaded or analyzed");
    expect(document.querySelector("[data-adopp-semantic-toolbar]")).toBeNull();
    expect(nativeFiles(c.rootTreeItem.childItems!)).toHaveLength(2);
  });

  it("keeps rich group tooltips compact and uses the tooltip foreground instead of page secondary-text colors", () => {
    const f = fixture();
    const deferred = f.explorer.render();
    if (!react.isValidElement(deferred) || typeof deferred.props.children !== "function") throw new Error("Missing native tree callback");
    const container: unknown = deferred.props.children();
    if (!react.isValidElement(container) || !Array.isArray(container.props.children)) throw new Error("Missing native tree container");
    const tree: unknown = container.props.children[0];
    if (!react.isValidElement(tree) || !Array.isArray(tree.props.columns)) throw new Error("Missing native columns");
    const column = tree.props.columns[0];
    if (!record(column) || typeof column.renderCell !== "function") throw new Error("Missing native name renderer");
    const cell: unknown = column.renderCell(0, 0, column, { underlyingItem: f.provider.roots[0] });
    if (!react.isValidElement(cell) || !Array.isArray(cell.props.children)) throw new Error("Missing native name cell");
    expect(cell.props.className).toBe("adopp-semantic-root-cell");
    const tooltip: unknown = cell.props.children[0];
    if (!react.isValidElement(tooltip) || typeof tooltip.props.renderContent !== "function") throw new Error("Missing rich tooltip");
    const content: unknown = tooltip.props.renderContent();
    if (!react.isValidElement(content) || !Array.isArray(content.props.children)) throw new Error("Missing tooltip content");
    expect(content.props.style).toMatchObject({ fontSize: 12, lineHeight: 1.5, color: "inherit", maxWidth: 300 });
    expect(content.props.children).toMatchObject([
      { props: { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 }, children: "First" } },
      { props: { style: { fontSize: 12, opacity: 0.9 }, children: "First explanation" } },
      { props: { style: { fontSize: 11, opacity: 0.7, marginTop: 8 }, children: "1 changed file. Semantic group" } }
    ]);
    expect(JSON.stringify(content)).not.toContain("secondary-text");
    expect(cell.props.children[1]).toBeNull();
    const checkbox = tree.props.columns[1];
    if (!record(checkbox) || typeof checkbox.renderCell !== "function") throw new Error("Missing checkbox renderer");
    expect(JSON.stringify(checkbox.renderCell(0, 1, checkbox, { underlyingItem: f.provider.roots[0] }))).not.toContain("checkbox");
    const folder = f.provider.roots[0]!.childItems![0]!;
    const file = nativeFiles([folder])[0]!;
    for (const node of [folder, file]) {
      const name: unknown = column.renderCell(0, 0, column, { underlyingItem: node });
      if (!react.isValidElement(name)) throw new Error("Missing native name cell");
      expect(name.props.className ?? "").not.toContain("adopp-semantic-root-cell");
      const reviewed: unknown = checkbox.renderCell(0, 1, checkbox, { underlyingItem: node });
      if (!react.isValidElement(reviewed) || typeof reviewed.props.children !== "function") throw new Error("Missing native checkbox observer");
      const body: unknown = reviewed.props.children({ checked: false });
      if (!react.isValidElement(body)) throw new Error("Missing native checkbox");
      expect(body.props.children).toBe("checkbox");
    }
    expect(f.failed).not.toHaveBeenCalled();
  });

  it("clips compact file and folder name cells away from reviewed checkboxes but leaves synthetic expanders visible", () => {
    const f = fixture();
    f.host.element.innerHTML = '<tbody><tr><td class="bolt-tree-cell adopp-semantic-root-cell"><div class="bolt-table-cell-content">Group</div></td></tr><tr><td><button role="checkbox"></button></td><td class="bolt-tree-cell"><div class="bolt-table-cell-content">Folder</div></td></tr><tr><td><button role="checkbox"></button></td><td class="bolt-tree-cell"><div class="bolt-table-cell-content">File</div></td></tr></tbody>';
    const cells = f.host.element.querySelectorAll(".bolt-tree-cell");
    expect(getComputedStyle(cells[0]!).overflow).toBe("visible");
    for (const cell of [cells[1]!, cells[2]!]) {
      expect(getComputedStyle(cell).overflow).toBe("hidden");
      expect(getComputedStyle(cell.firstElementChild!).marginInlineStart).toBe("-16px");
    }
    adapter!.update({ ...f.configuration, semantic: { ...f.configuration.semantic!, view: { mode: "all", groupId: null } } });
    expect(f.host.element.hasAttribute("data-adopp-compact-groups")).toBe(false);
    expect(getComputedStyle(cells[1]!).overflow).not.toBe("hidden");
  });
});

describe("semantic bridge validation", () => {
  it("accepts bounded complete membership and rejects duplicate, unknown, incomplete, and oversized results", () => {
    expect(configurationSchema.safeParse(config()).success).toBe(true);
    for (const mutate of [
      (c: TreeConfiguration) => { c.semantic!.groups[1]!.paths = ["/src/a.ts"]; },
      (c: TreeConfiguration) => { c.semantic!.groups[0]!.paths = ["/unknown.ts"]; },
      (c: TreeConfiguration) => { c.semantic!.groups.pop(); },
      (c: TreeConfiguration) => { c.semantic!.groups[1]!.id = "one"; },
      (c: TreeConfiguration) => { c.semantic!.view = { mode: "group", groupId: "missing" }; },
      (c: TreeConfiguration) => { c.semantic!.groups[0]!.rationale = "x".repeat(8001); }
    ]) {
      const c = config();
      mutate(c);
      expect(configurationSchema.safeParse(c).success).toBe(false);
    }
  });
});
