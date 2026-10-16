import type { AdoApi } from "../adapters/ado-api";
import type { BrowserStore } from "../adapters/browser";
import { DraftQueue } from "../core/drafts";
import type { WriteGateway } from "../core/write-gateway";
import type { PullRequestAnalysis, PullRequestThread, ReviewDecision, ReviewDraft, SubmissionReceipt } from "../core/types";
import type { FeatureSettings } from "../features/registry";
import { resolveFeature } from "../features/registry";
import { adoFileUrl, navigateToAdoComment, navigateToAdoFile } from "./ado-navigation";
import { renderAdoComment } from "./comment-content";
import { groupThreadComments, sortThreads, type DiscussionSort } from "./discussion-sort";
import { InlineDraftComposer } from "./inline-draft-composer";
import type { PanelToast } from "./panel-toast";

type DraftInput = Pick<ReviewDraft, "kind" | "path" | "trackingId" | "line" | "side" | "threadId">;

export class DiscussionController {
  private readonly queue: DraftQueue;
  private drafts: ReviewDraft[] = [];
  private threads: PullRequestThread[] = [];
  private receipt: SubmissionReceipt | null = null;
  private loading = true;
  private threadError: string | null = null;
  private threadStatus = "all";
  private threadAuthor = "";
  private threadSort: DiscussionSort = "newest";
  private readonly expandedReplies = new Set<number>();
  private readonly postingDraftIds = new Set<string>();
  private readonly composers = new Map<string, InlineDraftComposer>();
  private actionError: string | null = null;

  constructor(
    private readonly api: AdoApi,
    private readonly store: BrowserStore,
    private readonly analysis: PullRequestAnalysis,
    private readonly writes: WriteGateway,
    private readonly getSettings: () => FeatureSettings,
    private readonly onChange: () => void,
    private readonly toast: Pick<PanelToast, "show" | "dismiss">
  ) {
    this.queue = new DraftQueue(store, analysis.context);
  }

  async load(): Promise<void> {
    this.drafts = await this.queue.list();
    if (this.enabled("threadNavigator")) await this.loadThreads();
    this.loading = false;
    this.onChange();
  }

  async loadThreads(): Promise<void> {
    this.threadError = null;
    try {
      this.threads = await this.api.listThreads(this.analysis.context);
    } catch (error) {
      this.threadError = error instanceof Error ? error.message : "Discussion loading failed";
    }
  }

  markup(): string {
    const draftsEnabled = this.enabled("draftQueue");
    const threadsEnabled = this.enabled("threadNavigator");
    if (!draftsEnabled && !threadsEnabled) return "";
    if (this.loading) return `<section class="discussion"><h3>Review queue</h3><p class="muted">Loading private drafts and discussions…</p></section>`;
    const threads = this.filteredThreads();
    return `<section class="discussion">
      <div class="section-head"><div><h3>Review queue</h3><p class="muted">${draftsEnabled ? `${this.drafts.filter((draft) => draft.delivery !== "posted").length} private drafts` : "Private drafts disabled"}${threadsEnabled ? ` · ${this.threads.length} discussions` : ""}</p></div>${draftsEnabled ? `<button class="secondary add-general" type="button">Add general draft</button>` : ""}</div>
      ${this.actionError ? `<div class="delivery error">${escapeHtml(this.actionError)}</div>` : ""}
      ${draftsEnabled ? this.composers.get("general")?.markup() ?? "" : ""}
      ${draftsEnabled ? `<details ${this.drafts.length ? "open" : ""}><summary>Private drafts</summary><div class="draft-list">${this.drafts.length ? this.drafts.map((draft) => this.draftMarkup(draft)).join("") : `<p class="muted">Drafts stay private until you explicitly post them or confirm Submit Review.</p>`}</div></details>` : ""}
      ${threadsEnabled ? `<details open><summary>Discussion threads</summary>${this.threadControls()}<div class="thread-list">${this.threadError ? `<div class="delivery error">${escapeHtml(this.threadError)} <button class="secondary retry-threads" type="button">Retry</button></div>` : threads.length ? threads.map((thread) => this.threadMarkup(thread)).join("") : `<p class="muted">No discussions match these filters.</p>`}</div></details>` : ""}
      ${this.receipt ? this.receiptMarkup(this.receipt) : ""}
      ${draftsEnabled && (this.enabled("feedbackExport") || this.enabled("submitReview")) ? `<div class="discussion-actions">${this.enabled("feedbackExport") ? `<button class="secondary export-feedback" type="button" ${this.drafts.length ? "" : "disabled"}>Copy Markdown</button>` : ""}${this.enabled("submitReview") ? `<button class="primary submit-review" type="button" ${this.reviewDrafts().length ? "" : 'disabled title="Add a draft comment to your review first"'}>Submit Review</button>` : ""}</div>` : ""}
    </section>`;
  }

