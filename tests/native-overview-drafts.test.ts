// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequest/7"}

import * as React from "react";
import * as ReactDOM from "react-dom";
import { afterEach, expect, it, vi } from "vitest";
import { OverviewDraftSurface, replaceDiscussion } from "../src/native-discussions/overview";
import type { DiscussionConfiguration } from "../src/native-discussions/protocol";
import type { HostReact } from "../src/native-tree/host";
import { DISCUSSION_CHANNEL } from "../src/native-discussions/protocol";

type Draft = DiscussionConfiguration["drafts"][number];
const surfaces: OverviewDraftSurface[] = [];
const draft: Draft = {
  id: "410c4c8d-0a49-4f77-8860-835413994294", kind: "inline", source: "manual",
  body: "Private inline feedback", path: "/src/file.ts", line: 45, side: "right", trackingId: 17,
  createdAt: "2026-10-16T10:00:00Z", updatedAt: "2026-10-16T10:00:00Z", delivery: "pending"
};

function mountActivity(withNativeFile = true) {
  document.body.innerHTML = '<div class="comment-file-header"></div><table class="activity-feed-list"><tbody></tbody></table>';
  const root = document.querySelector("tbody")!;
  const composer = { isAddCommentRow: true };
  const native = { itemModel: { id: 42 } };
  const provider = {
    internalItems: [composer, native] as unknown[],
    splice: vi.fn((index: number, count: number, ...items: unknown[]) => {
      provider.internalItems.splice(index, count, ...items);
    })
  };
  const renderItem = vi.fn((_index: number, item: unknown, _details: unknown) => [
    null, item === composer ? React.createElement("input", { placeholder: "Add a comment" })
      : React.createElement("span", null, "Native activity")
  ]);
  const timeline = { renderItem };
  const list = { props: { renderRow: vi.fn() }, forceUpdate: vi.fn() };
  const owner = {
    renderItem,
    renderActivity: () => undefined,
    forceUpdate: vi.fn(() => {
      timeline.renderItem = owner.renderItem;
      // A native parent rerender replaces renderRow, but keeps using its activity renderer.
      list.props.renderRow = vi.fn();
      ReactDOM.render(React.createElement(React.Fragment, null, ...provider.internalItems.map((item, index) =>
        React.createElement("tr", { key: index, className: "bolt-timeline-row" }, React.createElement("td", null, timeline.renderItem(index, item, {})))
      )), root);
    })
  };
  Reflect.set(document.querySelector(".activity-feed-list")!, "__reactFiber$test", {
    stateNode: list, memoizedProps: { itemProvider: provider },
    return: { memoizedProps: timeline, return: { stateNode: owner } }
  });
  const serverAction = vi.fn();
  const received: Record<string, unknown>[] = [];
  const fetchDiff = vi.fn(async () => undefined);
  class NativeFileActivity extends React.Component<Record<string, unknown>> {
    prDetailsService = { getLatestIterationId: () => 8 };
    fetchedDiff = { value: false };
    fetchDiff = fetchDiff;

    render() {
      received.push(this.props);
      return React.createElement("div", { className: "native-file-card" },
        React.createElement("a", { className: "comment-file-header-link", href: "?discussionId=42" }, "file.ts"),
        React.createElement("div", { className: "native-code-preview" }, "Native code context"),
        React.createElement(({ children }: { children: () => React.ReactElement }) => children(), null,
          () => React.createElement("button", { thread: this.props.threadModel, onClick: serverAction }, "Post native reply")));
    }
  }
  const mountNativeFile = () => {
    const props = { threadModel: {}, isShimObservable: { value: false } };
    Reflect.set(document.querySelector(".comment-file-header")!, "__reactFiber$test", {
      memoizedProps: props, type: NativeFileActivity, stateNode: new NativeFileActivity(props)
    });
  };
  if (withNativeFile) mountNativeFile();
  const require = Object.assign(() => React, { defined: () => true });
  vi.stubGlobal("require", require);
  const surface = new OverviewDraftSurface();
  surfaces.push(surface);
  const createCard = vi.fn((item: Draft) => {
    const card = document.createElement("div");
    card.textContent = item.body;
    return card;
  });
  return { surface, createCard, owner, provider, composer, native, renderItem, serverAction, received, fetchDiff, mountNativeFile };
}

