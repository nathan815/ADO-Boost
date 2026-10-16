import type { AdoApi } from "../adapters/ado-api";
import type { BrowserStore } from "../adapters/browser";
import type { PullRequestContext, ReviewDecision, ReviewDraft, SubmissionReceipt } from "./types";
import type { DraftQueue } from "./drafts";

export const DECISION_VOTES: Record<Exclude<ReviewDecision, "comment">, number> = {
  approve: 10,
  "approve-suggestions": 5,
  "wait-author": -5,
  reject: -10
};

export interface SubmissionResult {
  receipt: SubmissionReceipt;
  drafts: ReviewDraft[];
}

export class SubmissionCoordinator {
  constructor(
    private readonly api: AdoApi,
    private readonly store: BrowserStore,
    private readonly queue: DraftQueue,
    private readonly context: PullRequestContext,
    private readonly preflight: () => Promise<void> = async () => undefined,
    private readonly finishAnnouncement: (receipt: SubmissionReceipt) => Promise<void> = async () => undefined
  ) {}

  async submit(draftIds: string[], decision: ReviewDecision, signal?: AbortSignal): Promise<SubmissionResult> {
    await this.preflight();
    const drafts = await this.queue.list();
    const selected = drafts.filter((draft) => draftIds.includes(draft.id));
    if (selected.length !== new Set(draftIds).size) throw new Error("The draft queue changed before submission; reopen the preview and confirm again");
    const stale = selected.filter((draft) => this.queue.stale(draft));
    if (stale.length > 0) throw new Error(`${stale.length} selected draft${stale.length === 1 ? " is" : "s are"} tied to an older PR comparison`);
    if (selected.some((draft) => draft.delivery === "sending")) throw new Error("A selected draft is already being submitted");
    if (selected.some((draft) => draft.delivery === "posted")) throw new Error("A selected comment has already been posted");
    if (selected.some((draft) => draft.delivery === "ambiguous")) throw new Error("A selected comment may already have posted. Check its Azure DevOps thread before submitting it again.");
    const changes = await this.api.getChanges(this.context, signal);
    const changedByTrackingId = new Map(changes.filter((change) => change.unresolved !== true).map((change) => [change.trackingId, change]));
    for (const draft of selected) {
      if (draft.kind !== "inline") continue;
      const changed = draft.trackingId === undefined ? undefined : changedByTrackingId.get(draft.trackingId);
      if (!changed || changed.path !== draft.path || !draft.line || draft.line < 1) {
        throw new Error(`Inline draft for ${draft.path ?? "unknown file"} must be reanchored before submission`);
      }
    }

    const existingVote = await this.api.getCurrentVote(this.context, signal);
    const receipt: SubmissionReceipt = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      decision,
      existingVote,
      postedDraftIds: [],
      failedDraftIds: [],
      voteApplied: false
    };

    let current = drafts;
    for (const draft of selected) {
      await this.preflight();
      current = replaceDraft(current, draft.id, { delivery: "sending", error: undefined });
      await this.queue.replace(current);
      try {
        const posted = await this.api.postDraft(this.context, draft, signal);
        current = replaceDraft(current, draft.id, {
          delivery: "posted",
          serverThreadId: posted.threadId,
          serverCommentId: posted.commentId,
          error: undefined
        });
        receipt.postedDraftIds.push(draft.id);
      } catch (error) {
        const reconciled = await this.api.findDraftDelivery(this.context, draft, signal).catch(() => null);
        if (reconciled) {
          current = replaceDraft(current, draft.id, {
            delivery: "posted",
            serverThreadId: reconciled.threadId,
            serverCommentId: reconciled.commentId,
            error: undefined
          });
          receipt.postedDraftIds.push(draft.id);
          await this.queue.replace(current);
          continue;
        }
        current = replaceDraft(current, draft.id, {
          delivery: error instanceof TypeError ? "ambiguous" : "failed",
          error: error instanceof Error ? error.message : "Feedback publication failed"
        });
        receipt.failedDraftIds.push(draft.id);
        await this.queue.replace(current);
        await this.saveReceipt(receipt);
        return { receipt, drafts: current };
      }
      await this.queue.replace(current);
    }

    if (decision !== "comment") {
      try {
        await this.preflight();
        await this.api.setVote(this.context, DECISION_VOTES[decision], signal);
        receipt.voteApplied = true;
      } catch (error) {
        receipt.voteError = error instanceof Error ? error.message : "Review decision failed";
        await this.saveReceipt(receipt);
        return { receipt, drafts: current };
      }
    }
    await this.completeAnnouncement(receipt);
    receipt.completedAt = new Date().toISOString();
    await this.saveReceipt(receipt);
    return { receipt, drafts: current };
  }

  async retryVote(receipt: SubmissionReceipt, signal?: AbortSignal): Promise<SubmissionReceipt> {
    await this.preflight();
    if (receipt.failedDraftIds.length > 0 || receipt.decision === "comment") throw new Error("This receipt is not eligible for a decision-only retry");
    await this.api.setVote(this.context, DECISION_VOTES[receipt.decision], signal);
    const updated = { ...receipt, voteApplied: true, voteError: undefined, completedAt: new Date().toISOString() };
    await this.completeAnnouncement(updated);
    await this.saveReceipt(updated);
    return updated;
  }

  private async saveReceipt(receipt: SubmissionReceipt): Promise<void> {
    const key = this.queue.key();
    const receipts = await this.store.getReceipts(key);
    await this.store.saveReceipts(key, [...receipts.filter((candidate) => candidate.id !== receipt.id), receipt]);
  }

  private async completeAnnouncement(receipt: SubmissionReceipt): Promise<void> {
    try {
      await this.finishAnnouncement(receipt);
      receipt.announcementError = undefined;
    } catch (error) {
      receipt.announcementError = error instanceof Error ? error.message : "Review announcement could not be completed";
    }
  }
}

function replaceDraft(drafts: ReviewDraft[], id: string, changes: Partial<ReviewDraft>): ReviewDraft[] {
  return drafts.map((draft) => draft.id === id ? { ...draft, ...changes, updatedAt: new Date().toISOString() } : draft);
}