  bind(root: ShadowRoot): void {
    if (this.enabled("draftQueue")) {
      root.querySelector(".add-general")?.addEventListener("click", () => this.showGeneralDraft(root));
      for (const element of root.querySelectorAll<HTMLElement>("[data-draft-id]")) {
        const id = element.dataset.draftId!;
        element.querySelector(".edit-draft")?.addEventListener("click", () => this.editDraft(root, id));
        element.querySelector(".delete-draft")?.addEventListener("click", () => void this.removeDraft(id));
      }
      for (const element of root.querySelectorAll<HTMLElement>("[data-composer-key]")) {
        this.composers.get(element.dataset.composerKey!)?.bind(element);
      }
    }
    if (this.enabled("feedbackExport")) {
      root.querySelector(".export-feedback")?.addEventListener("click", () => void this.copyExport());
    }
    if (this.enabled("submitReview")) {
      root.querySelector(".submit-review")?.addEventListener("click", () => void this.showSubmitDialog(root));
      root.querySelector(".retry-vote")?.addEventListener("click", () => this.showRetryVoteDialog(root));
    }
    if (this.enabled("threadNavigator")) {
      root.querySelector(".retry-threads")?.addEventListener("click", () => void this.retryThreads());
      root.querySelector<HTMLSelectElement>(".thread-status-filter")?.addEventListener("change", (event) => { this.threadStatus = (event.target as HTMLSelectElement).value; this.onChange(); });
      root.querySelector<HTMLInputElement>(".thread-author-filter")?.addEventListener("input", (event) => {
        const input = event.target as HTMLInputElement;
        const selection = input.selectionStart;
        this.threadAuthor = input.value;
        this.onChange();
        const replacement = root.querySelector<HTMLInputElement>(".thread-author-filter");
        replacement?.focus();
        replacement?.setSelectionRange(selection, selection);
      });
      root.querySelector<HTMLSelectElement>(".thread-sort")?.addEventListener("change", (event) => {
        this.threadSort = (event.target as HTMLSelectElement).value === "oldest" ? "oldest" : "newest";
        this.onChange();
        root.querySelector<HTMLElement>(".thread-sort")?.focus();
      });
      for (const element of root.querySelectorAll<HTMLElement>("[data-thread-id]")) {
        const threadId = Number(element.dataset.threadId);
        const status = element.dataset.threadStatus ?? "active";
        const replies = element.querySelector<HTMLDetailsElement>(".thread-replies");
        replies?.addEventListener("toggle", () => {
          if (replies.open) this.expandedReplies.add(threadId);
          else this.expandedReplies.delete(threadId);
        });
        for (const image of element.querySelectorAll<HTMLImageElement>(".comment-avatar img")) {
          image.addEventListener("error", () => image.remove(), { once: true });
        }
        for (const button of element.querySelectorAll<HTMLButtonElement>(".jump-comment")) {
          button.addEventListener("click", () => void this.jumpToComment(button, threadId));
        }
        element.querySelector<HTMLAnchorElement>(".thread-file-link")?.addEventListener("click", (event) => {
          event.preventDefault();
          const path = (event.currentTarget as HTMLAnchorElement).dataset.path;
          if (path) navigateToAdoFile(path);
        });
        element.querySelector(".reply-draft")?.addEventListener("click", () => this.openComposer(root, { kind: "reply", threadId }));
        element.querySelector(".thread-status")?.addEventListener("click", () => this.showThreadStatusDialog(root, threadId, status));
      }
    }
  }

  showInlineDraft(root: ShadowRoot, path: string, trackingId: number, line = 1, side: "left" | "right" = "right"): void {
    if (!this.enabled("draftQueue")) return;
    this.showDraftDialog(root, { kind: "inline", path, trackingId, line, side });
  }

  showGeneralDraft(root: ShadowRoot, body = ""): void {
    if (!this.enabled("draftQueue")) return;
    this.openComposer(root, { kind: "general" }, body);
  }