afterEach(() => {
  for (const surface of surfaces.splice(0)) surface.clear();
  const root = document.querySelector("tbody");
  if (root) ReactDOM.unmountComponentAtNode(root);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("adds local draft models to the native provider and renders native code context without server controls", () => {
  const host = mountActivity();
  expect(host.surface.render([draft], host.createCard)).toBe(true);
  expect(host.provider.internalItems[0]).toBe(host.composer);
  expect(host.provider.internalItems[2]).toBe(host.native);
  expect(host.provider.internalItems[1]).toMatchObject({ itemModel: { id: `adopp-draft-${draft.id}` } });
  const card = document.querySelector("[data-adopp-overview-inline]")!;
  expect(card.textContent).toContain(draft.body);
  expect(card.querySelector(".native-code-preview")?.textContent).toBe("Native code context");
  expect(card.querySelector("button")).toBeNull();
  expect(host.serverAction).not.toHaveBeenCalled();
  expect(host.received[0]?.thread).toMatchObject({
    threadContext: { filePath: draft.path, rightFileStart: { line: 45, offset: 1 }, rightFileEnd: { line: 45, offset: 1 } },
    pullRequestThreadContext: { changeTrackingId: 17, iterationContext: { firstComparingIteration: 8 } }
  });
  const href = new URL(card.querySelector<HTMLAnchorElement>("a")!.href);
  expect(href.searchParams.get("discussionId")).toBeNull();
  expect(href.searchParams.get("path")).toBe(draft.path);
  expect(href.searchParams.get("line")).toBe("45");
});

it("preserves native rows, in-progress local editing, and its hook across parent rerenders", () => {
  const host = mountActivity();
  host.surface.render([draft], host.createCard);
  const renders = host.owner.forceUpdate.mock.calls.length;
  host.surface.render([draft], host.createCard);
  expect(host.owner.forceUpdate).toHaveBeenCalledTimes(renders);
  const card = document.querySelector("[data-adopp-overview-inline]")!;
  const input = document.createElement("textarea");
  input.value = "Unsaved changes";
  card.querySelector(".adopp-overview-draft-comment")!.firstElementChild!.append(input);
  const owned = host.provider.internalItems[1];
  host.owner.forceUpdate();
  expect(document.querySelector("textarea")?.value).toBe("Unsaved changes");
  host.surface.render([draft], host.createCard);
  expect(host.provider.internalItems[1]).toBe(owned);
  expect(host.createCard).toHaveBeenCalledOnce();
  expect(document.querySelector("textarea")?.value).toBe("Unsaved changes");
  host.surface.clear();
  expect(host.owner.renderItem).toBe(host.renderItem);
  expect(host.provider.internalItems).toEqual([host.composer, host.native]);
  expect(document.querySelector("[data-adopp-overview-inline]")).toBeNull();
});

it("projects left-side anchors, updates/removes models, and reinserts drafts after native filtering", () => {
  const host = mountActivity();
  const left = { ...draft, side: "left" as const, line: 50 };
  host.surface.render([left], host.createCard);
  expect(host.received[0]?.thread).toMatchObject({ threadContext: { leftFileStart: { line: 50 } } });
  const owned = host.provider.internalItems[1];
  host.provider.internalItems = [host.composer, host.native];
  host.surface.render([left], host.createCard);
  expect(host.provider.internalItems[1]).toBe(owned);
  host.surface.render([{ ...left, body: "Updated feedback", updatedAt: "2026-10-16T11:00:00Z" }], host.createCard);
  expect(document.querySelector("[data-adopp-overview-inline]")?.textContent).toContain("Updated feedback");
  host.surface.render([], host.createCard);
  expect(host.provider.internalItems).toEqual([host.composer, host.native]);
});

it("keeps drafts visible with an explicit limitation when no native file renderer is mounted", () => {
  const host = mountActivity(false);
  expect(host.surface.render([draft], host.createCard)).toBe(true);
  const card = document.querySelector("[data-adopp-overview-inline]")!;
  expect(card.textContent).toContain(draft.body);
  expect(card.querySelector("[role='status']")?.textContent).toContain("Native code preview unavailable");
  const owned = host.provider.internalItems[1];
  host.mountNativeFile();
  host.surface.render([draft], host.createCard);
  expect(host.provider.internalItems[1]).toBe(owned);
  expect(document.querySelector("[data-adopp-overview-inline] .native-code-preview")).not.toBeNull();
});

it("integrates mixed draft ordering and disposes through the native provider", async () => {
  const host = mountActivity();
  host.owner.forceUpdate();
  await import("../src/native-discussions/main");
  const session = "fa1dd754-cad3-4cab-b4a2-fc7fc6f57413";
  const send = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, source: window, origin: location.origin }));
  send({
    channel: DISCUSSION_CHANNEL, kind: "configure", session, page: location.origin + location.pathname,
    reviewer: { id: "reviewer", displayName: "Reviewer" }, enabled: true,
    drafts: [
      draft,
      { ...draft, id: "43b329f4-e7fc-46ab-b449-359832980c8f", kind: "general", body: "New general", updatedAt: "2026-10-16T11:00:00Z" },
      { ...draft, id: "1482d4f9-a46d-4632-90f9-1de19371e75d", kind: "general", body: "Old general", updatedAt: "2026-10-16T09:00:00Z" }
    ]
  });
  expect([...document.querySelectorAll(".adopp-draft-body")].map((element) => element.textContent)).toEqual([
    "New general", draft.body, "Old general"
  ]);
  send({ channel: DISCUSSION_CHANNEL, kind: "dispose", session });
  expect(host.provider.internalItems).toEqual([host.composer, host.native]);
  expect(document.querySelector("[data-adopp-native-draft]")).toBeNull();
});

it("only replaces the owned discussion, including deferred observer children", () => {
  const owned = {};
  const native = {};
  const react: HostReact = React;
  const tree = React.createElement("div", null,
    React.createElement("section", { thread: native }, "Real comment"),
    React.createElement("section", null, () => React.createElement("section", { thread: owned }, "Server controls")));
  const result = replaceDiscussion(react, tree, owned, () => "Local draft");
  expect(react.isValidElement(result)).toBe(true);
  if (!react.isValidElement(result)) throw new Error("Expected a React element");
  const children = result.props.children as React.ReactElement[];
  expect(children[0]?.props.thread).toBe(native);
  expect(children[0]?.props.children).toBe("Real comment");
  expect(children[1]?.props.children()).toBe("Local draft");
});
