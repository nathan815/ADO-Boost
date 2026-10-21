import type { NativeChanges, NativeCollection, NativeColumn, NativeElement, NativeHost } from "./host";
import { columns, nativeChanges } from "./host";
import { hasFilters, matchesFilters, record } from "./protocol";
import type { TreeConfiguration, TreeFile, TreeStatus } from "./protocol";
import { lineCountParts } from "../core/line-counts";
import { SemanticTreeAdapter } from "./semantic-adapter";
import { discoverSemanticHost } from "./semantic-host";

export type ReportStatus = (state: TreeStatus["state"], detail: string, fileCount: number | null) => void;

export function comparisonMatches(host: NativeHost, config: TreeConfiguration): boolean {
  const { view } = host;
  return view.selectedIterationId.value === config.comparison.iteration && view.baseIterationId.value === 0
    && view.changes.value.sourceVersion.version === config.comparison.source
    && view.changes.value.targetVersion.version === config.comparison.base;
}

function restoreProperty(target: object, name: string, owned: unknown, descriptor: PropertyDescriptor | undefined): void {
  if (Reflect.get(target, name) !== owned) return;
  if (descriptor) Object.defineProperty(target, name, descriptor);
  else Reflect.deleteProperty(target, name);
}

export class NativeTreeAdapter {
  private config: TreeConfiguration;
  private files: Map<string, TreeFile>;
  private disposed = false;
  private failed = false;
  private countsFailure = "";
  private filterRevision = 0;
  private renderRevision = 0;
  private semantic: SemanticTreeAdapter | undefined;
  private semanticFailure = "";
  private semanticSelection: string | undefined;
  private readonly processDescriptor: PropertyDescriptor | undefined;
  private renderDescriptor: PropertyDescriptor | undefined;
  private readonly originalProcess;
  private originalRender;
  private readonly observable;
  private renderedCollection: NativeCollection | undefined;
  private nativeRowKey: unknown;
  private rowKey: ((index: number, item: unknown) => string) | undefined;
  private readonly cellHooks = new Map<NativeColumn, { descriptor: PropertyDescriptor | undefined; owned: NativeColumn["renderCell"] }>();

  constructor(
    private readonly host: NativeHost,
    config: TreeConfiguration,
    private readonly report: ReportStatus,
    private readonly scheduleFailure: (action: () => void) => void = (action) => { queueMicrotask(action); }
  ) {
    this.config = config;
    this.files = new Map(config.files.map((file) => [file.path, file]));
    this.processDescriptor = Object.getOwnPropertyDescriptor(host.view, "processChanges");
    this.renderDescriptor = Object.getOwnPropertyDescriptor(host.tree, "render");
    this.originalProcess = host.view.processChanges;
    this.originalRender = host.tree.render;
    this.observable = host.view.changes;
  }

