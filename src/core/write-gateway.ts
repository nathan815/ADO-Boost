import type { AnnouncementRecord, PullRequestContext, ReviewCompletionTrigger, ReviewDecision, SubmissionReceipt } from "./types";
import type { SubmissionResult } from "./submission";

export interface WriteGateway {
  postAnnouncement(route: PullRequestContext): Promise<AnnouncementRecord>;
  finishReview(route: PullRequestContext, trigger?: ReviewCompletionTrigger): Promise<AnnouncementRecord | null>;
  submitReview(route: PullRequestContext, draftIds: string[], decision: ReviewDecision, finishAnnouncement?: boolean): Promise<SubmissionResult>;
  retryDecision(route: PullRequestContext, receipt: SubmissionReceipt): Promise<SubmissionReceipt>;
  setThreadStatus(route: PullRequestContext, threadId: number, status: 1 | 2): Promise<void>;
}

export class RuntimeWriteGateway implements WriteGateway {
  postAnnouncement(route: PullRequestContext): Promise<AnnouncementRecord> {
    return this.send("announcement", { route });
  }

  finishReview(route: PullRequestContext, trigger: ReviewCompletionTrigger = { kind: "vote" }): Promise<AnnouncementRecord | null> {
    return this.send("finish-review", { route, trigger });
  }

  submitReview(route: PullRequestContext, draftIds: string[], decision: ReviewDecision, finishAnnouncement = false): Promise<SubmissionResult> {
    return this.send("submit", { route, draftIds, decision, finishAnnouncement, expectedIdentity: route.identity });
  }

  retryDecision(route: PullRequestContext, receipt: SubmissionReceipt): Promise<SubmissionReceipt> {
    return this.send("retry-decision", { route, receipt, expectedIdentity: route.identity });
  }

  async setThreadStatus(route: PullRequestContext, threadId: number, status: 1 | 2): Promise<void> {
    await this.send("thread-status", { route, threadId, status });
  }

  private async send<T>(kind: string, payload: unknown): Promise<T> {
    const response = await chrome.runtime.sendMessage({ channel: "adopp-write", kind, payload }) as { ok: true; data: T } | { ok: false; error: string };
    if (!response.ok) throw new Error(response.error);
    return response.data;
  }
}
