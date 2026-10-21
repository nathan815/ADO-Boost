import type { NativeHost, NativeElement } from "./host";
import { record } from "./protocol";
import type { NativeData, NativeNode, SemanticCollection } from "./semantic-projection";

export interface NativeProvider {
  roots: NativeNode[];
  value: { underlyingItem: NativeNode }[];
  splice(parent: undefined, removed: NativeNode[], added: { items: NativeNode[] }[]): void;
  expand(node: NativeNode, ancestors?: boolean): void;
  toggle(node: NativeNode): void;
}

export interface NativeNavigation {
  selectedItem: {
    value: NativeData;
    subscribe(listener: (data: NativeData) => void): void;
    unsubscribe(listener: (data: NativeData) => void): void;
  };
  setSelectedItem(data: NativeData, first?: boolean, last?: boolean): void;
  findNextFile(): NativeData | undefined;
  findPreviousFile(): NativeData | undefined;
  onSelectedItemChanged(data: NativeData): void;
}

export interface NativeExplorer {
  props: { changes: SemanticCollection; selectedThreadId?: { value: number | null | undefined } };
  itemProvider: NativeProvider;
  treeRef: unknown;
  selection: NativeSelection;
  treeDiffIntegration?: unknown;
  render(): unknown;
  onActivate(event: unknown, item: unknown): unknown;
  setSelectedItemAndThread(data: NativeData, thread?: number): void;
  forceUpdate(): void;
}

export interface NativeSplitter {
  render(): unknown;
  forceUpdate(): void;
}

export interface SemanticHost {
  explorer: NativeExplorer;
  splitter: NativeSplitter;
  navigation: NativeNavigation;
}

interface Fiber {
  type: unknown;
  stateNode: unknown;
  memoizedProps: Record<string, unknown>;
}

export function fiberChain(element: Element | null): Fiber[] {
  const key = element && Object.getOwnPropertyNames(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber: unknown = element && key ? Reflect.get(element, key) : null;
  const result: Fiber[] = [];
  const seen = new Set<unknown>();
  for (let depth = 0; record(fiber) && depth < 80 && !seen.has(fiber); depth++) {
    seen.add(fiber);
    result.push({ type: fiber.type, stateNode: fiber.stateNode, memoizedProps: record(fiber.memoizedProps) ? fiber.memoizedProps : {} });
    fiber = fiber.return;
  }
  return result;
}

function explorer(value: unknown): value is NativeExplorer {
  return record(value) && record(value.props) && record(value.props.changes)
    && record(value.itemProvider) && Array.isArray(value.itemProvider.roots) && Array.isArray(value.itemProvider.value)
    && ["splice", "expand", "toggle"].every((name) => typeof Reflect.get(value.itemProvider!, name) === "function")
    && typeof value.render === "function" && typeof value.onActivate === "function"
    && record(value.selection) && typeof value.selection.select === "function"
    && typeof value.setSelectedItemAndThread === "function" && typeof value.forceUpdate === "function";
}

function navigation(value: unknown): value is NativeNavigation {
  return record(value) && record(value.selectedItem) && record(value.selectedItem.value)
    && typeof value.selectedItem.subscribe === "function" && typeof value.selectedItem.unsubscribe === "function"
    && ["setSelectedItem", "findNextFile", "findPreviousFile", "onSelectedItemChanged"].every((name) => typeof value[name] === "function");
}

export function discoverSemanticHost(element: Element): SemanticHost | null {
  let nativeExplorer: NativeExplorer | undefined;
  let nativeNavigation: NativeNavigation | undefined;
  let splitter: NativeSplitter | undefined;
  for (const frame of fiberChain(element)) {
    const instance = frame.stateNode;
    if (!nativeExplorer && explorer(instance)) nativeExplorer = instance;
    if (!splitter && record(instance) && record(instance.props)
      && typeof instance.props.onRenderFarElement === "function" && typeof instance.props.onRenderNearElement === "function"
      && typeof instance.render === "function" && typeof instance.forceUpdate === "function") {
      if (isSplitter(instance)) splitter = instance;
    }
    const context = frame.memoizedProps.value;
    if (record(context) && navigation(context.navigationService)) nativeNavigation = context.navigationService;
  }
  return nativeExplorer && nativeNavigation && splitter ? { explorer: nativeExplorer, navigation: nativeNavigation, splitter } : null;
}

function isSplitter(value: unknown): value is NativeSplitter {
  return record(value) && typeof value.render === "function" && typeof value.forceUpdate === "function";
}

export interface NativeSelection {
  select(index: number): void;
}

export interface BoltComponents {
  Dropdown: unknown;
  Expandable: unknown;
  Cell: unknown;
  Selection: new () => NativeSelection;
}

const boltComponents = new WeakMap<Document, BoltComponents>();

function selectionConstructor(value: unknown): value is BoltComponents["Selection"] {
  return typeof value === "function" && record(value.prototype) && typeof value.prototype.select === "function";
}

export function discoverBoltComponents(host: NativeHost): BoltComponents {
  const repository = fiberChain(host.element.ownerDocument.querySelector(".repository-selector"));
  const dropdown = repository.find(({ stateNode }) => record(stateNode) && record(stateNode.parentSelection) && typeof stateNode.renderCallout === "function");
  const expandable = repository.find(({ stateNode }) => record(stateNode) && stateNode.buttonElement && typeof stateNode.renderCallout === "function");
  const cached = boltComponents.get(host.element.ownerDocument);
  if (cached && cached.Dropdown === dropdown?.type && cached.Expandable === expandable?.type) return cached;
  const selection = record(dropdown?.stateNode) && record(dropdown.stateNode.parentSelection)
    ? Reflect.get(Object.getPrototypeOf(dropdown.stateNode.parentSelection), "constructor") : null;
  let cell: Fiber | undefined;
  for (const element of host.element.querySelectorAll(".bolt-table-cell")) {
    cell = fiberChain(element).find((frame) => record(frame.memoizedProps.tableColumn)
      && typeof frame.memoizedProps.columnIndex === "number" && typeof frame.type === "function"
      && String(frame.type).includes("bolt-table-cell-content"));
    if (cell) break;
  }
  if (!dropdown || !expandable || !cell || !selectionConstructor(selection)) {
    throw new Error("ADO's native group dropdown components are unavailable. Group results remain available in the sidebar.");
  }
  const components = { Dropdown: dropdown.type, Expandable: expandable.type, Cell: cell.type, Selection: selection };
  boltComponents.set(host.element.ownerDocument, components);
  return components;
}

export function transformElements(
  host: NativeHost,
  node: unknown,
  transform: (element: NativeElement) => NativeElement | null
): unknown {
  if (Array.isArray(node)) return node.map((child) => transformElements(host, child, transform));
  if (!host.react.isValidElement(node)) return node;
  const next = transform(node);
  if (!next) return null;
  if (typeof next.props.children === "function") {
    const children = next.props.children;
    return host.react.cloneElement(next, {}, (...args: unknown[]) => transformElements(host, children(...args), transform));
  }
  if (next.props.children === undefined) return next;
  const children = Array.isArray(next.props.children) ? next.props.children : [next.props.children];
  return host.react.cloneElement(next, {}, ...children.map((child) => transformElements(host, child, transform)));
}

export function restoreOwned(target: object, key: string, owned: unknown, descriptor: PropertyDescriptor | undefined): void {
  if (Reflect.get(target, key) !== owned) return;
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}
