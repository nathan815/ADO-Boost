import type { AdoApi } from "../adapters/ado-api";
import type { BrowserStore } from "../adapters/browser";
import type { AnnouncementCompletion, AnnouncementRecord, PullRequestContext, ReviewCompletionTrigger, ReviewVote } from "./types";
import { announcementBody } from "./announcement-content";
import { recentPrUrl, type RecentPr } from "./recent-prs";

export class AnnouncementService {
  constructor(
    private readonly api: AdoApi,
    private readonly store: BrowserStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  body(context: PullRequestContext): string {
    return announcementBody(context);
  }

  key(context: PullRequestContext): string {
    return `${context.origin}/${context.repositoryId}/${context.pullRequestId}/${context.reviewer.id}`;
  }

  async status(context: PullRequestContext, signal?: AbortSignal): Promise<AnnouncementRecord | null> {
    const key = this.key(context);
    const local = await this.store.getAnnouncement(key);
    if (local?.status === "posted") {
      if (local.pullRequest) return local;
      const updated = { ...local, pullRequest: this.pullRequest(context, local.postedAt) };
      await this.store.saveAnnouncement(updated);
      return updated;
    }
    const existing = await this.api.findAnnouncement(context, local?.body ?? this.body(context), signal);
    if (existing) {
      const reconciled: AnnouncementRecord = {
        key,
        pullRequest: this.pullRequest(context, existing.postedAt ?? local?.postedAt),
        body: existing.body ?? local?.body ?? this.body(context),
        status: "posted",
        threadId: existing.threadId,
        commentId: existing.commentId,
        postedAt: existing.postedAt ?? local?.postedAt ?? new Date().toISOString()
      };
      await this.store.saveAnnouncement(reconciled);
      return reconciled;
    }
    return local;
  }

  async post(context: PullRequestContext, signal?: AbortSignal): Promise<AnnouncementRecord> {
    const key = this.key(context);
    const existing = await this.status(context, signal);
    if (existing?.status === "posted") return existing;
    if (existing?.status === "posting") throw new Error("A review announcement is already being posted in another tab");
    if (existing?.status === "ambiguous") throw new Error("The previous announcement result is still ambiguous and must be reconciled before retrying");

    const startedAt = new Date().toISOString();
    const body = announcementBody(context, startedAt);
    const inFlight: AnnouncementRecord = { key, status: "posting", body, pullRequest: this.pullRequest(context, startedAt) };
    await this.store.saveAnnouncement(inFlight);
    try {
      const created = await this.api.postAnnouncement(context, body, signal);
      const posted: AnnouncementRecord = {
        ...inFlight,
        status: "posted",
        threadId: created.threadId,
        commentId: created.commentId,
        postedAt: startedAt
      };
      await this.store.saveAnnouncement(posted);
      return posted;
    } catch (error) {
      await this.store.saveAnnouncement({ ...inFlight, status: "ambiguous" });
      throw error;
    }
  }

  async finish(context: PullRequestContext, trigger: ReviewCompletionTrigger, signal?: AbortSignal): Promise<AnnouncementRecord | null> {
    let record = await this.status(context, signal);
    if (record?.status !== "posted" || !record.threadId || !record.commentId) return null;
    const { threadId, commentId } = record;
    let action: { kind: "vote"; vote: ReviewVote } | Extract<ReviewCompletionTrigger, { kind: "submission" }>;
    if (trigger.kind === "vote") {
      const vote = await this.api.getCurrentVote(context, signal);
      if (vote !== 10 && vote !== 5 && vote !== -5 && vote !== -10) return record;
      action = { kind: "vote", vote };
    } else {
      action = trigger;
    }
    const state = await this.api.getAnnouncementState(context, threadId, commentId, record.body, signal);
    const merged = new Map((record.completions ?? []).map((completion) => [completion.id, completion]));
    for (const completion of state.completions) {
      const closed = state.closed || merged.get(completion.id)?.status === "closed";
      merged.set(completion.id, { ...completion, status: closed ? "closed" : "posted" });
    }
    record = { ...record, completions: [...merged.values()] };
    await this.store.saveAnnouncement(record);

    const latestVote = [...state.completions].reverse().find((completion) => completion.kind === "vote");
    let completion = action.kind === "submission"
      ? merged.get(action.submissionId)
      : latestVote?.kind === "vote" && latestVote.vote === action.vote ? merged.get(latestVote.id)
        : [...merged.values()].reverse().find((candidate) => candidate.kind === "vote" && candidate.vote === action.vote && candidate.status !== "closed");
    if (completion?.status === "closed") return record;
    if (completion) {
      if (completion.status === "posting" || completion.status === "ambiguous") {
        throw new Error("The completion reply may already have posted. Check the announcement thread before retrying.");
      }
    } else {
      const at = action.kind === "vote" ? await this.api.getVoteTimestamp(context, action.vote, signal) : this.now().toISOString();
      const common = { id: action.kind === "submission" ? action.submissionId : crypto.randomUUID(), at, status: "posting" as const };
      completion = action.kind === "submission"
        ? { ...common, kind: "submission", commentCount: action.commentCount }
        : { ...common, kind: "vote", vote: action.vote };
      record = await this.saveCompletion(record, completion);
      try {
        const posted = await this.api.postAnnouncementCompletion(context, threadId, commentId, completion, signal);
        completion = { ...completion, status: "posted", commentId: posted.commentId };
        record = await this.saveCompletion(record, completion);
      } catch (error) {
        await this.saveCompletion(record, { ...completion, status: "ambiguous" });
        throw error;
      }
    }
    await this.api.setThreadStatus(context, threadId, 4, signal);
    return this.saveCompletion(record, { ...completion, status: "closed" });
  }

  private async saveCompletion(record: AnnouncementRecord, completion: AnnouncementCompletion): Promise<AnnouncementRecord> {
    const updated = { ...record, completions: [...(record.completions ?? []).filter((candidate) => candidate.id !== completion.id), completion] };
    await this.store.saveAnnouncement(updated);
    return updated;
  }

  private pullRequest(context: PullRequestContext, at?: string): RecentPr {
    return {
      organization: context.organization, project: context.project, repository: context.repository,
      repositoryId: context.repositoryId, pullRequestId: context.pullRequestId, title: context.title,
      url: recentPrUrl(context), viewedAt: at && Number.isFinite(Date.parse(at)) ? Date.parse(at) : this.now().getTime()
    };
  }
}
