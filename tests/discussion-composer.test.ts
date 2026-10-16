// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequest/7"}

import { afterEach, describe, expect, it, vi } from "vitest";
import { AdoApi } from "../src/adapters/ado-api";
import { MemoryBrowserStore } from "../src/adapters/browser";
import { DraftQueue } from "../src/core/drafts";
import { SubmissionCoordinator } from "../src/core/submission";
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
    postAnnouncement: vi.fn(), finishReview: vi.fn(), submitReview: vi.fn(), retryDecision: vi.fn(), setThreadStatus: vi.fn()
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  const toast = new PanelToast(root);
  toasts.push(toast);
  const render = () => { root.innerHTML = controller.markup(); controller.bind(root); toast.mount(); };
  const api = new AdoApi({ fetch });
  const controller = new DiscussionController(api, store, analysis, writes, () => settings, render, toast);
  await controller.load();
  return { root, store, settings, writes, api, render, controller, queue: new DraftQueue(store, analysis.context) };
}

function mockSubmission({ api, store, queue, writes }: Awaited<ReturnType<typeof mount>>) {
  vi.spyOn(api, "getChanges").mockResolvedValue([]);
  vi.spyOn(api, "getCurrentVote").mockResolvedValue(10);
  vi.spyOn(api, "findDraftDelivery").mockResolvedValue(null);
  const post = vi.spyOn(api, "postDraft").mockResolvedValue({ threadId: 1, commentId: 4 });
  const vote = vi.spyOn(api, "setVote").mockResolvedValue(undefined);
  vi.mocked(writes.submitReview).mockImplementation((_context, ids, decision) =>
    new SubmissionCoordinator(api, store, queue, analysis.context).submit(ids, decision));
  return { post, vote };
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

  it("defaults to newest threads first while keeping originals first and replies collapsed", async () => {
    const { root } = await mount();
    const ids = () => [...root.querySelectorAll<HTMLElement>("[data-thread-id]")].map((element) => element.dataset.threadId);
    const commentIds = () => [...root.querySelectorAll<HTMLElement>('[data-thread-id="1"] [data-comment-id]')].map((element) => element.dataset.commentId);
    expect(ids()).toEqual(["2", "1"]);
    expect(commentIds()).toEqual(["1", "2"]);
    const original = root.querySelector('[data-thread-id="1"] .thread-conversation > .thread-comment')!;
    expect(original.getAttribute("data-comment-id")).toBe("1");
    const replies = root.querySelector<HTMLDetailsElement>('[data-thread-id="1"] .thread-replies')!;
    expect(replies.open).toBe(false);
    expect(replies.querySelector("summary")!.textContent).toBe("1 reply");
    expect(replies.querySelector(".thread-comment")!.getAttribute("data-comment-id")).toBe("2");
    expect(root.querySelector('[data-thread-id="2"] .thread-replies')).toBeNull();
    expect(root.textContent).not.toContain("Deleted");
    const sort = root.querySelector<HTMLSelectElement>(".thread-sort")!;
    expect(sort.getAttribute("aria-label")).toBe("Sort threads");
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

  it("keeps expanded reply groups across rerenders, sorting, filtering, and draft editing", async () => {
    const { root, render } = await mount();
    const replyGroup = () => root.querySelector<HTMLDetailsElement>('[data-thread-id="1"] .thread-replies')!;
    replyGroup().open = true;
    replyGroup().dispatchEvent(new Event("toggle"));
    render();
    expect(replyGroup().open).toBe(true);
    const sort = root.querySelector<HTMLSelectElement>(".thread-sort")!;
    sort.value = "oldest";
    sort.dispatchEvent(new Event("change"));
    expect(replyGroup().open).toBe(true);
    const status = root.querySelector<HTMLSelectElement>(".thread-status-filter")!;
    status.value = "resolved";
    status.dispatchEvent(new Event("change"));
    expect(replyGroup()).toBeNull();
    const reset = root.querySelector<HTMLSelectElement>(".thread-status-filter")!;
    reset.value = "all";
    reset.dispatchEvent(new Event("change"));
    expect(replyGroup().open).toBe(true);
    click(root, '[data-thread-id="1"] .reply-draft');
    type(root, "reply:1", "Keep my reply draft");
    render();
    expect(replyGroup().open).toBe(true);
    expect(root.querySelector<HTMLTextAreaElement>('[data-composer-key="reply:1"] textarea')!.value).toBe("Keep my reply draft");
    replyGroup().open = false;
    replyGroup().dispatchEvent(new Event("toggle"));
    render();
    expect(replyGroup().open).toBe(false);
  });

  it("renders replies under a placeholder when the original is hidden, rather than promoting a reply", async () => {
    const { root } = await mount(new MemoryBrowserStore(), [{
      id: 5, status: "active", comments: [
        { id: 1, content: "Hidden original", author: "Alice", isDeleted: true },
        { id: 3, content: "Second reply", author: "Alice", isDeleted: false },
        { id: 2, content: "First reply", author: "Bob", isDeleted: false }
      ]
    }]);
    const conversation = root.querySelector(".thread-conversation")!;
    expect(conversation.querySelector(":scope > .thread-comment")).toBeNull();
    expect(conversation.querySelector(".thread-original-unavailable")!.textContent).toBe("Original comment hidden or deleted.");
    const replies = conversation.querySelector<HTMLDetailsElement>(".thread-replies")!;
    expect(replies.open).toBe(false);
    expect(replies.querySelector("summary")!.textContent).toBe("2 replies");
    expect([...replies.querySelectorAll<HTMLElement>("[data-comment-id]")].map((element) => element.dataset.commentId)).toEqual(["2", "3"]);
    expect(root.textContent).not.toContain("Hidden original");
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

  it("offers Reply, Add to review, and Post, and enables Submit Review only after queuing a draft", async () => {
    const { root, queue, writes } = await mount();
    expect(root.querySelector(".reply-draft")!.textContent).toBe("Reply");
    expect(root.querySelector<HTMLButtonElement>(".submit-review")!.disabled).toBe(true);
    click(root, '[data-thread-id="1"] .reply-draft');
    expect(root.querySelector(".save-draft")!.textContent).toBe("Add to review");
    expect(root.querySelector(".post-comment")!.textContent).toBe("Post");
    type(root, "reply:1", "   ");
    expect(root.querySelector<HTMLButtonElement>(".save-draft")!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>(".post-comment")!.disabled).toBe(true);
    type(root, "reply:1", "Private reply");
    expect(root.querySelector<HTMLButtonElement>(".post-comment")!.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>(".submit-review")!.disabled).toBe(true);
    click(root, ".save-draft");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(await queue.list()).toMatchObject([{ kind: "reply", threadId: 1, body: "Private reply", delivery: "pending" }]);
    expect(writes.submitReview).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLButtonElement>(".submit-review")!.disabled).toBe(false);
    click(root, ".delete-draft");
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>(".submit-review")!.disabled).toBe(true));
  });

  it.each(["posted", "sending", "ambiguous"] as const)("disables Submit Review for a %s-only queue and guards its handler", async (delivery) => {
    const store = new MemoryBrowserStore();
    const queue = new DraftQueue(store, analysis.context);
    const draft = await queue.add({ kind: "reply", threadId: 1, body: "Not ready to submit" });
    await queue.replace([{ ...draft, delivery }]);
    const { root, api, writes } = await mount(store);
    const vote = vi.spyOn(api, "getCurrentVote");
    const button = root.querySelector<HTMLButtonElement>(".submit-review")!;
    expect(button.disabled).toBe(true);
    button.dispatchEvent(new Event("click"));
    expect(root.querySelector(".submit-dialog")).toBeNull();
    expect(vote).not.toHaveBeenCalled();
    expect(writes.submitReview).not.toHaveBeenCalled();
  });

  it.each([false, true])("posts only this reply without voting or submitting other drafts (other draft: %s)", async (hasOtherDraft) => {
    const discussionThreads = structuredClone(threads);
    const fixture = await mount(new MemoryBrowserStore(), discussionThreads);
    const { root, queue, writes, controller } = fixture;
    const other = hasOtherDraft ? await queue.add({ kind: "general", body: "Keep queued" }) : undefined;
    await controller.load();
    const { post, vote } = mockSubmission(fixture);
    post.mockImplementation(async (_context, draft) => {
      discussionThreads[0]!.comments.push({ id: 4, content: draft.body, author: "Me", isDeleted: false });
      return { threadId: 1, commentId: 4 };
    });
    click(root, '[data-thread-id="1"] .reply-draft');
    type(root, "reply:1", "  Publish this reply  ");
    click(root, ".post-comment");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    const drafts = await queue.list();
    const reply = drafts.find((draft) => draft.kind === "reply")!;
    expect(reply).toMatchObject({ threadId: 1, body: "Publish this reply", delivery: "posted", serverCommentId: 4 });
    expect(writes.submitReview).toHaveBeenCalledExactlyOnceWith(analysis.context, [reply.id], "comment");
    expect(post).toHaveBeenCalledOnce();
    expect(vote).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLDetailsElement>('[data-thread-id="1"] .thread-replies')!.open).toBe(true);
    expect(root.querySelector('[data-thread-id="1"] [data-comment-id="4"]')!.textContent).toContain("Publish this reply");
    expect(root.querySelector<HTMLButtonElement>(".submit-review")!.disabled).toBe(!hasOtherDraft);
    if (other) expect(drafts.find((draft) => draft.id === other.id)).toMatchObject({ body: "Keep queued", delivery: "pending" });
  });

  it("posts an edited queued reply using the existing draft instead of creating a second draft", async () => {
    const fixture = await mount();
    const { root, queue, writes } = fixture;
    mockSubmission(fixture);
    const draft = await queue.add({ kind: "reply", threadId: 1, body: "Original" });
    await fixture.controller.load();
    click(root, ".edit-draft");
    type(root, `edit:${draft.id}`, "Edited reply");
    click(root, ".post-comment");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(await queue.list()).toMatchObject([{ id: draft.id, body: "Edited reply", threadId: 1, delivery: "posted" }]);
    expect(await queue.list()).toHaveLength(1);
    expect(writes.submitReview).toHaveBeenCalledExactlyOnceWith(analysis.context, [draft.id], "comment");
  });

  it("disables all composer actions during posting and prevents duplicate delivery", async () => {
    const fixture = await mount();
    const { root, queue, render } = fixture;
    const { post } = mockSubmission(fixture);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    post.mockImplementation(async () => { await pending; return { threadId: 1, commentId: 4 }; });
    click(root, '[data-thread-id="1"] .reply-draft');
    type(root, "reply:1", "Post once");
    const originalButton = root.querySelector<HTMLButtonElement>(".post-comment")!;
    originalButton.click();
    originalButton.click();
    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
    render();
    for (const selector of [".save-draft", ".post-comment", ".cancel-draft", ".draft-body", ".submit-review"]) {
      expect(root.querySelector<HTMLButtonElement>(selector)!.disabled).toBe(true);
    }
    release();
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(await queue.list()).toHaveLength(1);
    expect(post).toHaveBeenCalledOnce();
  });

  it("retains failed reply text and retries the same draft rather than duplicating it", async () => {
    const fixture = await mount();
    const { root, queue, writes } = fixture;
    const { post } = mockSubmission(fixture);
    post.mockRejectedValueOnce(new Error("Reply failed (403)"));
    click(root, '[data-thread-id="1"] .reply-draft');
    type(root, "reply:1", "Retain my reply");
    click(root, ".post-comment");
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain("Reply failed (403)"));
    expect(root.querySelector<HTMLTextAreaElement>(".draft-body")!.value).toBe("Retain my reply");
    const [draft] = await queue.list();
    expect(draft?.delivery).toBe("failed");
    type(root, "reply:1", "Corrected reply");
    click(root, ".post-comment");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(await queue.list()).toMatchObject([{ id: draft!.id, body: "Corrected reply", delivery: "posted" }]);
    expect(await queue.list()).toHaveLength(1);
    expect(vi.mocked(writes.submitReview).mock.calls.map((call) => call[1])).toEqual([[draft!.id], [draft!.id]]);
  });

  it("does not replay an uncertain reply or reset its delivery state through Add to review", async () => {
    const fixture = await mount();
    const { root, queue, writes } = fixture;
    const { post } = mockSubmission(fixture);
    post.mockRejectedValueOnce(new TypeError("Network lost"));
    click(root, '[data-thread-id="1"] .reply-draft');
    type(root, "reply:1", "Possibly delivered");
    click(root, ".post-comment");
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain("may already have posted"));
    click(root, ".post-comment");
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>(".post-comment")!.disabled).toBe(false));
    click(root, ".save-draft");
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>(".save-draft")!.disabled).toBe(false));
    expect(await queue.list()).toMatchObject([{ body: "Possibly delivered", delivery: "ambiguous" }]);
    expect(writes.submitReview).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledOnce();
    expect(root.querySelector<HTMLButtonElement>(".submit-review")!.disabled).toBe(true);
  });

  it("does not replay a known successful post if saving its receipt fails", async () => {
    const fixture = await mount();
    const { root, queue, store } = fixture;
    const { post } = mockSubmission(fixture);
    vi.spyOn(store, "saveReceipts").mockRejectedValueOnce(new Error("Receipt storage unavailable"));
    click(root, '[data-thread-id="1"] .reply-draft');
    type(root, "reply:1", "Already delivered");
    click(root, ".post-comment");
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain("Receipt storage unavailable"));
    click(root, ".post-comment");
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain("already posted"));
    expect(post).toHaveBeenCalledOnce();
    expect(await queue.list()).toMatchObject([{ delivery: "posted" }]);
  });

  it("closes a successful reply composer even when refreshing discussions fails", async () => {
    const fixture = await mount();
    const { root, api } = fixture;
    const { post } = mockSubmission(fixture);
    vi.spyOn(api, "listThreads").mockRejectedValueOnce(new Error("Discussion refresh failed"));
    click(root, '[data-thread-id="1"] .reply-draft');
    type(root, "reply:1", "Delivered");
    click(root, ".post-comment");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(root.querySelector(".delivery.error")?.textContent).toContain("Discussion refresh failed");
    expect(post).toHaveBeenCalledOnce();
    expect(root.querySelector<HTMLButtonElement>(".submit-review")!.disabled).toBe(true);
  });

  it("blocks Post if submission is disabled after opening a reply, but still allows queuing", async () => {
    const { root, settings, queue, writes } = await mount();
    click(root, '[data-thread-id="1"] .reply-draft');
    type(root, "reply:1", "Private only");
    settings.features.submitReview = false;
    click(root, ".post-comment");
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain("disabled"));
    expect(root.querySelector(".post-comment")).toBeNull();
    expect(await queue.list()).toHaveLength(0);
    expect(writes.submitReview).not.toHaveBeenCalled();
    click(root, ".save-draft");
    await vi.waitFor(() => expect(root.querySelector(".inline-composer")).toBeNull());
    expect(await queue.list()).toMatchObject([{ kind: "reply", body: "Private only", delivery: "pending" }]);
  });

  it("requires a selected draft or summary in the submission preview", async () => {
    const fixture = await mount();
    const { root, queue, writes } = fixture;
    mockSubmission(fixture);
    await queue.add({ kind: "reply", threadId: 1, body: "Queued reply" });
    await fixture.controller.load();
    click(root, ".submit-review");
    await vi.waitFor(() => expect(root.querySelector(".submit-dialog")).not.toBeNull());
    const checkbox = root.querySelector<HTMLInputElement>("[data-submit-id]")!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    expect(root.querySelector<HTMLButtonElement>(".confirm-submit")!.disabled).toBe(true);
    click(root, ".confirm-submit");
    expect(writes.submitReview).not.toHaveBeenCalled();
    const summary = root.querySelector<HTMLTextAreaElement>(".submission-summary")!;
    summary.value = "Summary comment";
    summary.dispatchEvent(new Event("input"));
    expect(root.querySelector<HTMLButtonElement>(".confirm-submit")!.disabled).toBe(false);
    click(root, ".confirm-submit");
    await vi.waitFor(() => expect(root.querySelector(".submit-dialog")).toBeNull());
    expect(writes.submitReview).toHaveBeenCalledWith(analysis.context, expect.any(Array), "comment", true);
    expect(await queue.list()).toMatchObject([{ body: "Queued reply", delivery: "pending" }, { body: "Summary comment", delivery: "posted" }]);
  });

  it("retries only the announcement after a successful review with an announcement error", async () => {
    const fixture = await mount();
    const { root, queue, writes } = fixture;
    mockSubmission(fixture);
    const draft = await queue.add({ kind: "reply", threadId: 1, body: "Queued reply" });
    const result = await new SubmissionCoordinator(fixture.api, fixture.store, queue, analysis.context).submit([draft.id], "comment");
    result.receipt.announcementError = "Announcement failed";
    vi.mocked(writes.submitReview).mockResolvedValue(result);
    vi.mocked(writes.finishReview).mockResolvedValue(null);
    await queue.replace([{ ...draft, delivery: "pending" }]);
    await fixture.controller.load();
    click(root, ".submit-review");
    await vi.waitFor(() => expect(root.querySelector(".submit-dialog")).not.toBeNull());
    click(root, ".confirm-submit");
    await vi.waitFor(() => expect(root.querySelector(".retry-announcement")).not.toBeNull());
    expect(root.textContent).toContain("Announcement failed");
    click(root, ".retry-announcement");
    await vi.waitFor(() => expect(root.querySelector(".retry-announcement")).toBeNull());
    expect(writes.finishReview).toHaveBeenCalledExactlyOnceWith(analysis.context, {
      kind: "submission", submissionId: result.receipt.id, commentCount: 1
    });
    expect(writes.submitReview).toHaveBeenCalledOnce();
    expect(writes.retryDecision).not.toHaveBeenCalled();
  });

  it("does not re-enable confirmation or submit twice when preview inputs change during delivery", async () => {
    const fixture = await mount();
    const { root, queue, writes } = fixture;
    const { post } = mockSubmission(fixture);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    post.mockImplementation(async () => { await pending; return { threadId: 1, commentId: 4 }; });
    await queue.add({ kind: "reply", threadId: 1, body: "Queued reply" });
    await fixture.controller.load();
    click(root, ".submit-review");
    await vi.waitFor(() => expect(root.querySelector(".submit-dialog")).not.toBeNull());
    click(root, ".confirm-submit");
    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
    const summary = root.querySelector<HTMLTextAreaElement>(".submission-summary")!;
    summary.value = "Changed during submission";
    summary.dispatchEvent(new Event("input"));
    const button = root.querySelector<HTMLButtonElement>(".confirm-submit")!;
    expect(button.disabled).toBe(true);
    button.dispatchEvent(new Event("click"));
    expect(writes.submitReview).toHaveBeenCalledOnce();
    release();
    await vi.waitFor(() => expect(root.querySelector(".submit-dialog")).toBeNull());
    expect(await queue.list()).toHaveLength(1);
  });
});
