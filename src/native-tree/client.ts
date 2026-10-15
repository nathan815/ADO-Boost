import type { PullRequestAnalysis } from "../core/types";
import { CHANNEL, statusSchema } from "./protocol";
import type { TreeConfiguration, TreeFilters, TreeStatus } from "./protocol";

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
  private readonly files;

  constructor(private readonly analysis: PullRequestAnalysis, private readonly scope = window) {
    this.files = analysis.files.map(({ path, trackingId, changeType, additions, deletions, state, generated, lockfile }) =>
      ({ path, trackingId, changeType, additions, deletions, state, generated, lockfile }));
  }

  configure(filters: TreeFilters, countsEnabled: boolean): void {
    const signature = JSON.stringify({ filters, countsEnabled });
    if (this.active && signature === this.signature) return;
    this.signature = signature;
    if (!this.active) {
      this.active = true;
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
      files: this.files, filters, countsEnabled
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
    this.scope.clearTimeout(this.timeout);
    this.active = false;
    this.signature = "";
    this.status = null;
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.scope || event.origin !== this.scope.location.origin) return;
    const parsed = statusSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.session !== this.session) return;
    this.status = parsed.data;
    this.notify();
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
