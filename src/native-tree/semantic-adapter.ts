import type { NativeColumn, NativeElement, NativeHost } from "./host";
import { columns } from "./host";
import { record } from "./protocol";
import type { TreeConfiguration, TreeGroup } from "./protocol";
import { discoverBoltComponents, discoverSemanticHost, restoreOwned, transformElements } from "./semantic-host";
import type { SemanticHost } from "./semantic-host";
import { groupPaths, isNativeNode, isSemanticCollection, nativeFiles, projectNodes, scopeCollection, walkNodes } from "./semantic-projection";
import type { NativeData, NativeNode, SemanticCollection } from "./semantic-projection";
import { SemanticToolbar } from "./semantic-toolbar";
import type { SemanticAction } from "./semantic-toolbar";

interface Hook {
  target: object;
  key: string;
  owned: unknown;
  descriptor: PropertyDescriptor | undefined;
}

export class SemanticTreeAdapter {
  private readonly native: SemanticHost;
  private readonly toolbar: SemanticToolbar;
  private readonly hooks: Hook[] = [];
  private readonly originalRender;
  private readonly originalSummary;
  private readonly originalActivate;
  private readonly originalSelect;
  private readonly originalNext;
  private readonly originalPrevious;
  private readonly collection: SemanticCollection;
  private readonly sourceRoots: NativeNode[];
  private readonly sourceFiles: Map<string, NativeNode>;
  private readonly groupByNode = new WeakMap<NativeNode, TreeGroup>();
  private readonly syntheticRoots = new WeakSet<NativeNode>();
  private readonly expansion = new Map<string, boolean>();
  private readonly counts = new Map<string, number>();
  private projectedFiles = new Map<string, NativeNode>();
  private projectedRoots: NativeNode[] = [];
  private summaryCache = new Map<string, SemanticCollection>();
  private scope: string | null = null;
  private pendingFolder: { path: string; groupId: string } | undefined;
  private disposed = false;
  private projecting = false;
  private lastSelected: NativeData;

  constructor(
    private readonly host: NativeHost,
    private config: TreeConfiguration,
    private readonly invalidateRows: () => void,
    private readonly action: SemanticAction,
    private readonly failed: (error: unknown) => void,
    private initialPath?: string
  ) {
    const native = discoverSemanticHost(host.element);
    if (!native || !isSemanticCollection(host.view.changes.value) || native.explorer.props.changes !== host.view.changes.value) {
      throw new Error("The native semantic tree or summary-view contract is unavailable.");
    }
    this.native = native;
    this.collection = host.view.changes.value;
    this.sourceRoots = [...native.explorer.itemProvider.roots];
    this.sourceFiles = new Map(nativeFiles(this.sourceRoots).map((node) => [node.data.path, node]));
    this.originalRender = native.explorer.render;
    this.originalSummary = native.splitter.render;
    this.originalActivate = native.explorer.onActivate;
    this.originalSelect = native.explorer.setSelectedItemAndThread;
    this.originalNext = native.navigation.findNextFile;
    this.originalPrevious = native.navigation.findPreviousFile;
    this.lastSelected = native.navigation.selectedItem.value;
    this.toolbar = new SemanticToolbar(host, discoverBoltComponents(host), action);
  }

