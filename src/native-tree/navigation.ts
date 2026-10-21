import { z } from "zod";
import { record } from "./protocol";

export const NAVIGATION_CHANNEL = "adopp-native-file-navigation-v1";

export const navigationRequestSchema = z.object({
  channel: z.literal(NAVIGATION_CHANNEL),
  kind: z.literal("navigate"),
  id: z.string().uuid(),
  page: z.string().url().max(8192),
  path: z.string().startsWith("/").max(8192)
}).strict();

export const navigationResultSchema = z.object({
  channel: z.literal(NAVIGATION_CHANNEL),
  kind: z.literal("result"),
  id: z.string().uuid(),
  error: z.string().max(1000).optional()
}).strict();

export function selectNativeFile(path: string, documentRef: Document): void {
  const element = documentRef.querySelector(".repos-file-explorer-tree");
  if (!element) throw new Error("Azure DevOps' native file tree is not available.");
  const key = Object.getOwnPropertyNames(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber: unknown = key ? Reflect.get(element, key) : null;
  const visited = new Set<unknown>();
  for (let depth = 0; record(fiber) && depth < 80 && !visited.has(fiber); depth++) {
    visited.add(fiber);
    const props = fiber.memoizedProps;
    const context = record(props) && record(props.value) ? props.value : null;
    const navigation = context?.navigationService;
    if (record(navigation) && typeof navigation.setSelectedItem === "function"
      && record(navigation.changes) && record(navigation.changes.value)
      && record(navigation.changes.value.changesByPath)) {
      const items = navigation.changes.value.changesByPath;
      const item: unknown = Object.hasOwn(items, path) ? items[path] : null;
      if (!record(item) || item.path !== path || item.isFolder !== false) {
        throw new Error("This file is not available in the current Azure DevOps comparison. Check the comparison and file filters.");
      }
      navigation.setSelectedItem(item);
      return;
    }
    fiber = fiber.return;
  }
  throw new Error("Azure DevOps' native file navigation is unavailable. Open the file from the Files tab.");
}

export function startNativeFileNavigation(scope: Window): void {
  scope.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== scope || event.origin !== scope.location.origin) return;
    const parsed = navigationRequestSchema.safeParse(event.data);
    if (!parsed.success) return;
    const request = parsed.data;
    if (request.page !== scope.location.origin + scope.location.pathname || !/\/pullrequest\/\d+$/i.test(scope.location.pathname)) return;
    let error: string | undefined;
    try {
      selectNativeFile(request.path, scope.document);
    } catch (cause) {
      error = (cause instanceof Error ? cause.message : "Azure DevOps file navigation failed.").slice(0, 1000);
    }
    scope.postMessage({ channel: NAVIGATION_CHANNEL, kind: "result", id: request.id, ...(error ? { error } : {}) }, scope.location.origin);
  });
}
