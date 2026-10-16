import { getHostReact, type HostReact } from "../native-tree/host";
import type { DiscussionConfiguration } from "./protocol";

type Draft = DiscussionConfiguration["drafts"][number];

export interface NativeItemProvider {
  internalItems: unknown[];
  splice(index: number, deleteCount: number, ...items: unknown[]): void;
}

export interface NativeList {
  props: { renderRow(index: number, item: unknown, details: unknown): unknown };
  forceUpdate(): void;
}

interface ActivityHost {
  list: NativeList;
  provider: NativeItemProvider;
  timeline: { renderItem(index: number, item: unknown, details: unknown): unknown };
  owner: { renderItem(index: number, item: unknown, details: unknown): unknown; forceUpdate(): void };
}

interface FileActivityInstance {
  render(): unknown;
}

interface FileActivityConstructor {
  new (...args: unknown[]): FileActivityInstance;
}

interface FileActivityContract {
  component: FileActivityConstructor;
  props: Record<string, unknown>;
  iteration: number;
}

interface DraftItem {
  draft: Draft;
  itemModel: { id: string };
  content: HTMLElement;
  ref: (element: HTMLElement | null) => void;
  activity: FileActivityConstructor | null;
  activityProps: Record<string, unknown> | null;
}

export class OverviewDraftSurface {
  private host: ActivityHost | null = null;
  private originalRenderItem: ActivityHost["owner"]["renderItem"] | null = null;
  private renderItem: ActivityHost["owner"]["renderItem"] | null = null;
  private readonly items = new Map<string, DraftItem>();
  private react: HostReact | null = null;
  private fileActivity: FileActivityContract | null = null;

  render(drafts: Draft[], createCard: (draft: Draft) => HTMLElement): boolean {
    const host = discoverActivityHost();
    const react = getHostReact(window);
    if (!drafts.length || !host || !react) {
      this.clear();
      return !drafts.length;
    }
    let changed = false;
    if (this.host?.list !== host.list || this.host.provider !== host.provider) {
      this.clear();
      this.host = host;
      this.react = react;
      this.originalRenderItem = host.owner.renderItem;
      const original = this.originalRenderItem;
      this.renderItem = (index, item, details) => {
        const owned = [...this.items.values()].find((candidate) => candidate === item);
        return owned ? this.renderDraft(index, owned) : original(index, item, details);
      };
      host.owner.renderItem = this.renderItem;
      host.timeline.renderItem = this.renderItem;
      changed = true;
    }
    const activity = discoverFileActivity();
    const activityChanged = !!activity && (activity.component !== this.fileActivity?.component
      || activity.iteration !== this.fileActivity?.iteration);
    if (activity) this.fileActivity = activity;
    const retained = new Set(drafts.map((draft) => draft.id));
    for (const [id, item] of this.items) {
      if (!retained.has(id)) {
        this.removeItem(item);
        this.items.delete(id);
        changed = true;
      }
    }
    for (const draft of drafts) {
      let item = this.items.get(draft.id);
      if (item && JSON.stringify(item.draft) === JSON.stringify(draft) && !activityChanged) continue;
      const content = createCard(draft);
      if (item) {
        item.content.replaceWith(content);
        item.content = content;
        item.draft = draft;
      } else {
        const next: DraftItem = {
          draft,
          itemModel: { id: `adopp-draft-${draft.id}` },
          content,
          ref: (element) => { if (element && !element.contains(next.content)) element.replaceChildren(next.content); },
          activity: null,
          activityProps: null
        };
        item = next;
        this.items.set(draft.id, item);
      }
      item.activity = this.fileActivity ? this.createFileActivity(item, this.fileActivity) : null;
      changed = true;
    }
    const ownedItems = new Set<unknown>(this.items.values());
    const nativeItems = host.provider.internalItems.filter((item) => !ownedItems.has(item));
    const composerIndex = nativeItems.findIndex((item) => record(item) && item.isAddCommentRow === true);
    const desired = [...nativeItems];
    desired.splice(composerIndex >= 0 ? composerIndex + 1 : 0, 0, ...drafts.map((draft) => this.items.get(draft.id)!));
    if (!sameItems(host.provider.internalItems, desired)) {
      host.provider.splice(0, host.provider.internalItems.length, ...desired);
      changed = true;
    }
    if (changed) host.owner.forceUpdate();
    return true;
  }

