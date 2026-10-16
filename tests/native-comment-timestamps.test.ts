// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequest/7"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeCommentTimestamps, readNativeCommentDates } from "../src/native-discussions/timestamps";
import { DISCUSSION_CHANNEL } from "../src/native-discussions/protocol";

const publishedDate = "2026-10-16T12:00:00Z";
const lastContentUpdatedDate = "2026-10-16T12:18:00Z";
const session = "16748ae6-f0a9-4dad-ac76-88e2bafc32c1";

function mount(comment: Record<string, unknown> = {}) {
  const viewer = document.createElement("div");
  viewer.className = "repos-comment-viewer";
  viewer.id = String(Date.parse(publishedDate) / 1000);
  viewer.innerHTML = `<div class="repos-discussion-comment-header"><span><time class="body-s secondary-text" datetime="${lastContentUpdatedDate}">2 min ago</time></span><button>Edit</button></div>`;
  const header = viewer.querySelector<HTMLElement>(".repos-discussion-comment-header")!;
  const originalComment = { commentType: 1, publishedDate: new Date(publishedDate), lastContentUpdatedDate: new Date(lastContentUpdatedDate), ...comment };
  Reflect.set(header, "__reactFiber$fixture", { return: { memoizedProps: { comment: { originalComment } } } });
  document.body.append(viewer);
  return { viewer, header, originalComment, time: header.querySelector("time")! };
}

describe("native comment timestamps", () => {
  let surface: NativeCommentTimestamps;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    vi.setSystemTime(new Date("2026-10-16T12:20:00Z"));
    surface = new NativeCommentTimestamps();
  });

  afterEach(() => {
    surface.stop();
    window.dispatchEvent(new MessageEvent("message", {
      source: window, origin: location.origin, data: { channel: DISCUSSION_CHANNEL, kind: "dispose", session }
    }));
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reads authoritative native Date models without treating general updates as edits", () => {
    const { header, originalComment } = mount({ lastContentUpdatedDate: undefined, lastUpdatedDate: new Date(lastContentUpdatedDate) });
    expect(readNativeCommentDates(header)).toEqual({ publishedDate: new Date(publishedDate).toISOString() });
    originalComment.lastContentUpdatedDate = new Date(lastContentUpdatedDate);
    expect(readNativeCommentDates(header)).toEqual({
      publishedDate: new Date(publishedDate).toISOString(), lastContentUpdatedDate: new Date(lastContentUpdatedDate).toISOString()
    });
  });

  it("preserves native nodes and anchors, refreshes ages, and restores on disable", () => {
    const { header, viewer, time } = mount();
    surface.update(true);
    const created = header.querySelector("[data-adopp-comment-timestamps] time");
    surface.update(true);
    expect(header.querySelector("[data-adopp-comment-timestamps] time")).toBe(created);
    expect(header.querySelectorAll("[data-adopp-original-comment-time]")).toHaveLength(1);
    expect(header.querySelectorAll("[data-adopp-comment-timestamps] time")).toHaveLength(2);
    expect(created!.textContent).toBe("20 min ago");
    expect(header.textContent).toContain("Edited 2 min ago");
    expect(header.querySelector("time")).toBe(time);
    expect(time.dateTime).toBe(lastContentUpdatedDate);
    expect(viewer.id).toBe(String(Date.parse(publishedDate) / 1000));
    vi.advanceTimersByTime(60000);
    expect(header.textContent).toContain("Edited 3 min ago");
    surface.update(false);
    expect(header.querySelector("[data-adopp-comment-timestamps]")).toBeNull();
    expect(time.parentElement!.hasAttribute("data-adopp-original-comment-time")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ commentType: 3 }, { commentType: "system" }, { isDeleted: true }, { publishedDate: "invalid" }, { publishedDate: new Date(NaN) }])(
    "leaves unsupported, system, deleted and malformed comments untouched: %j", (comment) => {
      const { header, time } = mount(comment);
      surface.update(true);
      expect(header.querySelector("[data-adopp-comment-timestamps]")).toBeNull();
      expect(time.parentElement!.hasAttribute("data-adopp-original-comment-time")).toBe(false);
    }
  );

  it("does not augment private drafts or guess metadata from displayed times", () => {
    const draft = mount();
    draft.viewer.dataset.adoppNativeDraft = "draft";
    const missing = mount();
    Reflect.deleteProperty(missing.header, "__reactFiber$fixture");
    surface.update(true);
    expect(document.querySelector("[data-adopp-comment-timestamps]")).toBeNull();
  });

  it("handles content edits, removed headers and React timestamp replacement", () => {
    const first = mount({ lastContentUpdatedDate: new Date(publishedDate) });
    surface.update(true);
    expect(first.header.textContent).not.toContain("Edited ");
    first.originalComment.lastContentUpdatedDate = new Date(lastContentUpdatedDate);
    surface.update(true);
    expect(first.header.textContent).toContain("Edited 2 min ago");
    first.time.parentElement!.outerHTML = `<span><time datetime="${lastContentUpdatedDate}">native refreshed time</time></span>`;
    surface.update(true);
    expect(first.header.querySelectorAll("[data-adopp-comment-timestamps] time")).toHaveLength(2);
    first.viewer.remove();
    surface.update(true);
    expect(first.header.querySelector("[data-adopp-comment-timestamps]")).toBeNull();
    const second = mount();
    surface.update(true);
    expect(second.header.querySelector("[data-adopp-comment-timestamps] time")!.textContent).toBe("20 min ago");
  });

  it("bounds native model traversal and handles cyclic host fibers", () => {
    const { header } = mount();
    const fiber: { return?: unknown } = {};
    fiber.return = fiber;
    Reflect.set(header, "__reactFiber$fixture", fiber);
    expect(readNativeCommentDates(header)).toBeNull();
  });

  it("enables posted timestamps independently of drafts and cleans up on PR changes and dispose", async () => {
    const { header, originalComment, time } = mount();
    await import("../src/native-discussions/main");
    const configure = () => window.dispatchEvent(new MessageEvent("message", {
      source: window, origin: location.origin,
      data: { channel: DISCUSSION_CHANNEL, kind: "configure", session,
        page: location.origin + "/org/project/_git/repo/pullrequest/7",
        reviewer: { id: "me", displayName: "Me" }, drafts: [], enabled: false, commentTimestamps: true }
    }));
    configure();
    expect(header.querySelector("[data-adopp-comment-timestamps] time")!.textContent).toBe("20 min ago");
    expect(document.querySelector("[data-adopp-add-review]")).toBeNull();
    originalComment.lastContentUpdatedDate = new Date("2026-10-16T12:19:00Z");
    time.firstChild!.nodeValue = "native time updated";
    await vi.advanceTimersByTimeAsync(100);
    expect(header.textContent).toContain("Edited 1 min ago");
    history.replaceState({}, "", "/org/project/_git/repo/pullrequest/8");
    configure();
    expect(header.querySelector("[data-adopp-comment-timestamps]")).toBeNull();
    history.replaceState({}, "", "/org/project/_git/repo/pullrequest/7");
    configure();
    expect(header.textContent).toContain("Edited 1 min ago");
    window.dispatchEvent(new MessageEvent("message", {
      source: window, origin: location.origin, data: { channel: DISCUSSION_CHANNEL, kind: "dispose", session }
    }));
    expect(header.querySelector("[data-adopp-comment-timestamps]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
