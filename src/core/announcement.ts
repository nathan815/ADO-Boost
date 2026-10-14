import type { AdoApi } from "../adapters/ado-api";
import type { BrowserStore } from "../adapters/browser";
import type { AnnouncementRecord, PullRequestContext } from "./types";
import { announcementBody } from "./announcement-content";

export class AnnouncementService {
  constructor(
    private readonly api: AdoApi,
    private readonly store: BrowserStore
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
    if (local?.status === "posted") return local;
    const existing = await this.api.findAnnouncement(context, local?.body ?? this.body(context), signal);
    if (existing) {
      const reconciled: AnnouncementRecord = {
        key,
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
    const inFlight: AnnouncementRecord = { key, status: "posting", body };
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
}
