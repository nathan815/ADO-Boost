// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequest/7"}

import { afterEach, describe, expect, it, vi } from "vitest";
import { AdoApi } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import { DraftQueue } from "../src/core/drafts";
import type { PullRequestAnalysis, PullRequestThread } from "../src/core/types";
import type { WriteGateway } from "../src/core/write-gateway";
import { defaultSettings } from "../src/features/registry";
import { DiscussionController } from "../src/ui/discussion-controller";
import { PanelToast } from "../src/ui/panel-toast";

const analysis: PullRequestAnalysis = {
  context: {
    origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
    repositoryId: "repo-id", pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target",
    mergeBaseCommit: "base", iterationId: 3, identity: "identity", reviewer: { id: "me", displayName: "Me" }
  },
  files: [], groups: [], threads: { state: "available", active: 2, resolved: 0, total: 2 }, completedTrackingIds: new Set()
};
const threads: PullRequestThread[] = [
  { id: 1, status: "active", publishedDate: "2026-10-14T12:00:00Z", comments: [
    { id: 1, content: "**Initial**", author: "Alice", isDeleted: false, publishedDate: "2026-10-14T12:00:00Z" },
    { id: 2, content: "A reply", author: "Bob", isDeleted: false, publishedDate: "2026-10-14T13:00:00Z" },
    { id: 3, content: "Deleted", author: "Bob", isDeleted: true }
  ] },
  { id: 2, status: "fixed", publishedDate: "2026-10-15T12:00:00Z", comments: [
    { id: 1, content: "New thread", author: "Alice", isDeleted: false, publishedDate: "2026-10-15T12:00:00Z" }
  ] }
];

const toasts: PanelToast[] = [];

afterEach(() => {
  for (const toast of toasts.splice(0)) toast.destroy();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/org/project/_git/repo/pullrequest/7");
});