  clear(): void {
    const host = this.host;
    for (const item of this.items.values()) this.removeItem(item);
    this.items.clear();
    if (host && this.originalRenderItem) {
      if (host.owner.renderItem === this.renderItem) host.owner.renderItem = this.originalRenderItem;
      if (host.timeline.renderItem === this.renderItem) host.timeline.renderItem = this.originalRenderItem;
    }
    this.host = null;
    this.originalRenderItem = null;
    this.renderItem = null;
    this.fileActivity = null;
    this.react = null;
    host?.owner.forceUpdate();
  }

  private removeItem(item: DraftItem): void {
    const index = this.host?.provider.internalItems.indexOf(item) ?? -1;
    if (index >= 0) this.host!.provider.splice(index, 1);
  }

  private renderDraft(_index: number, item: DraftItem): unknown {
    const h = this.react!.createElement.bind(this.react);
    const content = item.activity
      ? Reflect.apply(h, this.react, [item.activity, { ...item.activityProps, key: item.draft.updatedAt }])
      : this.fallbackActivity(item);
    return [
      h("div", { className: "activity-feed-sequence bolt-timeline-sequence flex-column flex-center flex-noshrink" },
        h("div", { className: "bolt-timeline-icon-prefix" }),
        h("span", { className: "activity-feed-timeline-icon margin-vertical-4 secondary-text fabric-icon ms-Icon--Chat", "aria-hidden": "true" }),
        h("div", { className: "bolt-timeline-icon-suffix flex-grow" })),
      h("div", { className: "flex-grow scroll-hidden",
        "data-adopp-native-draft": item.draft.id, "data-adopp-overview-inline": "true" },
        h("div", { className: "flex-row flex-grow padding-bottom-16 scroll-hidden padding-left-8 padding-right-4" }, content))
    ];
  }

  private createFileActivity(item: DraftItem, contract: FileActivityContract): FileActivityConstructor {
    const react = this.react!;
    const model = item.itemModel;
    const draft = item.draft;
    const point = { line: draft.line, offset: 1 };
    const thread = {
      id: model.id,
      publishedDate: new Date(draft.createdAt),
      lastUpdatedDate: new Date(draft.updatedAt),
      comments: [],
      threadContext: {
        filePath: draft.path,
        ...(draft.side === "left"
          ? { leftFileStart: point, leftFileEnd: point }
          : { rightFileStart: point, rightFileEnd: point })
      },
      pullRequestThreadContext: {
        changeTrackingId: draft.trackingId,
        iterationContext: { firstComparingIteration: contract.iteration, secondComparingIteration: contract.iteration }
      }
    };
    const props = { thread, threadModel: model, isShimObservable: contract.props.isShimObservable };
    item.activityProps = props;
    const Base = contract.component;
    return class extends Base {
      render(): unknown {
        // Only reuse native file context; never mount its server-backed discussion controls.
        return replaceDiscussion(react, super.render(), model, () =>
          react.createElement("div", { className: "adopp-overview-draft-comment", ref: item.ref }), draftFileUrl(draft));
      }
    };
  }

  private fallbackActivity(item: DraftItem): unknown {
    const h = this.react!.createElement.bind(this.react);
    const draft = item.draft;
    return h("div", { className: "bolt-card bolt-card-white flex-column flex-grow no-padding" },
      h("div", { className: "comment-file-header flex-column" },
        h("div", { className: "comment-file-header-title flex-row" },
          h("div", { className: "flex-column flex-start flex-grow scroll-hidden" },
            h("a", { className: "comment-file-header-link body-m font-weight-semibold text-ellipsis", href: draftFileUrl(draft) },
              `${draft.path?.split("/").pop() ?? "File"}:${draft.line}`),
            h("span", { className: "body-s secondary-text text-ellipsis" }, draft.path))),
        h("div", { className: "body-s secondary-text", role: "status" }, "Native code preview unavailable. Open the file to view this draft in context.")),
      h("div", { ref: item.ref }));
  }
}

