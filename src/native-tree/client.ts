import type { PullRequestAnalysis } from "../core/types";
import { CHANNEL, semanticActionSchema, statusSchema } from "./protocol";
import type { TreeConfiguration, TreeFilters, TreeStatus } from "./protocol";
import { describeDiffPolicy } from "./diff-preferences";
import type { SemanticGroupState } from "../core/semantic-groups";

export interface NativeTreePort {
  readonly status: TreeStatus | null;
  configure(filters: TreeFilters, countsEnabled: boolean): void;
  subscribe(listener: () => void): () => void;
  stop(): void;
}

export class NativeTreeClient implements NativeTreePort {
  status: TreeStatus | null = null;
  private readonly session = crypto.randomUUID();
  private readonly listeners = new Set<() => void>();
  private active = false;
  private timeout = 0;
  private signature = "";
  private unsubscribeSemantic: (() => void) | undefined;
  private lastConfiguration: { filters: TreeFilters; countsEnabled: boolean } | undefined;
  constructor(
    private readonly analysis: PullRequestAnalysis,
    private readonly scope = window,
    private readonly semantic?: SemanticGroupState,
    private readonly regenerate?: () => void
  ) {}

  configure(filters: TreeFilters, countsEnabled: boolean): void {
    this.lastConfiguration = { filters, countsEnabled };
    countsEnabled &&= !this.analysis.countsUpdating;
    const files = this.analysis.files.map(({ path, trackingId, changeType, additions, deletions, state, generated, lockfile }) =>
      ({ path, trackingId, changeType, additions, deletions, state, generated, lockfile }));
    const countDescription = describeDiffPolicy(this.analysis.diffPolicy);
    const semantic = this.semantic?.enabled ? {
      revision: this.semantic.revision,
      groups: (this.semantic.groups ?? []).map((group) => ({
        id: group.id, title: group.title, rationale: group.rationale, paths: group.files.map((file) => file.path)
      })),
      view: this.semantic.view, busy: this.semantic.busy, error: this.semantic.error.slice(0, 1000)
    } : undefined;
    const signature = JSON.stringify({ filters, countsEnabled, files, countDescription, semantic });
    if (this.active && signature === this.signature) return;
    this.signature = signature;
    if (!this.active) {
      this.active = true;
      this.unsubscribeSemantic = this.semantic?.subscribe(() => {
        if (this.lastConfiguration) this.configure(this.lastConfiguration.filters, this.lastConfiguration.countsEnabled);
      });
      this.scope.addEventListener("message", this.onMessage);
      this.timeout = this.scope.setTimeout(() => {
        if (this.status) return;
        this.status = {
          channel: CHANNEL, kind: "status", session: this.session, state: "unavailable",
          detail: "The native page bridge did not respond. Reload the page after updating the extension. No DOM row-hiding fallback is active.",
          fileCount: null
        };
        console.warn("ADO Boost native tree bridge did not respond");
        this.notify();
      }, 15000);
    }
    const context = this.analysis.context;
    const configuration: TreeConfiguration = {
      channel: CHANNEL, kind: "configure", session: this.session,
      page: this.scope.location.origin + this.scope.location.pathname,
      comparison: { iteration: context.iterationId, source: context.sourceCommit, base: context.mergeBaseCommit },
      files, filters, countsEnabled, countDescription, ...(semantic ? { semantic } : {})
    };
    this.scope.postMessage(configuration, this.scope.location.origin);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): void {
    if (!this.active) return;
    this.scope.postMessage({ channel: CHANNEL, kind: "dispose", session: this.session }, this.scope.location.origin);
    this.scope.removeEventListener("message", this.onMessage);
    this.unsubscribeSemantic?.();
    this.unsubscribeSemantic = undefined;
    this.scope.clearTimeout(this.timeout);
    this.active = false;
    this.signature = "";
    this.status = null;
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.scope || event.origin !== this.scope.location.origin) return;
    const action = semanticActionSchema.safeParse(event.data);
    if (action.success) {
      if (action.data.session !== this.session || !this.semantic?.enabled || !this.semantic.available
        || !this.status || !["active", "counts-unavailable"].includes(this.status.state)) return;
      if (action.data.action === "select") this.semantic.select(action.data.view);
      else if (!this.semantic.busy) this.regenerate?.();
      return;
    }
    const parsed = statusSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.session !== this.session) return;
    this.status = parsed.data;
    this.semantic?.setAvailable(parsed.data.state !== "comparison-mismatch");
    this.notify();
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