async function mount(store = new MemoryBrowserStore(), discussionThreads = threads) {
  const settings = defaultSettings();
  const fetch = vi.fn(async () => new Response(JSON.stringify({ value: discussionThreads.map((thread) => ({
    ...thread,
    ...(thread.path ? { threadContext: { filePath: thread.path, rightFileStart: { line: thread.line ?? 1, offset: 1 } } } : {}),
    comments: thread.comments.map((comment) => ({ ...comment, commentType: comment.isVoteUpdate ? "system" : "text", author: { id: comment.author, displayName: comment.author, imageUrl: comment.authorImageUrl } }))
  })) }), { status: 200 }));
  const writes: WriteGateway = {
    postAnnouncement: vi.fn(), submitReview: vi.fn(), retryDecision: vi.fn(), setThreadStatus: vi.fn()
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  const toast = new PanelToast(root);
  toasts.push(toast);
  const render = () => { root.innerHTML = controller.markup(); controller.bind(root); toast.mount(); };
  const controller = new DiscussionController(new AdoApi({ fetch }), store, analysis, writes, () => settings, render, toast);
  await controller.load();
  return { root, store, settings, writes, render, controller, queue: new DraftQueue(store, analysis.context) };
}

function click(root: ShadowRoot, selector: string) {
  root.querySelector<HTMLButtonElement>(selector)!.click();
}

function type(root: ShadowRoot, key: string, value: string) {
  const textarea = root.querySelector<HTMLTextAreaElement>(`[data-composer-key="${key}"] textarea`)!;
  textarea.value = value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Sidebar discussions", () => {
  it("places author photos, names, and times before the body and thread IDs in the footer", async () => {
    const imageUrl = "https://dev.azure.com/org/_apis/GraphProfile/MemberAvatars/alice";
    const { root } = await mount(new MemoryBrowserStore(), [{
      ...threads[1]!, comments: [{ ...threads[1]!.comments[0]!, authorImageUrl: imageUrl }]
    }]);
    const comment = root.querySelector<HTMLElement>(".thread-comment")!;
    const header = comment.querySelector(".comment-header")!;
    expect(comment.firstElementChild).toBe(header);
    expect(header.querySelector("strong")!.textContent).toBe("Alice");
    expect(header.querySelector("time")!.dateTime).toBe("2026-10-15T12:00:00Z");
    const avatar = header.querySelector("img")!;
    expect(avatar.src).toBe(imageUrl);
    expect(avatar.alt).toBe("");
    expect(comment.querySelector(".thread-content")!.textContent!.trim()).toBe("New thread");
    expect(root.querySelector(".thread-item")!.lastElementChild).toBe(root.querySelector(".thread-footer"));
    expect(root.querySelector(".thread-footer .thread-id")!.textContent).toBe("Thread 2");
    avatar.dispatchEvent(new Event("error"));
    expect(header.querySelector("img")).toBeNull();
    expect(header.querySelector(".comment-avatar")!.textContent).toBe("A");
  });

  it("jumps to the native comment without losing the inline draft", async () => {
    const native = document.createElement("div");
    native.className = "repos-discussion-comment";
    native.innerHTML = '<div class="repos-discussion-comment-header"><time datetime="2026-10-15T12:00:00Z"></time></div>';
    native.scrollIntoView = vi.fn();
    document.body.append(native);
    const { root } = await mount();
    click(root, ".add-general");
    type(root, "general", "Keep this draft");
    click(root, '[data-thread-id="2"] .jump-comment');
    await vi.waitFor(() => expect(document.activeElement).toBe(native));
    expect(native.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(root.querySelector<HTMLTextAreaElement>(".draft-body")!.value).toBe("Keep this draft");
  });

  it("shows a dismissible toast without rerendering the composer when a jump fails", async () => {
    const { root } = await mount();
    click(root, ".add-general");
    type(root, "general", "Keep my draft and cursor");
    const textarea = root.querySelector<HTMLTextAreaElement>(".draft-body")!;
    textarea.focus();
    textarea.setSelectionRange(4, 7);
    click(root, ".jump-comment");
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')!.textContent).toContain("Open the PR Overview tab"));
    expect(root.querySelector(".delivery.error")).toBeNull();
    expect(root.querySelector(".draft-body")).toBe(textarea);
    expect(textarea.value).toBe("Keep my draft and cursor");
    expect(textarea.selectionStart).toBe(4);
    expect(root.activeElement).toBe(textarea);
    expect(root.querySelector<HTMLButtonElement>(".jump-comment")!.disabled).toBe(false);
    root.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')!.click();
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it("clears the previous jump error when retrying successfully", async () => {
    const { root } = await mount();
    click(root, '[data-thread-id="2"] .jump-comment');
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).not.toBeNull());
    const native = document.createElement("div");
    native.className = "repos-discussion-comment";
    native.innerHTML = '<div class="repos-discussion-comment-header"><time datetime="2026-10-15T12:00:00Z"></time></div>';
    native.scrollIntoView = vi.fn();
    document.body.append(native);
    click(root, '[data-thread-id="2"] .jump-comment');
    expect(root.querySelector('[role="alert"]')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(native));
  });

  it("jumps anchored replies to the native file thread instead of their Overview copy", async () => {
    const thread = { ...threads[0]!, path: "/src/app.ts", line: 12 };
    const date = thread.comments[1]!.publishedDate!;
    const native = document.createElement("div");
    native.className = "repos-discussion-comment";
    native.innerHTML = `<div class="repos-discussion-comment-header"><time datetime="${date}"></time></div>`;
    native.scrollIntoView = vi.fn();
    const link = document.createElement("a");
    link.className = "comment-file-header-link";
    link.href = `?_a=files&path=${encodeURIComponent(thread.path)}&discussionId=${thread.id}`;
    let navigated = false;
    const inlineComment = native.cloneNode(true) as HTMLElement;
    inlineComment.scrollIntoView = vi.fn();
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigated = true;
      history.pushState({}, "", link.href);
      const host = document.createElement("div");
      host.className = "repos-editor-discussion-host";
      host.append(inlineComment);
      document.body.append(host);
    });
    document.body.append(native, link);
    const { root } = await mount(new MemoryBrowserStore(), [thread]);
    click(root, '[data-comment-id="2"] .jump-comment');
    expect(navigated).toBe(true);
    await vi.waitFor(() => expect(document.activeElement).toBe(inlineComment));
    expect(native.scrollIntoView).not.toHaveBeenCalled();
    expect(inlineComment.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("hides TFS system comments and system-only threads without hiding reviewer replies", async () => {
    const systemComment = { id: 4, content: "System update", author: "Microsoft.VisualStudio.Services.TFS", isDeleted: false };
    const discussionThreads: PullRequestThread[] = [
      { ...threads[0]!, comments: [...threads[0]!.comments, systemComment] },
      { id: 3, status: "active", comments: [systemComment] },
      { id: 4, status: "active", comments: [systemComment, { id: 5, content: "Reviewer response", author: "Alice", isDeleted: false }] }
    ];
    const { root } = await mount(new MemoryBrowserStore(), discussionThreads);
    expect(root.textContent).not.toContain("System update");
    expect(root.textContent).not.toContain("Microsoft.VisualStudio.Services.TFS");
    expect(root.querySelector('[data-thread-id="3"]')).toBeNull();
    expect(root.querySelector('[data-thread-id="1"]')!.textContent).toContain("A reply");
    expect(root.querySelector('[data-thread-id="4"]')!.textContent).toContain("Reviewer response");
    expect(root.querySelectorAll('[data-thread-id="4"] [data-comment-id]')).toHaveLength(1);
    const author = root.querySelector<HTMLInputElement>(".thread-author-filter")!;
    author.value = "Microsoft.VisualStudio.Services.TFS";
    author.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.querySelectorAll("[data-thread-id]")).toHaveLength(0);
    expect(discussionThreads[0]!.comments).toContain(systemComment);
  });

  it("defaults to newest first for threads and replies and supports oldest first with filters", async () => {
    const { root } = await mount();
    const ids = () => [...root.querySelectorAll<HTMLElement>("[data-thread-id]")].map((element) => element.dataset.threadId);
    const commentIds = () => [...root.querySelectorAll<HTMLElement>('[data-thread-id="1"] [data-comment-id]')].map((element) => element.dataset.commentId);
    expect(ids()).toEqual(["2", "1"]);
    expect(commentIds()).toEqual(["2", "1"]);
    expect(root.textContent).not.toContain("Deleted");
    const sort = root.querySelector<HTMLSelectElement>(".thread-sort")!;
    expect(sort.value).toBe("newest");
    sort.value = "oldest";
    sort.dispatchEvent(new Event("change"));
    expect(ids()).toEqual(["1", "2"]);
    expect(commentIds()).toEqual(["1", "2"]);
    const status = root.querySelector<HTMLSelectElement>(".thread-status-filter")!;
    status.value = "active";
    status.dispatchEvent(new Event("change"));
    expect(ids()).toEqual(["1"]);
    expect(root.querySelector<HTMLSelectElement>(".thread-sort")!.value).toBe("oldest");
  });

  it("hides voted events and vote-only threads while preserving normal comments about voting", async () => {
    const vote = { id: 1, content: "Bob voted 10", author: "Bob", isDeleted: false, isVoteUpdate: true };
    const reply = { id: 2, content: "I voted after checking the fix.", author: "Alice", isDeleted: false };
    const { root } = await mount(new MemoryBrowserStore(), [
      { id: 3, status: "active", comments: [vote] },
      { id: 4, status: "active", comments: [vote, reply] }
    ]);
    expect(root.querySelector('[data-thread-id="3"]')).toBeNull();
    expect(root.textContent).not.toContain("Bob voted 10");
    expect(root.querySelector('[data-thread-id="4"]')!.textContent).toContain(reply.content);
    expect(root.querySelectorAll(".thread-comment")).toHaveLength(1);
  });

  it("saves a general draft inline, previews Markdown, and does not post feedback", async () => {
    const { root, queue, writes } = await mount();
    click(root, ".add-general");
    expect(root.querySelector(".dialog-backdrop")).toBeNull();
    expect(root.activeElement).toBe(root.querySelector(".inline-composer textarea"));
    expect(root.querySelector<HTMLButtonElement>(".save-draft")!.disabled).toBe(true);
    type(root, "general", "**General feedback**");
    expect(root.querySelector(".draft-preview strong")!.textContent).toBe("General feedback");
    click(root, ".save-draft");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(await queue.list()).toMatchObject([{ kind: "general", body: "**General feedback**", delivery: "pending" }]);
    expect(writes.submitReview).not.toHaveBeenCalled();
    expect(root.querySelector(".draft-item")!.textContent).toContain("**General feedback**");
  });

  it("keeps general and reply text across rerenders, sorting, and filtering", async () => {
    const { root, render, queue } = await mount();
    click(root, ".add-general");
    type(root, "general", "Keep general");
    click(root, '[data-thread-id="1"] .reply-draft');
    type(root, "reply:1", "Keep reply");
    render();
    const status = root.querySelector<HTMLSelectElement>(".thread-status-filter")!;
    status.value = "resolved";
    status.dispatchEvent(new Event("change"));
    expect(root.querySelector('[data-composer-key="reply:1"]')).toBeNull();
    const reset = root.querySelector<HTMLSelectElement>(".thread-status-filter")!;
    reset.value = "all";
    reset.dispatchEvent(new Event("change"));
    expect(root.querySelector<HTMLTextAreaElement>('[data-composer-key="general"] textarea')!.value).toBe("Keep general");
    expect(root.querySelector<HTMLTextAreaElement>('[data-composer-key="reply:1"] textarea')!.value).toBe("Keep reply");
    click(root, '[data-composer-key="reply:1"] .save-draft');
    await vi.waitFor(() => expect(root.querySelector('[data-composer-key="reply:1"]')).toBeNull());
    expect(await queue.list()).toMatchObject([{ kind: "reply", threadId: 1, body: "Keep reply" }]);
    expect(root.querySelector<HTMLTextAreaElement>('[data-composer-key="general"] textarea')!.value).toBe("Keep general");
  });

  it("edits saved general/reply drafts inline and cancels without saving", async () => {
    const { root, queue } = await mount();
    click(root, ".add-general");
    type(root, "general", "Original");
    click(root, ".save-draft");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    const [draft] = await queue.list();
    click(root, ".edit-draft");
    expect(root.querySelector(".dialog-backdrop")).toBeNull();
    type(root, `edit:${draft!.id}`, "Updated");
    click(root, ".save-draft");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(await queue.list()).toMatchObject([{ id: draft!.id, body: "Updated" }]);
    click(root, ".add-general");
    type(root, "general", "Do not save");
    click(root, ".cancel-draft");
    expect(root.querySelector(".inline-composer")).toBeNull();
    expect(await queue.list()).toHaveLength(1);
  });

  it("shows storage failures inline, retains text, and permits retry", async () => {
    const store = new MemoryBrowserStore();
    const mutation = vi.spyOn(store, "mutateDrafts").mockRejectedValueOnce(new Error("Storage unavailable"));
    const { root, queue } = await mount(store);
    click(root, ".add-general");
    type(root, "general", "Preserve this");
    click(root, ".save-draft");
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain("Storage unavailable"));
    expect(root.querySelector<HTMLTextAreaElement>(".inline-composer textarea")!.value).toBe("Preserve this");
    click(root, ".save-draft");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(await queue.list()).toHaveLength(1);
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it("edits a saved reply without changing its thread or publishing it", async () => {
    const { root, queue, writes } = await mount();
    click(root, '[data-thread-id="1"] .reply-draft');
    type(root, "reply:1", "Original reply");
    click(root, ".save-draft");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    const [draft] = await queue.list();
    click(root, ".edit-draft");
    type(root, `edit:${draft!.id}`, "Updated reply");
    click(root, ".save-draft");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(await queue.list()).toMatchObject([{ id: draft!.id, kind: "reply", threadId: 1, body: "Updated reply" }]);
    expect(root.activeElement?.classList.contains("edit-draft")).toBe(true);
    expect(writes.submitReview).not.toHaveBeenCalled();
  });

  it("disables the composer during saving and cannot queue the same draft twice", async () => {
    const store = new MemoryBrowserStore();
    const mutate = store.mutateDrafts.bind(store);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const mutation = vi.spyOn(store, "mutateDrafts").mockImplementation(async (key, change) => {
      await pending;
      return mutate(key, change);
    });
    const { root, queue } = await mount(store);
    click(root, ".add-general");
    type(root, "general", "Only once");
    const originalButton = root.querySelector<HTMLButtonElement>(".save-draft")!;
    originalButton.click();
    originalButton.click();
    expect(root.querySelector<HTMLTextAreaElement>(".inline-composer textarea")!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>(".cancel-draft")!.disabled).toBe(true);
    release();
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(await queue.list()).toHaveLength(1);
    expect(mutation).toHaveBeenCalledOnce();
    expect(root.activeElement?.classList.contains("add-general")).toBe(true);
  });

  it("blocks saving when private drafts are disabled after the composer opens", async () => {
    const { root, settings, queue } = await mount();
    click(root, ".add-general");
    type(root, "general", "Private");
    settings.features.draftQueue = false;
    click(root, ".save-draft");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(await queue.list()).toHaveLength(0);
  });
});