export function discoverActivityList(): { list: NativeList; provider: NativeItemProvider } | null {
  const feed = document.querySelector(".activity-feed-list");
  for (const fiber of fibers(feed)) {
    const props = fiber.memoizedProps;
    const list = fiber.stateNode;
    if (record(props) && isItemProvider(props.itemProvider) && isNativeList(list)) {
      return { list, provider: props.itemProvider };
    }

  }
  return null;
}

function discoverActivityHost(): ActivityHost | null {
  const list = discoverActivityList();
  if (!list) return null;
  let timeline: ActivityHost["timeline"] | null = null;
  for (const fiber of fibers(document.querySelector(".activity-feed-list"))) {
    const props = fiber.memoizedProps;
    const instance = fiber.stateNode;
    if (hasRenderItem(props)) timeline = props;
    if (timeline && isActivityOwner(instance)) {
      return { ...list, timeline, owner: instance };
    }
  }
  return null;
}

function discoverFileActivity(): FileActivityContract | null {
  for (const header of document.querySelectorAll(".comment-file-header")) {
    if (header.closest("[data-adopp-overview-inline]")) continue;
    for (const fiber of fibers(header)) {
      const props = fiber.memoizedProps;
      const instance = fiber.stateNode;
      if (!record(props) || !record(props.threadModel) || !record(instance) || !isFileActivityConstructor(fiber.type)
        || typeof instance.fetchDiff !== "function" || typeof instance.render !== "function") continue;
      const service = instance.prDetailsService;
      if (!record(service) || typeof service.getLatestIterationId !== "function") continue;
      const iteration: unknown = service.getLatestIterationId();
      if (typeof iteration === "number") {
        return { component: fiber.type, props, iteration };
      }
    }
  }
  return null;
}

export function replaceDiscussion(
  react: HostReact, node: unknown, model: object, renderDraft: () => unknown, fileUrl?: string
): unknown {
  if (Array.isArray(node)) return node.map((child) => replaceDiscussion(react, child, model, renderDraft, fileUrl));
  if (!react.isValidElement(node)) return node;
  if (node.props.thread === model) return renderDraft();
  const props = fileUrl && typeof node.props.className === "string"
    && node.props.className.split(/\s+/).includes("comment-file-header-link") ? { href: fileUrl } : {};
  const children = node.props.children;
  if (children === undefined) return Object.keys(props).length ? react.cloneElement(node, props) : node;
  const next = typeof children === "function"
    ? (...args: unknown[]) => replaceDiscussion(react, Reflect.apply(children, undefined, args), model, renderDraft, fileUrl)
    : replaceDiscussion(react, children, model, renderDraft, fileUrl);
  return react.cloneElement(node, props, next);
}

function draftFileUrl(draft: Draft): string {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("_a", "files");
  url.searchParams.set("path", draft.path ?? "");
  url.searchParams.set("line", String(draft.line ?? 1));
  url.searchParams.set("lineEnd", String((draft.line ?? 1) + 1));
  url.searchParams.set("lineStartColumn", "1");
  url.searchParams.set("lineEndColumn", "1");
  url.searchParams.set("lineStyle", "plain");
  return url.href;
}

function* fibers(element: Element | null): Generator<Record<string, unknown>> {
  const key = element && Object.getOwnPropertyNames(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber: unknown = key ? Reflect.get(element, key) : null;
  const seen = new Set<unknown>();
  for (let depth = 0; record(fiber) && depth < 60 && !seen.has(fiber); depth++) {
    seen.add(fiber);
    yield fiber;
    fiber = fiber.return;
  }
}

function sameItems(left: unknown[], right: unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isItemProvider(value: unknown): value is NativeItemProvider {
  return record(value) && Array.isArray(value.internalItems) && typeof value.splice === "function";
}

function isNativeList(value: unknown): value is NativeList {
  return record(value) && record(value.props) && typeof value.props.renderRow === "function"
    && typeof value.forceUpdate === "function";
}

function hasRenderItem(value: unknown): value is ActivityHost["timeline"] {
  return record(value) && typeof value.renderItem === "function";
}

function isActivityOwner(value: unknown): value is ActivityHost["owner"] {
  return record(value) && typeof value.renderActivity === "function" && typeof value.forceUpdate === "function" && hasRenderItem(value);
}

function isFileActivityConstructor(value: unknown): value is FileActivityConstructor {
  return typeof value === "function" && record(value.prototype) && typeof value.prototype.render === "function";
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
