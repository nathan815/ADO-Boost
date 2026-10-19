import { reviewStatusFor, reviewStatusLabels, type ReviewActivity } from "../core/review-activity";
import { parsePrRoute } from "../core/route";

interface ReviewActivitySource {
  list(): Promise<ReviewActivity[]>;
  subscribe(listener: () => void): () => void;
}

export class PullRequestListReviewStatus {
  private entries: ReviewActivity[] = [];
  private observer: MutationObserver | undefined;
  private unsubscribe: (() => void) | undefined;
  private active = false;
  private generation = 0;

  constructor(private readonly source: ReviewActivitySource) {}

  start(): void {
    this.active = true;
    this.unsubscribe = this.source.subscribe(() => void this.load());
    this.observer = new MutationObserver(() => this.scan());
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
    if (!document.getElementById("adopp-list-review-styles")) {
      const style = document.createElement("style");
      style.id = "adopp-list-review-styles";
      style.textContent = `
        a[data-adopp-review-status="reviewing"] { background-color: color-mix(in srgb, var(--communication-foreground, #0078d4) 10%, transparent); }
        a[data-adopp-review-status="reviewed"] { background-color: color-mix(in srgb, var(--status-success-foreground, #107c10) 8%, transparent); }
        .adopp-list-review-status { display: inline-flex; flex: none; margin-inline-start: 8px; padding: 1px 6px; border: 1px solid currentColor; border-radius: 3px; font: 600 11px/1.4 "Segoe UI", sans-serif; color: var(--communication-foreground, #0078d4); white-space: nowrap; }
        [data-adopp-review-status="reviewed"] .adopp-list-review-status { color: var(--status-success-foreground, #107c10); }
      `;
      document.head.append(style);
    }
    void this.load();
  }

  stop(): void {
    this.active = false;
    this.observer?.disconnect();
    this.unsubscribe?.();
    document.querySelectorAll("[data-adopp-review-status]").forEach((element) => element.removeAttribute("data-adopp-review-status"));
    document.querySelectorAll(".adopp-list-review-status").forEach((element) => element.remove());
  }

  private async load(): Promise<void> {
    const generation = ++this.generation;
    try {
      const entries = await this.source.list();
      if (!this.active || generation !== this.generation) return;
      this.entries = entries;
      this.scan();
    } catch (error) {
      if (this.active && generation === this.generation) console.error("ADO Boost could not load PR review status", error);
    }
  }

  private scan(): void {
    for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href*='/pullrequest/'], a[data-adopp-review-status]")) {
      const route = parsePrRoute(new URL(link.href, location.href));
      const status = route ? reviewStatusFor(route, this.entries) : undefined;
      const mount = link.querySelector(".bolt-table-two-line-cell .bolt-table-two-line-cell-item");
      const badge = link.querySelector(".adopp-list-review-status");
      if (!status || !mount) {
        link.removeAttribute("data-adopp-review-status");
        badge?.remove();
        continue;
      }
      if (link.dataset.adoppReviewStatus !== status) link.dataset.adoppReviewStatus = status;
      if (badge?.textContent === reviewStatusLabels[status] && badge.parentElement === mount) continue;
      badge?.remove();
      const updated = document.createElement("span");
      updated.className = "adopp-list-review-status";
      updated.textContent = reviewStatusLabels[status];
      mount.append(updated);
    }
  }
}
