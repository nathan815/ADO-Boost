import { record } from "./protocol";

export interface NativeEntry {
  item: { path?: string | null };
  originalPath?: string;
}

export interface NativeChanges {
  changeEntries: NativeEntry[];
  iterationId: number;
  baseIterationId: number;
}

export interface NativeCollection {
  sourceVersion: { version: string };
  targetVersion: { version: string };
  totalChanges: number;
}

export interface NativeObservable {
  value: NativeCollection;
  subscribe(listener: () => void): void;
  unsubscribe(listener: () => void): void;
}

export interface NativeView {
  getFilesFilter(): { hasChangesToReset(): boolean };
  processChanges(changes: NativeChanges | undefined, key?: string, filters?: unknown): unknown;
  updateChanges(changes: NativeChanges | undefined): void;
  changesCurrentKey: string;
  iterationChangesCache: Record<string, NativeChanges>;
  selectedIterationId: { value: number };
  baseIterationId: { value: number };
  changes: NativeObservable;
}

export interface NativeColumn {
  id: string;
  renderCell(...args: unknown[]): unknown;
}

export interface NativeTree {
  props: { columns: NativeColumn[] };
  render(): unknown;
  forceUpdate(): void;
}

export interface HostReact {
  createElement(type: string, props: Record<string, unknown>, ...children: unknown[]): unknown;
  cloneElement(element: NativeElement, props: Record<string, unknown>, ...children: unknown[]): NativeElement;
  isValidElement(element: unknown): element is NativeElement;
}

export interface NativeElement {
  type: unknown;
  key?: unknown;
  props: Record<string, unknown>;
}

export interface NativeHost {
  element: Element;
  view: NativeView;
  tree: NativeTree;
  react: HostReact;
}

function observable(value: unknown): value is NativeObservable {
  return record(value) && record(value.value) && typeof value.subscribe === "function" && typeof value.unsubscribe === "function"
    && record(value.value.sourceVersion) && typeof value.value.sourceVersion.version === "string"
    && record(value.value.targetVersion) && typeof value.value.targetVersion.version === "string"
    && typeof value.value.totalChanges === "number";
}

function view(value: unknown): value is NativeView {
  if (!record(value) || typeof value.getFilesFilter !== "function") return false;
  const filter: unknown = value.getFilesFilter();
  return record(filter) && typeof filter.hasChangesToReset === "function"
    && typeof value.processChanges === "function" && typeof value.updateChanges === "function"
    && typeof value.changesCurrentKey === "string" && record(value.iterationChangesCache)
    && record(value.selectedIterationId) && typeof value.selectedIterationId.value === "number"
    && record(value.baseIterationId) && typeof value.baseIterationId.value === "number" && observable(value.changes);
}

function tree(value: unknown): value is NativeTree {
  return record(value) && record(value.props) && columns(value.props.columns)
    && typeof value.render === "function" && typeof value.forceUpdate === "function";
}

export function columns(value: unknown): value is NativeColumn[] {
  return Array.isArray(value) && value.every((column: unknown) =>
    record(column) && typeof column.id === "string" && typeof column.renderCell === "function"
  ) && value.some((column: NativeColumn) => column.id === "name");
}

export function discoverHost(element: Element, react: HostReact): NativeHost | null {
  const key = Object.getOwnPropertyNames(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber: unknown = key ? Reflect.get(element, key) : null;
  let nativeTree: NativeTree | null = null;
  let nativeView: NativeView | null = null;
  const visited = new Set<unknown>();
  for (let depth = 0; record(fiber) && depth < 80 && !visited.has(fiber); depth++) {
    visited.add(fiber);
    const props = fiber.memoizedProps;
    const instance = fiber.stateNode;
    if (!nativeTree && record(props) && columns(props.columns) && typeof props.renderRow === "function"
      && record(instance) && record(instance.list) && tree(instance)) nativeTree = instance;
    if (record(props) && record(props.value) && view(props.value.viewService)) nativeView = props.value.viewService;
    if (nativeTree && nativeView) return { element, tree: nativeTree, view: nativeView, react };
    fiber = fiber.return;
  }
  return null;
}

export function getHostReact(scope: Window): HostReact | null {
  const require: unknown = Reflect.get(scope, "require");
  if (typeof require !== "function" || typeof Reflect.get(require, "defined") !== "function") return null;
  if (!Reflect.apply(Reflect.get(require, "defined"), require, ["react"])) return null;
  const react: unknown = require("react");
  return isHostReact(react) ? react : null;
}

function isHostReact(value: unknown): value is HostReact {
  return record(value) && typeof value.createElement === "function" && typeof value.cloneElement === "function"
    && typeof value.isValidElement === "function";
}

export function nativeChanges(value: unknown): value is NativeChanges {
  return record(value) && typeof value.iterationId === "number" && typeof value.baseIterationId === "number"
    && Array.isArray(value.changeEntries) && value.changeEntries.every((entry: unknown) =>
      record(entry) && record(entry.item) && (entry.item.path === undefined || entry.item.path === null || typeof entry.item.path === "string")
      && (entry.originalPath === undefined || typeof entry.originalPath === "string")
    );
}