  private enabled(id: "draftQueue" | "threadNavigator" | "feedbackExport" | "submitReview"): boolean {
    return resolveFeature(this.getSettings(), id).enabled;
  }

  private filteredThreads(): PullRequestThread[] {
    return sortThreads(this.threads.filter((thread) => {
      const { original, replies } = groupThreadComments(thread.comments);
      const comments = original ? [original, ...replies] : replies;
      if (!comments.length) return false;
      const active = thread.status.toLowerCase() === "active";
      if (this.threadStatus === "active" && !active) return false;
      if (this.threadStatus === "resolved" && active) return false;
      if (this.threadAuthor && !comments.some((comment) => comment.author.toLowerCase().includes(this.threadAuthor.toLowerCase()))) return false;
      return true;
    }), this.threadSort);
  }

  private threadControls(): string {
    return `<div class="thread-controls"><select class="select thread-status-filter" aria-label="Filter discussions by status"><option value="all">All statuses</option><option value="active" ${this.threadStatus === "active" ? "selected" : ""}>Active</option><option value="resolved" ${this.threadStatus === "resolved" ? "selected" : ""}>Resolved</option></select><input class="search thread-author-filter" value="${escapeHtml(this.threadAuthor)}" placeholder="Filter author" aria-label="Filter discussions by author"><label class="thread-sort-label">Sort threads<select class="select thread-sort" aria-label="Sort threads"><option value="newest" ${this.threadSort === "newest" ? "selected" : ""}>Newest first</option><option value="oldest" ${this.threadSort === "oldest" ? "selected" : ""}>Oldest first</option></select></label></div>`;
  }

  private draftMarkup(draft: ReviewDraft): string {
    const location = draft.path ? `${draft.path}${draft.line ? `:${draft.line} ${draft.side ?? "right"}` : ""}` : draft.kind === "reply" ? `Thread ${draft.threadId}` : "General comment";
    const stale = this.queue.stale(draft);
    return `<article class="draft-item" data-draft-id="${draft.id}"><div><strong>${escapeHtml(location)}</strong><span class="status">${stale ? "stale" : draft.delivery}</span><p>${escapeHtml(draft.body)}</p>${draft.error ? `<small class="error">${escapeHtml(draft.error)}</small>` : ""}</div>${this.composers.get(`edit:${draft.id}`)?.markup() ?? ""}<div><button class="icon edit-draft" type="button">Edit</button><button class="icon delete-draft" type="button" aria-label="Delete draft">✕</button></div></article>`;
  }

  private threadMarkup(thread: PullRequestThread): string {
    const { original, replies } = groupThreadComments(thread.comments);
    const active = thread.status.toLowerCase() === "active";
    const location = thread.path ? `${thread.path}${thread.line ? `:${thread.line}` : ""}` : "";
    const locationMarkup = thread.path
      ? `<a class="file-link thread-file-link" data-path="${escapeHtml(thread.path)}" href="${escapeHtml(adoFileUrl(thread.path))}"><strong>${escapeHtml(location)}</strong></a>`
      : "";
    return `<article class="thread-item" data-thread-id="${thread.id}" data-thread-status="${escapeHtml(thread.status)}">
      <div class="thread-conversation">
        ${original ? this.commentMarkup(original) : '<p class="muted thread-original-unavailable">Original comment hidden or deleted.</p>'}
        ${replies.length ? `<details class="thread-replies" ${this.expandedReplies.has(thread.id) ? "open" : ""}><summary>${replies.length} ${replies.length === 1 ? "reply" : "replies"}</summary><div class="thread-reply-list">${replies.map((comment) => this.commentMarkup(comment)).join("")}</div></details>` : ""}
      </div>
      ${this.enabled("draftQueue") ? this.composers.get(`reply:${thread.id}`)?.markup() ?? "" : ""}
      <footer class="thread-footer"><div class="thread-metadata">${locationMarkup}<div><small class="thread-id">Thread ${thread.id}</small><span class="status">${escapeHtml(thread.status)}</span></div></div><div class="thread-actions">${this.enabled("draftQueue") ? '<button class="icon reply-draft" type="button">Reply</button>' : ""}<button class="icon thread-status" type="button">${active ? "Resolve" : "Reopen"}</button></div></footer>
    </article>`;
  }