  start(): void {
    this.host.view.processChanges = this.processChanges;
    this.host.tree.render = this.render;
    this.observable.subscribe(this.onChanged);
    try {
      if (hasFilters(this.config.filters)) this.refreshChanges();
      this.host.tree.forceUpdate();
      this.onChanged();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  rebind(host: NativeHost): void {
    if (this.disposed || this.failed || host.view !== this.host.view) return;
    if (this.semantic) this.semanticSelection = this.semantic.selectedPath;
    this.semantic?.dispose();
    this.semantic = undefined;
    restoreProperty(this.host.tree, "render", this.render, this.renderDescriptor);
    this.restoreCells();
    this.host.element = host.element;
    this.host.tree = host.tree;
    this.renderDescriptor = Object.getOwnPropertyDescriptor(host.tree, "render");
    this.originalRender = host.tree.render;
    this.rowKey = undefined;
    host.tree.render = this.render;
    this.syncSemantic();
    host.tree.forceUpdate();
    this.onChanged();
  }

  update(config: TreeConfiguration): void {
    if (this.disposed || this.failed) return;
    const changed = JSON.stringify(this.config.filters) !== JSON.stringify(config.filters)
      || this.config.comparison.source !== config.comparison.source
      || this.config.comparison.base !== config.comparison.base
      || this.config.countsEnabled !== config.countsEnabled
      || this.config.countDescription !== config.countDescription
      || JSON.stringify(this.config.files) !== JSON.stringify(config.files);
    this.config = config;
    this.files = new Map(config.files.map((file) => [file.path, file]));
    if (changed) {
      this.filterRevision++;
      this.refresh();
    } else {
      this.syncSemantic();
      try { this.semantic?.update(config); } catch (error) { this.failSemantic(error); }
      this.onChanged();
    }
  }

  reconcile(): void {
    if (!this.disposed && !this.failed && this.config.semantic && !this.semantic && !this.semanticFailure) this.onChanged();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.semantic?.dispose();
    this.semantic = undefined;
    this.observable.unsubscribe(this.onChanged);
    restoreProperty(this.host.view, "processChanges", this.processChanges, this.processDescriptor);
    restoreProperty(this.host.tree, "render", this.render, this.renderDescriptor);
    this.restoreCells();
    // Rebuild from ADO's untouched cache, not the last filtered collection.
    if (this.host.view.processChanges === this.originalProcess) this.refreshChanges();
    if (this.host.element.isConnected) this.host.tree.forceUpdate();
  }

  private refreshChanges(): void {
    const { view } = this.host;
    const raw = view.iterationChangesCache[`${view.selectedIterationId.value}-${view.baseIterationId.value}`];
    if (!nativeChanges(raw)) throw new Error("Native iteration cache is unavailable or incompatible");
    // ADO's key knows nothing about our predicates, including equal-size result changes.
    view.changesCurrentKey = `adopp:${this.config.session}:${this.filterRevision}`;
    view.updateChanges(raw);
  }

  private refresh(): void {
    this.refreshChanges();
    if (this.host.element.isConnected) this.host.tree.forceUpdate();
    this.onChanged();
  }

  private readonly onChanged = (): void => {
    if (this.disposed || this.failed) return;
    this.syncSemantic();
    if (this.renderedCollection !== this.host.view.changes.value) {
      this.renderedCollection = this.host.view.changes.value;
      this.rowKey = undefined;
      // Native filters can rebuild cached rows before the decorated renderer runs.
      if (this.host.element.isConnected) this.host.tree.forceUpdate();
    }
    if (!comparisonMatches(this.host, this.config)) {
      this.report("comparison-mismatch", "Native filters remain available. ADO Boost counts and extra filters require the analyzed merge-base comparison.", null);
    } else if (this.semanticFailure) {
      this.report("groups-unavailable", this.semanticFailure, this.host.view.changes.value.totalChanges);
    } else if (this.countsFailure) {
      this.report("counts-unavailable", this.countsFailure, this.semantic?.fileCount ?? this.host.view.changes.value.totalChanges);
    } else {
      this.report("active", "Native model filtering and React-rendered counts are active. Use ADO's Filter control for search and reviewed state.",
        this.semantic?.fileCount ?? this.host.view.changes.value.totalChanges);
    }
  };

  private syncSemantic(): void {
    if (!this.config.semantic || !comparisonMatches(this.host, this.config) || (this.semantic && !this.semantic.matches(this.host))) {
      if (this.semantic) this.semanticSelection = this.semantic.selectedPath;
      this.semantic?.dispose();
      this.semantic = undefined;
    }
    if (!this.config.semantic) this.semanticFailure = "";
    if (!this.config.semantic || !comparisonMatches(this.host, this.config)) this.semanticSelection = undefined;
    if (!this.config.semantic || !comparisonMatches(this.host, this.config) || this.semanticFailure || this.semantic) return;
    // Restoring the old explorer can synchronously commit ADO's replacement tree.
    if (!this.host.element.isConnected || this.host.element.ownerDocument.querySelector(".repos-file-explorer-tree") !== this.host.element) return;
    const native = discoverSemanticHost(this.host.element);
    if (native && native.explorer.props.changes !== this.host.view.changes.value) return;
    try {
      this.semantic = new SemanticTreeAdapter(this.host, this.config, this.invalidateRows, (action, view) => {
        const scope = this.host.element.ownerDocument.defaultView;
        scope?.postMessage({ channel: this.config.channel, kind: "semantic-action", session: this.config.session, action, view }, scope.location.origin);
      }, this.failSemantic, this.semanticSelection);
      this.semantic.start();
    } catch (error) { this.failSemantic(error); }
  }

  private readonly invalidateRows = (): void => {
    this.rowKey = undefined;
    this.renderRevision++;
    if (this.host.element.isConnected) this.host.tree.forceUpdate();
  };

  private readonly failSemantic = (error: unknown): void => {
    if (this.semanticFailure) return;
    this.semanticFailure = error instanceof Error ? error.message : "Native semantic grouping is unavailable.";
    console.warn("ADO Boost semantic tree unavailable:", error);
    this.report("groups-unavailable", this.semanticFailure, this.host.view.changes.value.totalChanges);
    this.scheduleFailure(() => {
      this.semantic?.dispose();
      this.semantic = undefined;
    });
  };

  private fail(detail: string): void {
    if (this.failed) return;
    this.failed = true;
    this.report("unavailable", detail, null);
    this.scheduleFailure(() => this.dispose());
  }

  private failCounts(detail: string): void {
    if (this.countsFailure) return;
    this.countsFailure = `${detail} Native model filtering remains active.`;
    this.report("counts-unavailable", this.countsFailure, this.host.view.changes.value.totalChanges);
    this.scheduleFailure(() => {
      this.restoreCells();
      if (!this.disposed && this.host.element.isConnected) this.host.tree.forceUpdate();
    });
  }

  private readonly processChanges = (changes: NativeChanges | undefined, key?: string, filters?: unknown): unknown => {
    let next = changes;
    if (!this.disposed && !this.failed && changes && hasFilters(this.config.filters)
      && changes.iterationId === this.config.comparison.iteration && changes.baseIterationId === 0) {
      if (!nativeChanges(changes)) {
        this.fail("Native change-entry contract changed; extra filters were disabled.");
      } else {
        const entries = changes.changeEntries.filter((entry) => {
          const file = this.files.get(entry.item.path || entry.originalPath || "");
          // Preserve unresolved native entries instead of silently hiding unknown files.
          return !file || matchesFilters(file, this.config.filters);
        });
        next = { ...changes, changeEntries: entries };
      }
    }
    return this.originalProcess.call(this.host.view, next,
      hasFilters(this.config.filters) ? `${key ?? ""}:adopp:${this.filterRevision}` : key, filters);
  };

  private readonly render = (): unknown => {
    this.restoreCells();
    if (this.disposed || this.failed || !comparisonMatches(this.host, this.config)
      || ((!this.config.countsEnabled || this.countsFailure) && !this.semantic)) {
      return this.originalRender.call(this.host.tree);
    }
    if (this.config.countsEnabled && !this.countsFailure) {
      const nativeColumns = this.host.tree.props.columns;
      if (!columns(nativeColumns)) {
        this.failCounts("Native Table column contract changed; counts were disabled.");
        return this.originalRender.call(this.host.tree);
      }
      const name = nativeColumns.find((column) => column.id === "name")!;
      const descriptor = Object.getOwnPropertyDescriptor(name, "renderCell");
      if (!descriptor?.writable) {
        this.failCounts("Native name-column callback is not writable; counts were disabled.");
        return this.originalRender.call(this.host.tree);
      }
      const owned = this.decorateColumn(name).renderCell;
      this.cellHooks.set(name, { descriptor, owned });
      // Tree.renderRow reads its own column objects, not Table's replacement props.
      name.renderCell = owned;
    }
    const element = this.originalRender.call(this.host.tree);
    let refreshed = false;
    const refreshList = (node: unknown): unknown => {
      if (!this.host.react.isValidElement(node)) return node;
      if ("itemProvider" in node.props && typeof node.props.renderRow === "function" && !("columns" in node.props)) {
        refreshed = true;
        const nativeRowKey = node.props.getRowKey;
        if (!this.rowKey || this.nativeRowKey !== nativeRowKey) {
          this.nativeRowKey = nativeRowKey;
          this.rowKey = (index, item) => {
            const key: unknown = typeof nativeRowKey === "function" ? nativeRowKey(index, item) : index;
            return `${typeof key === "string" || typeof key === "number" ? key : index}:adopp:${this.config.session}:${this.renderRevision}`;
          };
        }
        // List invalidates its cached row observers when getRowKey changes.
        return this.host.react.cloneElement(node, { getRowKey: this.rowKey });
      }
      if (node.props.children === undefined) return node;
      const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
      return this.host.react.cloneElement(node, {}, ...children.map(refreshList));
    };
    const result = refreshList(element);
    if (!refreshed) {
      this.failCounts("Native virtualized List renderer contract changed; counts were disabled.");
      if (this.semantic) this.failSemantic(new Error("Native virtualized List renderer changed; semantic grouping was disabled."));
    }
    return result;
  };

  private restoreCells(): void {
    for (const [column, hook] of this.cellHooks) restoreProperty(column, "renderCell", hook.owned, hook.descriptor);
    this.cellHooks.clear();
  }

  private decorateColumn(column: NativeColumn): NativeColumn {
    const renderCell = column.renderCell;
    return {
      ...column,
      renderCell: (...args: unknown[]) => {
        const original = renderCell.call(column, ...args);
        if (this.disposed || this.failed || this.countsFailure || !this.config.countsEnabled || !comparisonMatches(this.host, this.config)) return original;
        const item = args[3];
        if (!record(item) || !record(item.underlyingItem) || !record(item.underlyingItem.data)) {
          this.failCounts("Native file-cell identity contract changed; counts were disabled.");
          return original;
        }
        const data = item.underlyingItem.data;
        if (data.isFolder || data.thread || typeof data.path !== "string") return original;
        const file = this.files.get(data.path);
        if (!file) return original;
        return this.decorateCell(original, file);
      }
    };
  }

  private decorateCell(original: unknown, file: TreeFile): unknown {
    const react = this.host.react;
    if (!react.isValidElement(original)) {
      this.failCounts("Native name-cell renderer no longer returns a React element; counts were disabled.");
      return original;
    }
    const children = original.props.children;
    const list = Array.isArray(children) ? children : [children];
    const label = list[0];
    if (!react.isValidElement(label) || label.type !== "div") {
      this.failCounts("Native file-label layout changed; counts were disabled.");
      return original;
    }
    const countsAvailable = file.additions !== null && file.deletions !== null;
    const parts = file.additions !== null && file.deletions !== null ? lineCountParts(file.additions, file.deletions) : [];
    if (countsAvailable && parts.length === 0 && file.state === "exact") return original;
    const text = countsAvailable
      ? [...parts.map((part) => part.text), ...(file.state === "exact" ? [] : ["~"])].join(" ") : file.state;
    const countChildren: unknown[] = [];
    for (const part of parts) {
      if (countChildren.length) countChildren.push(" ");
      countChildren.push(react.createElement("span", { className: `adopp-native-stat-${part.kind}` }, part.text));
    }
    if (!countsAvailable) countChildren.push(file.state);
    else if (file.state !== "exact") countChildren.push(parts.length ? " ~" : "~");
    const count = react.createElement("span", {
      key: "adopp-count",
      "data-adopp-react-stat": file.path,
      "data-state": file.state,
      className: "adopp-native-stat",
      title: `ADO Boost merge-base counts: ${text}${this.config.countDescription ? `. ${this.config.countDescription}` : ""}`,
      "aria-label": `ADO Boost: ${text}`,
      style: { flexShrink: 0, marginInlineStart: 6, fontSize: 11, fontVariantNumeric: "tabular-nums" }
    }, ...countChildren);
    const labelChildren = Array.isArray(label.props.children) ? label.props.children : [label.props.children];
    const decorated: NativeElement = react.cloneElement(label, {}, ...labelChildren, count);
    return react.cloneElement(original, {}, decorated, ...list.slice(1));
  }
}
