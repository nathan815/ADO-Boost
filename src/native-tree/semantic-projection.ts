import type { NativeCollection } from "./host";
import { record } from "./protocol";
import type { TreeGroup } from "./protocol";

export interface NativeData extends Record<string, unknown> {
  path: string;
  isFolder: boolean;
  name: string;
}

export interface NativeNode {
  data: NativeData;
  childItems?: NativeNode[];
  expanded?: boolean;
}

export function isNativeNode(value: unknown): value is NativeNode {
  return record(value) && record(value.data) && typeof value.data.path === "string"
    && typeof value.data.isFolder === "boolean" && typeof value.data.name === "string"
    && (value.childItems === undefined || Array.isArray(value.childItems));
}

export interface SemanticCollection extends NativeCollection {
  key: string;
  rootTreeItem: NativeNode;
  treeItemsByPath: Record<string, NativeNode>;
  changesByPath: Record<string, NativeData>;
  loadMoreChanges?: unknown;
}

export function isSemanticCollection(value: unknown): value is SemanticCollection {
  return record(value) && typeof value.key === "string" && typeof value.totalChanges === "number"
    && record(value.sourceVersion) && typeof value.sourceVersion.version === "string"
    && record(value.targetVersion) && typeof value.targetVersion.version === "string" && record(value.rootTreeItem)
    && record(value.rootTreeItem.data) && Array.isArray(value.rootTreeItem.childItems)
    && record(value.treeItemsByPath) && record(value.changesByPath);
}

export function walkNodes(roots: NativeNode[], visit: (node: NativeNode) => void): void {
  let count = 0;
  const seen = new Set<NativeNode>();
  const walk = (nodes: NativeNode[], depth: number): void => {
    if (depth > 100) throw new Error("Native tree nesting exceeds the supported semantic projection depth.");
    for (const node of nodes) {
      if (++count > 100000 || seen.has(node) || !record(node) || !record(node.data)
        || typeof node.data.path !== "string" || typeof node.data.isFolder !== "boolean"
        || (node.childItems !== undefined && !Array.isArray(node.childItems))) {
        throw new Error("The native tree hierarchy is incompatible with semantic grouping.");
      }
      seen.add(node);
      visit(node);
      if (node.childItems) walk(node.childItems, depth + 1);
    }
  };
  walk(roots, 0);
}

export function nativeFiles(roots: NativeNode[]): NativeNode[] {
  const files: NativeNode[] = [];
  walkNodes(roots, (node) => { if (!node.data.isFolder && !node.data.thread) files.push(node); });
  return files;
}

export function projectNodes(roots: NativeNode[], paths: ReadonlySet<string>): NativeNode[] {
  walkNodes(roots, () => {});
  const project = (node: NativeNode, insideFile = false): NativeNode | null => {
    const file = !node.data.isFolder && !node.data.thread;
    if (!insideFile && file && !paths.has(node.data.path)) return null;
    const children = node.childItems?.map((child) => project(child, insideFile || file)).filter((child) => child !== null);
    if (!insideFile && !file && !children?.length) return null;
    return { ...node, ...(children ? { childItems: children } : {}) };
  };
  return roots.map((node) => project(node)).filter((node) => node !== null);
}

export function scopeCollection(collection: SemanticCollection, paths: ReadonlySet<string>, key: string): SemanticCollection {
  const rootTreeItem: NativeNode = { ...collection.rootTreeItem, childItems: projectNodes(collection.rootTreeItem.childItems ?? [], paths) };
  const treeItemsByPath: Record<string, NativeNode> = Object.create(null);
  const changesByPath: Record<string, NativeData> = Object.create(null);
  walkNodes([rootTreeItem], (node) => {
    if (node.data.thread) return;
    treeItemsByPath[node.data.path] = node;
    if (!node.data.isFolder) changesByPath[node.data.path] = node.data;
  });
  return { ...collection, key: `${collection.key}:adopp:${key}`, rootTreeItem, treeItemsByPath, changesByPath,
    totalChanges: Object.keys(changesByPath).length };
}

export function groupPaths(group: TreeGroup): ReadonlySet<string> {
  return new Set(group.paths);
}