  private commentMarkup(comment: PullRequestThread["comments"][number]): string {
    const initials = comment.author.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    return `<div class="thread-comment" data-comment-id="${comment.id}"><header class="comment-header"><span class="comment-avatar" aria-hidden="true">${escapeHtml(initials)}${comment.authorImageUrl ? `<img src="${escapeHtml(comment.authorImageUrl)}" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer">` : ""}</span><div class="comment-author"><strong>${escapeHtml(comment.author)}</strong>${comment.publishedDate ? `<time datetime="${escapeHtml(comment.publishedDate)}">${escapeHtml(new Date(comment.publishedDate).toLocaleString())}</time>` : ""}</div><button class="icon jump-comment" type="button" aria-label="Jump to comment by ${escapeHtml(comment.author)}" title="${comment.publishedDate ? "Jump to comment in Azure DevOps" : "Comment location unavailable: no publication time"}" data-published-date="${escapeHtml(comment.publishedDate ?? "")}" ${comment.publishedDate ? "" : "disabled"}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3H3v10h10v-3M8 2h6v6M14 2l-7 7" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg></button></header><div class="thread-content">${renderAdoComment(comment.content)}</div></div>`;
  }

  private async jumpToComment(button: HTMLButtonElement, threadId: number): Promise<void> {
    button.disabled = true;
    this.toast.dismiss();
    try {
      await navigateToAdoComment(button.dataset.publishedDate ?? "", document, window, this.threads.find((thread) => thread.id === threadId));
    } catch (error) {
      this.toast.show(error instanceof Error ? error.message : "Couldn't jump to this comment. Try again, or open the discussion directly in Azure DevOps.");
    } finally {
      button.disabled = false;
    }
  }

  private receiptMarkup(receipt: SubmissionReceipt): string {
    if (receipt.failedDraftIds.length) return `<div class="delivery error">${receipt.postedDraftIds.length} posted; ${receipt.failedDraftIds.length} remain pending. Decision was not applied.</div>`;
    if (receipt.voteError) return `<div class="delivery">${receipt.postedDraftIds.length} feedback items posted. Decision not applied: ${escapeHtml(receipt.voteError)} <button class="secondary retry-vote" type="button">Retry decision only</button></div>`;
    if (receipt.completedAt) return `<div class="delivery">${receipt.postedDraftIds.length} feedback items posted${receipt.decision === "comment" ? "; vote unchanged" : "; decision applied"}.</div>`;
    return "";
  }

  private showDraftDialog(root: ShadowRoot, input: DraftInput, existing?: ReviewDraft): void {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    const inline = input.kind === "inline";
    backdrop.innerHTML = `<section class="dialog" role="dialog" aria-modal="true"><h3>${existing ? "Edit" : "Add"} private feedback draft</h3><p>${escapeHtml(input.path ?? "General PR feedback")}</p>${inline ? `<div class="location-fields"><label>Line<input class="draft-line" type="number" min="1" value="${input.line ?? 1}"></label><label>Side<select class="draft-side"><option value="right" ${(input.side ?? "right") === "right" ? "selected" : ""}>New file</option><option value="left" ${input.side === "left" ? "selected" : ""}>Original file</option></select></label></div>` : ""}<textarea class="draft-body" rows="7" placeholder="Write Markdown feedback. Nothing is posted until Submit Review.">${escapeHtml(existing?.body ?? "")}</textarea><details class="markdown-preview"><summary>Preview</summary><div class="preview draft-preview">${renderMarkdownPreview(existing?.body ?? "")}</div></details><div class="dialog-actions"><button class="secondary cancel" type="button">Cancel</button><button class="primary save-draft" type="button">Save draft</button></div></section>`;
    root.append(backdrop);
    const textarea = backdrop.querySelector<HTMLTextAreaElement>(".draft-body");
    textarea?.addEventListener("input", () => {
      const preview = backdrop.querySelector<HTMLElement>(".draft-preview");
      if (preview) preview.innerHTML = renderMarkdownPreview(textarea.value);
    });
    backdrop.querySelector(".cancel")?.addEventListener("click", () => backdrop.remove());
    backdrop.querySelector(".save-draft")?.addEventListener("click", () => void this.saveDraft(backdrop, input, existing?.id));
    textarea?.focus();
  }

  private editDraft(root: ShadowRoot, id: string): void {
    const draft = this.drafts.find((candidate) => candidate.id === id);
    if (!draft || draft.delivery === "posted") return;
    if (draft.kind === "inline") this.showDraftDialog(root, draft, draft);
    else this.openComposer(root, draft, draft.body, draft.id);
  }

  private openComposer(root: ShadowRoot, input: DraftInput, body = "", existingId?: string): void {
    if (!this.enabled("draftQueue")) return;
    const key = existingId ? `edit:${existingId}` : input.kind === "reply" ? `reply:${input.threadId}` : "general";
    if (!this.composers.has(key)) {
      let draftId = existingId;
      const save = async (value: string) => {
        const draft = await this.saveComposerDraft(input, value, draftId);
        draftId = draft.id;
        return draft;
      };
      this.composers.set(key, new InlineDraftComposer(
        key,
        existingId ? "Edit private draft" : input.kind === "reply" ? "Reply" : "General comment",
        body,
        async (value) => { await save(value); },
        () => {
          this.composers.delete(key);
          this.onChange();
          const opener = existingId ? `[data-draft-id="${existingId}"] .edit-draft` : input.kind === "reply" ? `[data-thread-id="${input.threadId}"] .reply-draft` : ".add-general";
          root.querySelector<HTMLElement>(opener)?.focus();
        },
        this.onChange,
        input.kind === "reply" ? {
          enabled: () => this.enabled("submitReview"),
          post: async (value) => {
            if (!this.enabled("submitReview")) throw new Error("Posting replies is disabled in settings");
            await this.postComposerDraft(await save(value));
          }
        } : undefined
      ));
    }
    this.onChange();
    const composer = root.querySelector<HTMLElement>(`[data-composer-key="${key}"]`);
    const details = composer?.closest("details");
    if (details) details.open = true;
    composer?.querySelector<HTMLTextAreaElement>(".draft-body")?.focus();
  }

  private async saveComposerDraft(input: DraftInput, body: string, id?: string): Promise<ReviewDraft> {
    if (!this.enabled("draftQueue")) throw new Error("Private feedback drafts are disabled");
    if (id) {
      const drafts = await this.queue.list();
      const draft = drafts.find((candidate) => candidate.id === id);
      if (!draft) throw new Error("This draft was removed. Cancel this editor and start a new comment.");
      if (draft.delivery === "ambiguous") throw new Error("This comment may already have posted. Check Azure DevOps before creating another comment.");
      if (draft.delivery === "posted" || draft.delivery === "sending") throw new Error("This comment is already posted or being submitted.");
      await this.queue.update(id, { body });
      const updated: ReviewDraft = { ...draft, body, delivery: "pending", error: undefined };
      this.drafts = drafts.map((candidate) => candidate.id === id ? updated : candidate);
      return updated;
    }
    const draft = await this.queue.add({ ...input, body });
    this.drafts = [...this.drafts, draft];
    return draft;
  }

  private async postComposerDraft(draft: ReviewDraft): Promise<void> {
    if (!this.enabled("submitReview")) throw new Error("Posting replies is disabled in settings");
    this.postingDraftIds.add(draft.id);
    try {
      const result = await this.writes.submitReview(this.analysis.context, [draft.id], "comment");
      this.drafts = result.drafts;
      const delivered = this.drafts.find((candidate) => candidate.id === draft.id);
      if (delivered?.delivery !== "posted") {
        throw new Error(delivered?.delivery === "ambiguous"
          ? "This reply may already have posted. Check its Azure DevOps thread before creating another reply."
          : delivered?.error ?? "Reply could not be posted. Your text is saved for retry.");
      }
      if (draft.threadId) this.expandedReplies.add(draft.threadId);
      await this.loadThreads();
    } catch (error) {
      this.drafts = await this.queue.list();
      throw error;
    } finally {
      this.postingDraftIds.delete(draft.id);
    }
  }

  private reviewDrafts(): ReviewDraft[] {
    return this.drafts.filter((draft) => (draft.delivery === "pending" || draft.delivery === "failed") && draft.body.trim() && !this.postingDraftIds.has(draft.id));
  }

  private showThreadStatusDialog(root: ShadowRoot, threadId: number, currentStatus: string): void {
    const reopen = currentStatus.toLowerCase() !== "active";
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `<section class="dialog" role="dialog" aria-modal="true"><h3>${reopen ? "Reopen" : "Resolve"} thread ${threadId}?</h3><p>This updates the Azure DevOps thread immediately after confirmation.</p><div class="dialog-actions"><button class="secondary cancel" type="button">Cancel</button><button class="primary confirm-status" type="button">${reopen ? "Reopen thread" : "Resolve as fixed"}</button></div></section>`;
    root.append(backdrop);
    backdrop.querySelector(".cancel")?.addEventListener("click", () => backdrop.remove());
    backdrop.querySelector(".confirm-status")?.addEventListener("click", async () => {
      const button = backdrop.querySelector<HTMLButtonElement>(".confirm-status");
      if (button) button.disabled = true;
      try {
        await this.writes.setThreadStatus(this.analysis.context, threadId, reopen ? 1 : 2);
        await this.loadThreads();
        backdrop.remove();
        this.onChange();
      } catch (error) {
        const paragraph = backdrop.querySelector("p");
        if (paragraph) paragraph.textContent = error instanceof Error ? error.message : "Thread update failed";
        if (button) button.disabled = false;
      }
    });
  }

  private async saveDraft(backdrop: HTMLElement, input: DraftInput, existingId?: string): Promise<void> {
    const body = backdrop.querySelector<HTMLTextAreaElement>(".draft-body")?.value.trim();
    if (!body) return;
    const line = input.kind === "inline" ? Number(backdrop.querySelector<HTMLInputElement>(".draft-line")?.value) : input.line;
    const side = input.kind === "inline" ? backdrop.querySelector<HTMLSelectElement>(".draft-side")?.value as "left" | "right" : input.side;
    if (input.kind === "inline" && (!Number.isInteger(line) || (line ?? 0) < 1)) {
      this.actionError = "Inline drafts require a valid line number";
      this.onChange();
      return;
    }
    const location = {
      ...(line !== undefined ? { line } : {}),
      ...(side !== undefined ? { side } : {})
    };
    if (existingId) await this.queue.update(existingId, { body, ...location });
    else await this.queue.add({ ...input, body, ...location });
    this.drafts = await this.queue.list();
    backdrop.remove();
    this.onChange();
  }

  private async removeDraft(id: string): Promise<void> {
    const draft = this.drafts.find((candidate) => candidate.id === id);
    if (draft?.delivery === "posted") return;
    await this.queue.remove(id);
    this.composers.delete(`edit:${id}`);
    this.drafts = await this.queue.list();
    this.onChange();
  }

  private async showSubmitDialog(root: ShadowRoot): Promise<void> {
    if (!this.enabled("submitReview") || !this.reviewDrafts().length) return;
    this.actionError = null;
    let currentVote: number;
    try {
      currentVote = await this.api.getCurrentVote(this.analysis.context);
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : "Current vote could not be loaded";
      this.onChange();
      return;
    }
    const selectable = this.reviewDrafts();
    if (!selectable.length) return;
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `<section class="dialog submit-dialog" role="dialog" aria-modal="true"><h3>Submit Review</h3><p>Current Azure DevOps vote: <strong>${voteLabel(currentVote)}</strong>. Feedback is posted first. The selected decision is applied only if every selected item succeeds.</p><label>Optional overall summary<textarea class="submission-summary" rows="4" placeholder="Add a general summary to this submission"></textarea></label><div class="submit-items">${selectable.map((draft) => `<label><input type="checkbox" data-submit-id="${draft.id}" checked> ${escapeHtml(draft.path ?? (draft.kind === "reply" ? `Thread ${draft.threadId}` : "General comment"))}: ${escapeHtml(draft.body)}</label>`).join("")}</div><label class="decision-label">Decision<select class="decision"><option value="comment">Comment only (leave vote unchanged)</option><option value="approve">Approve</option><option value="approve-suggestions">Approve with suggestions</option><option value="wait-author">Wait for author</option><option value="reject">Reject</option></select></label><div class="dialog-actions"><button class="secondary cancel" type="button">Cancel</button><button class="primary confirm-submit" type="button">Confirm submission</button></div></section>`;
    root.append(backdrop);
    backdrop.querySelector(".cancel")?.addEventListener("click", () => backdrop.remove());
    backdrop.querySelector(".confirm-submit")?.addEventListener("click", () => void this.submit(backdrop));
    const updateSubmitState = () => {
      const hasComment = !!backdrop.querySelector("[data-submit-id]:checked") || !!backdrop.querySelector<HTMLTextAreaElement>(".submission-summary")?.value.trim();
      const button = backdrop.querySelector<HTMLButtonElement>(".confirm-submit")!;
      button.disabled = button.dataset.submitting === "true" || !hasComment;
    };
    backdrop.querySelector(".submission-summary")?.addEventListener("input", updateSubmitState);
    for (const checkbox of backdrop.querySelectorAll("[data-submit-id]")) checkbox.addEventListener("change", updateSubmitState);
  }

  private async submit(backdrop: HTMLElement): Promise<void> {
    const button = backdrop.querySelector<HTMLButtonElement>(".confirm-submit");
    if (!button || button.disabled || button.dataset.submitting === "true" || !this.enabled("submitReview")) return;
    const ids = [...backdrop.querySelectorAll<HTMLInputElement>("[data-submit-id]:checked")].map((input) => input.dataset.submitId!);
    const summary = backdrop.querySelector<HTMLTextAreaElement>(".submission-summary")?.value.trim();
    if (!ids.length && !summary) return;
    button.dataset.submitting = "true";
    button.disabled = true;
    button.textContent = "Submitting…";
    const decision = backdrop.querySelector<HTMLSelectElement>(".decision")?.value as ReviewDecision ?? "comment";
    try {
      if (summary) {
        const draft = await this.queue.add({ kind: "general", body: summary });
        ids.push(draft.id);
      }
      const result = await this.writes.submitReview(this.analysis.context, ids, decision);
      this.drafts = result.drafts;
      this.receipt = result.receipt;
      backdrop.remove();
      this.onChange();
    } catch (error) {
      this.drafts = await this.queue.list();
      delete button.dataset.submitting;
      button.disabled = !backdrop.querySelector("[data-submit-id]:checked") && !backdrop.querySelector<HTMLTextAreaElement>(".submission-summary")?.value.trim();
      button.textContent = "Confirm submission";
      const paragraph = backdrop.querySelector("p");
      if (paragraph) paragraph.textContent = error instanceof Error ? error.message : "Submission failed";
    }
  }

  private async retryVote(): Promise<void> {
    if (!this.receipt || !this.enabled("submitReview")) return;
    try {
      this.receipt = await this.writes.retryDecision(this.analysis.context, this.receipt);
    } catch (error) {
      this.receipt = { ...this.receipt, voteError: error instanceof Error ? error.message : "Decision retry failed" };
    }
    this.onChange();
  }

  private showRetryVoteDialog(root: ShadowRoot): void {
    if (!this.receipt) return;
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `<section class="dialog" role="dialog" aria-modal="true"><h3>Retry decision only?</h3><p>This applies <strong>${escapeHtml(this.receipt.decision)}</strong> to the current PR iteration. It does not replay feedback.</p><div class="dialog-actions"><button class="secondary cancel" type="button">Cancel</button><button class="primary confirm-retry" type="button">Confirm decision retry</button></div></section>`;
    root.append(backdrop);
    backdrop.querySelector(".cancel")?.addEventListener("click", () => backdrop.remove());
    backdrop.querySelector(".confirm-retry")?.addEventListener("click", async () => {
      const button = backdrop.querySelector<HTMLButtonElement>(".confirm-retry");
      if (button) button.disabled = true;
      await this.retryVote();
      backdrop.remove();
    });
  }

  private async retryThreads(): Promise<void> {
    await this.loadThreads();
    this.onChange();
  }

  private async copyExport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.exportMarkdown());
      this.actionError = null;
    } catch (error) {
      this.actionError = error instanceof Error ? `Copy failed: ${error.message}` : "Copy failed";
    }
    this.onChange();
  }

  private exportMarkdown(): string {
    const lines = [`# ADO Boost review feedback`, "", `PR: ${this.analysis.context.title}`, `Comparison: ${this.analysis.context.mergeBaseCommit}…${this.analysis.context.sourceCommit}`, ""];
    for (const draft of this.drafts) {
      lines.push(`## ${draft.path ? `${draft.path}${draft.line ? `:${draft.line}` : ""}` : draft.kind === "reply" ? `Reply to thread ${draft.threadId}` : "General feedback"}`, "", draft.body, "", `Status: ${draft.delivery}`, "");
    }
    return lines.join("\n");
  }

}

function voteLabel(vote: number): string {
  return new Map([[10, "Approved"], [5, "Approved with suggestions"], [0, "No vote"], [-5, "Waiting for author"], [-10, "Rejected"]]).get(vote) ?? `Vote ${vote}`;
}

function renderMarkdownPreview(value: string): string {
  return renderAdoComment(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] as string);
}
