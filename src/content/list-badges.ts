import type { PullRequestAnalyzer } from "../core/analyzer";
import { totalStats } from "../core/diff";
import { parsePrRoute } from "../core/route";

const MAX_VISIBLE_ANALYSES = 4;

export class PullRequestListBadges {
  private readonly controller = new AbortController();
  private readonly cache = new Map<string, string>();
  private running = 0;
  private readonly queue: HTMLAnchorElement[] = [];
  private readonly seen = new WeakSet<HTMLAnchorElement>();

  constructor(private readonly analyzer: PullRequestAnalyzer) {}

  start(): void {
    this.scan();
    const observer = new MutationObserver(() => this.scan());
    observer.observe(document.body, { childList: true, subtree: true });
    this.controller.signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  }

  stop(): void {
    this.controller.abort();
    document.querySelectorAll(".adopp-list-badge").forEach((element) => element.remove());
  }

  private scan(): void {
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a[href*='/pullrequest/']")];
    for (const link of links) {
      if (this.seen.has(link) || !isVisible(link)) continue;
      const route = parsePrRoute(new URL(link.href, location.href));
      if (!route || route.pullRequestId === parsePrRoute(new URL(location.href))?.pullRequestId) continue;
      this.seen.add(link);
      this.queue.push(link);
    }
    this.pump();
  }

  private pump(): void {
    while (this.running < MAX_VISIBLE_ANALYSES && this.queue.length > 0 && !this.controller.signal.aborted) {
      const link = this.queue.shift()!;
      this.running += 1;
      void this.analyzeLink(link).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async analyzeLink(link: HTMLAnchorElement): Promise<void> {
    const route = parsePrRoute(new URL(link.href, location.href));
    if (!route) return;
    const key = `${route.origin}/${route.project}/${route.repository}/${route.pullRequestId}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.attach(link, cached, "Cached immutable PR iteration result");
      return;
    }
    const pending = this.attach(link, "…", "AzureDevOps++ is calculating changed lines");
    try {
      const analysis = await this.analyzer.analyze(route, this.controller.signal);
      const totals = totalStats(analysis.files);
      const text = `+${totals.additions} −${totals.deletions}${totals.exact ? "" : " ~"}`;
      this.cache.set(key, text);
      pending.textContent = text;
      pending.title = `${analysis.files.length} files · iteration ${analysis.context.iterationId} · merge-base comparison${totals.exact ? "" : " · partial"}`;
    } catch (error) {
      if (!this.controller.signal.aborted) {
        pending.textContent = "stats unavailable";
        pending.title = error instanceof Error ? error.message : "PR analysis failed";
      }
    }
  }

  private attach(link: HTMLAnchorElement, text: string, title: string): HTMLElement {
    const existing = link.parentElement?.querySelector<HTMLElement>(".adopp-list-badge");
    if (existing) return existing;
    const badge = document.createElement("span");
    badge.className = "adopp-list-badge";
    badge.textContent = text;
    badge.title = title;
    badge.style.cssText = "display:inline-block;margin-inline-start:7px;padding:1px 5px;border:1px solid currentColor;border-radius:3px;font:600 11px Consolas,'Cascadia Mono',monospace;opacity:.82;vertical-align:middle";
    link.insertAdjacentElement("afterend", badge);
    return badge;
  }
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= innerHeight;
}
