import type { PullRequestAnalysis, ReviewDraft } from "../core/types";
import { DraftQueue } from "../core/drafts";
import type { BrowserStore } from "../adapters/browser";
import {
  DISCUSSION_CHANNEL,
  discussionActionSchema,
  discussionStatusSchema,
  type DiscussionConfiguration,
  type DiscussionStatus
} from "./protocol";

export class NativeDiscussionClient {
  status: DiscussionStatus | null = null;
  private readonly session = crypto.randomUUID();
  private readonly queue: DraftQueue;
  private active = false;
  private enabled = false;
  private commentTimestamps = false;
  private unsubscribeDrafts: (() => void) | null = null;
  private drafts: ReviewDraft[] = [];

  constructor(
    private readonly analysis: PullRequestAnalysis,
    store: BrowserStore,
    private readonly onChange: () => void = () => undefined,
    private readonly scope = window
  ) {
    this.queue = new DraftQueue(store, analysis.context);
  }

  async start(enabled: boolean, commentTimestamps = false): Promise<void> {
    this.enabled = enabled;
    this.commentTimestamps = commentTimestamps;
    if (!this.active) {
      this.active = true;
      this.scope.addEventListener("message", this.onMessage);
      this.unsubscribeDrafts = this.queue.subscribe((drafts) => {
        this.drafts = drafts;
        this.configure(this.enabled);
      });
      this.drafts = await this.queue.list();
    }
    this.configure(enabled);
  }

  update(enabled: boolean, commentTimestamps = false): void {
    this.enabled = enabled;
    this.commentTimestamps = commentTimestamps;
    if (this.active) this.configure(this.enabled);
  }

  stop(): void {
    if (!this.active) return;
    this.scope.postMessage({ channel: DISCUSSION_CHANNEL, kind: "dispose", session: this.session }, this.scope.location.origin);
    this.scope.removeEventListener("message", this.onMessage);
    this.unsubscribeDrafts?.();
    this.unsubscribeDrafts = null;
    this.active = false;
    this.status = null;
  }

  private configure(enabled: boolean): void {
    const context = this.analysis.context;
    const configuration: DiscussionConfiguration = {
      channel: DISCUSSION_CHANNEL,
      kind: "configure",
      session: this.session,
      page: this.scope.location.origin + this.scope.location.pathname,
      reviewer: context.reviewer,
      enabled,
      commentTimestamps: this.commentTimestamps,
      drafts: this.drafts.filter((draft) => draft.delivery !== "posted").map((draft) => ({
        id: draft.id,
        kind: draft.kind,
        source: draft.source ?? "manual",
        body: draft.body,
        ...(draft.path ? { path: draft.path } : {}),
        ...(draft.line ? { line: draft.line } : {}),
        ...(draft.side ? { side: draft.side } : {}),
        ...(draft.trackingId !== undefined ? { trackingId: draft.trackingId } : {}),
        ...(draft.threadId ? { threadId: draft.threadId } : {}),
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        delivery: draft.delivery,
        ...(draft.error ? { error: draft.error } : {})
      }))
    };
    this.scope.postMessage(configuration, this.scope.location.origin);
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.scope || event.origin !== this.scope.location.origin) return;
    const action = discussionActionSchema.safeParse(event.data);
    if (action.success && action.data.session === this.session) {
      void this.applyAction(action.data).catch((error) => {
        console.error("ADO Boost native draft action failed", error);
      });
      return;
    }
    const status = discussionStatusSchema.safeParse(event.data);
    if (!status.success || status.data.session !== this.session) return;
    this.status = status.data;
    this.onChange();
  };

  private async applyAction(action: ReturnType<typeof discussionActionSchema.parse>): Promise<void> {
    if (action.action === "remove") {
      await this.queue.remove(action.id);
      return;
    }
    if (action.action === "update") {
      await this.queue.update(action.id, { body: action.body });
      return;
    }
    const input = action.draft;
    if (input.kind === "reply" && !input.threadId) throw new Error("Reply draft is missing its Azure DevOps thread");
    let trackingId: number | undefined;
    if (input.kind === "inline") {
      if (!input.path || !input.line) throw new Error("Inline draft is missing its file location");
      trackingId = this.analysis.files.find((file) => file.path === input.path)?.trackingId;
      if (trackingId === undefined) throw new Error("Inline draft does not match a changed file");
    }
    await this.queue.add({
      kind: input.kind,
      body: input.body,
      ...(input.path ? { path: input.path } : {}),
      ...(input.line ? { line: input.line } : {}),
      ...(input.side ? { side: input.side } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(trackingId !== undefined ? { trackingId } : {})
    });
  }
}
