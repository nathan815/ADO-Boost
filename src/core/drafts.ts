import type { BrowserStore } from "../adapters/browser";
import type { PullRequestContext, ReviewDraft } from "./types";

export class DraftQueue {
  constructor(
    private readonly store: BrowserStore,
    private readonly context: PullRequestContext
  ) {}

  key(): string {
    return `${this.context.origin}/${this.context.repositoryId}/${this.context.pullRequestId}/${this.context.reviewer.id}`;
  }

  async list(): Promise<ReviewDraft[]> {
    return this.store.getDrafts(this.key());
  }

  async add(input: Pick<ReviewDraft, "kind" | "body" | "path" | "line" | "side" | "trackingId" | "threadId"> & Partial<Pick<ReviewDraft, "source">>): Promise<ReviewDraft> {
    const now = new Date().toISOString();
    const draft: ReviewDraft = {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      kind: input.kind,
      source: input.source ?? "manual",
      body: input.body,
      ...(input.path ? { path: input.path } : {}),
      ...(input.line ? { line: input.line } : {}),
      ...(input.side ? { side: input.side } : {}),
      ...(input.trackingId !== undefined ? { trackingId: input.trackingId } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      comparisonIdentity: this.context.identity,
      createdAt: now,
      updatedAt: now,
      delivery: "pending"
    };
    await this.store.mutateDrafts(this.key(), { kind: "append", draft });
    return draft;
  }

  async update(id: string, changes: Partial<Pick<ReviewDraft, "body" | "path" | "line" | "side">>): Promise<void> {
    await this.store.mutateDrafts(this.key(), {
      kind: "update",
      id,
      changes: { ...changes, updatedAt: new Date().toISOString(), delivery: "pending", error: undefined }
    });
  }

  async remove(id: string): Promise<void> {
    await this.store.mutateDrafts(this.key(), { kind: "remove", id });
  }

  async replace(drafts: ReviewDraft[]): Promise<void> {
    await this.store.mutateDrafts(this.key(), { kind: "replace", drafts });
  }

  subscribe(listener: (drafts: ReviewDraft[]) => void): () => void {
    return this.store.subscribeDrafts(this.key(), listener);
  }

  stale(draft: ReviewDraft): boolean {
    return draft.comparisonIdentity !== this.context.identity;
  }

}