  start(): void {
    try {
      this.toolbar.mount();
      this.hook(this.native.explorer, "render", this.render);
      this.hook(this.native.explorer, "onActivate", this.activate);
      this.hook(this.native.explorer, "setSelectedItemAndThread", this.select);
      this.hook(this.native.splitter, "render", this.renderSummary);
      this.hook(this.native.navigation, "findNextFile", this.next);
      this.hook(this.native.navigation, "findPreviousFile", this.previous);
      this.hookDiscussions();
      this.native.navigation.selectedItem.subscribe(this.onSelected);
      this.rebuild();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  update(config: TreeConfiguration): void {
    const changed = this.config.semantic?.revision !== config.semantic?.revision
      || JSON.stringify(this.config.semantic?.groups) !== JSON.stringify(config.semantic?.groups);
    const viewChanged = JSON.stringify(this.config.semantic?.view) !== JSON.stringify(config.semantic?.view);
    this.config = config;
    if (changed || viewChanged) this.rebuild(changed);
    else this.native.explorer.forceUpdate();
  }

  matches(host: NativeHost): boolean {
    return this.collection === host.view.changes.value && this.native.explorer.props.changes === this.collection
      && host.element === this.host.element;
  }

  get fileCount(): number {
    const view = this.config.semantic!.view;
    return view.mode === "group" ? this.counts.get(view.groupId!) ?? 0 : this.collection.totalChanges;
  }

  get selectedPath(): string | undefined {
    return this.lastSelected.isFolder ? undefined : this.lastSelected.path;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.native.navigation.selectedItem.unsubscribe(this.onSelected);
    this.syncDiscussions();
    if (this.projecting && this.native.explorer.props.changes === this.collection) this.replaceRoots(this.sourceRoots);
    for (const hook of this.hooks.reverse()) restoreOwned(hook.target, hook.key, hook.owned, hook.descriptor);
    this.host.element.removeAttribute("data-adopp-compact-groups");
    this.toolbar.dispose();
    this.native.explorer.forceUpdate();
    this.native.splitter.forceUpdate();
    this.native.navigation.onSelectedItemChanged(this.native.navigation.selectedItem.value);
    this.invalidateRows();
  }

  private hook(target: object, key: string, owned: unknown): void {
    this.hooks.push({ target, key, owned, descriptor: Object.getOwnPropertyDescriptor(target, key) });
    if (!Reflect.set(target, key, owned)) throw new Error(`Native semantic hook ${key} is not writable.`);
  }

  private hookDiscussions(): void {
    const integration = this.native.explorer.treeDiffIntegration;
    if (!integration) return;
    const widget = record(integration) ? integration.widget : null;
    if (!record(widget) || typeof widget.findFileItem !== "function") {
      throw new Error("Native discussion lookup changed; semantic grouping was disabled to preserve discussion navigation.");
    }
    const findFileItem = widget.findFileItem;
    this.hook(widget, "findFileItem", (path: string) => {
      if (!this.disposed && this.config.semantic?.view.mode !== "all") return this.projectedFiles.get(path);
      return findFileItem.call(widget, path);
    });
  }

  private syncDiscussions(): void {
    for (const [path, file] of this.projectedFiles) {
      const source = this.sourceFiles.get(path);
      if (!source || source === file) continue;
      // Native discussion widgets modify projected wrappers. Carry their live state back before replacement.
      const children = projectNodes([file], new Set([path]))[0]?.childItems;
      if (children) source.childItems = children;
      else Reflect.deleteProperty(source, "childItems");
    }
  }

  private rememberExpansion(): void {
    walkNodes(this.projectedRoots, (node) => {
      if (typeof node.expanded === "boolean") {
        this.expansion.set(`${this.groupByNode.get(node)?.id ?? ""}:${node.data.path}`, node.expanded);
      }
    });
  }

  private rebuild(resetExpansion = false): void {
    const semantic = this.config.semantic!;
    this.syncDiscussions();
    this.rememberExpansion();
    if (resetExpansion) this.expansion.clear();
    this.summaryCache.clear();
    this.pendingFolder = undefined;
    this.counts.clear();
    const analyzed = new Set(this.config.files.map((file) => file.path));
    if (semantic.groups.length && (this.collection.loadMoreChanges || [...this.sourceFiles.keys()].some((path) => !analyzed.has(path)))) {
      throw new Error("Some native changes are not fully loaded or analyzed. Semantic views are unavailable; ordinary ADO browsing is unchanged.");
    }
    for (const group of semantic.groups) this.counts.set(group.id, group.paths.filter((path) => this.sourceFiles.has(path)).length);
    let roots = this.sourceRoots;
    this.scope = semantic.view.mode === "group" ? semantic.view.groupId : null;
    if (semantic.view.mode === "group") {
      const group = semantic.groups.find((item) => item.id === semantic.view.groupId)!;
      roots = this.project(group);
    } else if (semantic.view.mode === "inline") {
      roots = semantic.groups.filter((group) => this.counts.get(group.id)).map((group, index) => {
        const count = this.counts.get(group.id)!;
        const root: NativeNode = { expanded: true, childItems: this.project(group), data: {
          ...this.collection.rootTreeItem.data, isFolder: true,
          name: `${group.title} (${count === group.paths.length ? count : `${count} of ${group.paths.length}`})`,
          path: `/__adopp_semantic__/${this.config.session}/${index}`,
          iconProps: { render: this.renderIcon }
        } };
        this.groupByNode.set(root, group);
        this.syntheticRoots.add(root);
        const expanded = this.expansion.get(`${group.id}:${root.data.path}`);
        if (expanded !== undefined) root.expanded = expanded;
        return root;
      });
    }
    this.projectedRoots = semantic.view.mode === "all" ? [] : roots;
    this.projecting = semantic.view.mode !== "all";
    this.projectedFiles = new Map(nativeFiles(roots).map((node) => [node.data.path, node]));
    this.replaceRoots(roots);
    this.host.element.toggleAttribute("data-adopp-compact-groups", semantic.view.mode === "inline");
    const selected = this.native.navigation.selectedItem.value;
    const restored = this.initialPath && this.projectedFiles.get(this.initialPath);
    if (selected.isFolder && restored) this.native.navigation.setSelectedItem(restored.data);
    else if (semantic.view.mode === "group" && !selected.isFolder && !this.projectedFiles.has(selected.path)) {
      this.native.navigation.setSelectedItem(this.collection.rootTreeItem.data);
    }
    this.initialPath = undefined;
    this.reveal(this.native.navigation.selectedItem.value);
    this.native.navigation.onSelectedItemChanged(this.native.navigation.selectedItem.value);
    this.native.explorer.forceUpdate();
    this.native.splitter.forceUpdate();
    this.invalidateRows();
  }

  private project(group: TreeGroup): NativeNode[] {
    const roots = projectNodes(this.sourceRoots, groupPaths(group));
    walkNodes(roots, (node) => {
      this.groupByNode.set(node, group);
      const expanded = this.expansion.get(`${group.id}:${node.data.path}`);
      if (expanded !== undefined) node.expanded = expanded;
    });
    return roots;
  }

  private replaceRoots(roots: NativeNode[]): void {
    const provider = this.native.explorer.itemProvider;
    if (provider.roots.length === roots.length && provider.roots.every((root, index) => root === roots[index])) return;
    provider.splice(undefined, [...provider.roots], [{ items: roots }]);
  }

  private reveal(data: NativeData): void {
    if (this.disposed) return;
    const file = this.projectedFiles.get(data.path);
    if (file && !data.isFolder) this.native.explorer.itemProvider.expand(file, true);
    const thread = this.native.explorer.props.selectedThreadId?.value;
    this.native.explorer.setSelectedItemAndThread(data, typeof thread === "number" ? thread : undefined);
  }

  private readonly activate = (event: unknown, item: unknown): unknown => {
    const row = record(item) && record(item.data) ? item.data.underlyingItem : null;
    if (!isNativeNode(row)) return this.originalActivate.call(this.native.explorer, event, item);
    const group = this.groupByNode.get(row);
    if (this.syntheticRoots.has(row)) {
      this.guard(() => this.native.explorer.itemProvider.toggle(row), undefined);
      return;
    }
    if (group && this.config.semantic?.view.mode === "inline") {
      this.scope = group.id;
      if (row.data.isFolder && typeof row.data.path === "string") this.pendingFolder = { path: row.data.path, groupId: group.id };
      this.native.splitter.forceUpdate();
    }
    const result = this.originalActivate.call(this.native.explorer, event, item);
    if (this.native.navigation.selectedItem.value.path === row.data.path) this.pendingFolder = undefined;
    this.guard(() => this.reveal(this.native.navigation.selectedItem.value), undefined);
    return result;
  };

  private readonly onSelected = (data: NativeData): void => this.guard(() => this.selected(data), undefined);

  private selected(data: NativeData): void {
    if (this.disposed || this.host.view.changes.value !== this.collection || this.native.explorer.props.changes !== this.collection) return;
    this.lastSelected = data;
    const semantic = this.config.semantic!;
    if (semantic.view.mode === "inline") {
      this.scope = data.isFolder
        ? (this.pendingFolder?.path === data.path ? this.pendingFolder.groupId : null)
        : semantic.groups.find((group) => group.paths.includes(data.path))?.id ?? null;
      this.pendingFolder = undefined;
    } else if (semantic.view.mode === "group" && !data.isFolder && !semantic.groups.find((group) => group.id === semantic.view.groupId)?.paths.includes(data.path)) {
      this.action("select", { mode: "all", groupId: null });
    }
    this.reveal(data);
    this.native.splitter.forceUpdate();
  }

  private adjacent(direction: number): NativeData | undefined {
    if (this.config.semantic?.view.mode !== "group") {
      return (direction > 0 ? this.originalNext : this.originalPrevious).call(this.native.navigation);
    }
    const group = this.config.semantic.groups.find((item) => item.id === this.config.semantic?.view.groupId)!;
    const paths = groupPaths(group);
    const files = nativeFiles(this.collection.rootTreeItem.childItems ?? []).filter((node) => paths.has(node.data.path));
    const index = files.findIndex((node) => node.data.path === this.native.navigation.selectedItem.value.path);
    return index >= 0 ? files[index + direction]?.data : undefined;
  }

  private readonly next = (): NativeData | undefined => this.adjacent(1);
  private readonly previous = (): NativeData | undefined => this.adjacent(-1);

  private readonly select = (data: NativeData, thread?: number): void => {
    this.originalSelect.call(this.native.explorer, data, thread);
    if (this.config.semantic?.view.mode !== "inline" || !this.scope || !data.isFolder) return;
    const index = this.native.explorer.itemProvider.value.findIndex(({ underlyingItem }) =>
      underlyingItem.data.path === data.path && this.groupByNode.get(underlyingItem)?.id === this.scope);
    if (index < 0) return;
    this.native.explorer.selection.select(index);
    const ref = this.native.explorer.treeRef;
    if (record(ref) && record(ref.current) && typeof ref.current.scrollIntoView === "function") {
      ref.current.scrollIntoView(index, { block: "nearest" });
    }
  };

  private readonly render = (): unknown => {
    const original = this.originalRender.call(this.native.explorer);
    return transformElements(this.host, original, (element) => this.guard(() => {
      if (element.props.itemProvider === this.native.explorer.itemProvider) {
        if (!columns(element.props.columns)) throw new Error("Native semantic columns changed.");
        return this.host.react.cloneElement(element, { columns: element.props.columns.map((column) => this.decorateColumn(column)) });
      }
      const children = Array.isArray(element.props.children) ? element.props.children : [element.props.children];
      if (children.some((child) => this.host.react.isValidElement(child) && child.props.itemProvider === this.native.explorer.itemProvider)) {
        this.toolbar.mount();
        return this.host.react.cloneElement(element, {}, ...children, this.toolbar.render(this.config, this.counts, this.collection.totalChanges));
      }
      return element;
    }, element));
  };

  private decorateColumn(column: NativeColumn): NativeColumn {
    if (column.id !== "name" && column.id !== "checkbox") return column;
    return { ...column, renderCell: (...args: unknown[]) => {
      const original = column.renderCell.call(column, ...args);
      const row = args[3];
      const node = record(row) ? row.underlyingItem : null;
      if (!isNativeNode(node)) return original;
      const group = this.groupByNode.get(node);
      if (!group || !this.syntheticRoots.has(node)) return original;
      return this.guard(() => {
        if (column.id === "checkbox") {
          if (!this.host.react.isValidElement(original)) throw new Error("Native semantic checkbox layout changed.");
          const body: unknown = typeof original.props.children === "function" ? original.props.children({ checked: false }) : original;
          if (!this.host.react.isValidElement(body)) throw new Error("Native semantic checkbox cell changed.");
          return this.host.react.cloneElement(body, {}, null);
        }
        if (!this.host.react.isValidElement(original)) throw new Error("Native semantic name cell changed.");
        const className = typeof original.props.className === "string" ? `${original.props.className} adopp-semantic-root-cell` : "adopp-semantic-root-cell";
        const rootCell = this.host.react.cloneElement(original, { className });
        return transformElements(this.host, rootCell, (element) => {
          if (element.props.menuPropsProvider) return null;
          if (element.props.text !== node.data.path) return element;
          const label = element.props.children;
          if (!this.host.react.isValidElement(label)) throw new Error("Native semantic tooltip label changed.");
          return this.host.react.cloneElement(element, {
            text: `${group.title}\n${group.rationale}`, showOnFocus: true, overflowOnly: false, addAriaDescribedBy: true, delayMs: 250,
            renderContent: () => {
              const visible = this.counts.get(group.id) ?? 0;
              const count = visible === group.paths.length ? String(visible) : `${visible} of ${group.paths.length}`;
              return this.host.react.createElement("div", {
                style: { maxWidth: 300, whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.5, fontSize: 12, color: "inherit" }
              },
              this.host.react.createElement("div", { style: { fontWeight: 600, fontSize: 13, marginBottom: 6 } }, group.title),
              this.host.react.createElement("div", { style: { fontSize: 12, opacity: 0.9 } }, group.rationale),
              this.host.react.createElement("div", { style: { fontSize: 11, opacity: 0.7, marginTop: 8 } },
                `${count} changed file${visible === 1 && group.paths.length === 1 ? "" : "s"}. Semantic group`));
            }
          }, this.host.react.cloneElement(label, { "data-adopp-semantic-tooltip": group.id,
            "aria-label": `${group.title}. ${group.rationale}`, tabIndex: 0 }));
        });
      }, original);
    } };
  }

  private readonly renderIcon = (className: string): unknown => this.host.react.createElement("svg", {
    className, "data-adopp-group-icon": "layers", "aria-hidden": true, focusable: false, viewBox: "0 0 24 24",
    width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.6
  }, this.host.react.createElement("path", { d: "m12 3 9 5-9 5-9-5 9-5Z" }),
  this.host.react.createElement("path", { d: "m3 12 9 5 9-5M3 16l9 5 9-5" }));

  private readonly renderSummary = (): unknown => this.transformSummary(this.originalSummary.call(this.native.splitter));

  private transformSummary(node: unknown, far = false): unknown {
    if (Array.isArray(node)) return node.map((child) => this.transformSummary(child, far));
    if (!this.host.react.isValidElement(node)) return node;
    return this.guard(() => {
      far ||= typeof node.props.className === "string" && node.props.className.includes("vss-Splitter--pane-flexible");
      const props: Record<string, unknown> = {};
      if (far && this.scope && node.props.changes === this.collection) {
        const group = this.config.semantic!.groups.find((item) => item.id === this.scope);
        if (!group) throw new Error("Selected semantic summary scope is unavailable.");
        let collection = this.summaryCache.get(group.id);
        if (!collection) {
          collection = scopeCollection(this.collection, groupPaths(group), `${this.config.session}:${group.id}`);
          this.summaryCache.set(group.id, collection);
        }
        props.changes = collection;
      }
      if (typeof node.props.children === "function") {
        const children = node.props.children;
        return this.host.react.cloneElement(node, props, (...args: unknown[]) => this.transformSummary(children(...args), far));
      }
      if (node.props.children === undefined) return this.host.react.cloneElement(node, props);
      const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
      return this.host.react.cloneElement(node, props, ...children.map((child) => this.transformSummary(child, far)));
    }, node);
  }

  private guard<T>(operation: () => T, fallback: T): T {
    if (this.disposed) return fallback;
    try { return operation(); }
    catch (error) { this.failed(error); return fallback; }
  }
}
