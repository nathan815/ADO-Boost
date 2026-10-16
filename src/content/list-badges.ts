import type { PullRequestAnalyzer } from "../core/analyzer";
import { totalStats } from "../core/diff";
import { parsePrRoute } from "../core/route";
import type { PrRoute } from "../core/types";

const MAX_VISIBLE_ANALYSES = 4;

interface QueuedAnalysis {
  link: HTMLAnchorElement;
  route: PrRoute;
  key: string;
  priority: number;
}

interface MountedBadge {
  key: string;
  element: HTMLElement;
}

export class PullRequestListBadges {
  private readonly controller = new AbortController();
  private readonly cache = new Map<string, string>();
  private running = 0;
  private scheduledScan = 0;
  private readonly queue: QueuedAnalysis[] = [];
  private readonly pending = new WeakMap<HTMLAnchorElement, string>();
  private readonly badges = new WeakMap<HTMLAnchorElement, MountedBadge>();

  constructor(private readonly analyzer: PullRequestAnalyzer) {}

  start(): void {
    this.scan();
    const observer = new MutationObserver(() => this.scheduleScan());
    observer.observe(document.body, { attributes: true, attributeFilter: ["href"], childList: true, subtree: true });
    document.addEventListener("scroll", this.onScroll, true);
    this.controller.signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  }

  stop(): void {
    this.controller.abort();
    window.clearTimeout(this.scheduledScan);
    document.removeEventListener("scroll", this.onScroll, true);
    document.querySelectorAll(".adopp-list-badge").forEach((element) => element.remove());
  }

  private readonly onScroll = (): void => {
    this.scheduleScan();
  };

  private scheduleScan(): void {
    window.clearTimeout(this.scheduledScan);
    this.scheduledScan = window.setTimeout(() => {
      this.scheduledScan = 0;
      this.scan();
    }, 80);
  }

  private scan(): void {
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a[href*='/pullrequest/']")];
    for (const link of links) {
      if (!isNearViewport(link)) continue;
      const route = parsePrRoute(new URL(link.href, location.href));
      if (!route || route.pullRequestId === parsePrRoute(new URL(location.href))?.pullRequestId) continue;
      const key = routeKey(route);
      const mounted = this.badges.get(link);
      if (mounted?.element.isConnected && mounted.key === key) continue;
      if (mounted?.element.isConnected) mounted.element.remove();
      const cached = this.cache.get(key);
      if (cached) {
        this.attach(link, key, cached, "Cached immutable PR iteration result");
        continue;
      }
      const priority = viewportPriority(link);
      if (this.pending.get(link) === key) {
        const queued = this.queue.find((item) => item.link === link && item.key === key);
        if (queued) queued.priority = priority;
        continue;
      }
      this.pending.set(link, key);
      this.queue.push({ link, route, key, priority });
    }
    this.queue.sort((left, right) => left.priority - right.priority);
    this.pump();
  }

  private pump(): void {
    while (this.running < MAX_VISIBLE_ANALYSES && this.queue.length > 0 && !this.controller.signal.aborted) {
      const item = this.queue.shift()!;
      this.running += 1;
      void this.analyzeLink(item).finally(() => {
        if (this.pending.get(item.link) === item.key) this.pending.delete(item.link);
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async analyzeLink({ link, route, key }: QueuedAnalysis): Promise<void> {
    if (!linkMatchesKey(link, key)) return;
    const cached = this.cache.get(key);
    if (cached) {
      this.attach(link, key, cached, "Cached immutable PR iteration result");
      return;
    }
    const pending = this.attach(link, key, "…", "ADO Boost is calculating changed lines");
    if (!pending) return;
    try {
      const analysis = await this.analyzer.analyze(route, this.controller.signal);
      const totals = totalStats(analysis.files, analysis.unresolvedChanges?.length);
      const text = `+${totals.additions} −${totals.deletions}${totals.exact ? "" : " ~"}`;
      this.cache.set(key, text);
      if (!this.ownsBadge(link, key, pending)) return;
      setBadgeContent(pending, text);
      pending.title = `${analysis.files.length} files · iteration ${analysis.context.iterationId} · merge-base comparison${totals.exact ? "" : " · partial"}`;
    } catch (error) {
      if (!this.controller.signal.aborted && this.ownsBadge(link, key, pending)) {
        setBadgeContent(pending, "stats unavailable");
        pending.title = error instanceof Error ? error.message : "PR analysis failed";
      }
    }
  }

  private attach(link: HTMLAnchorElement, key: string, text: string, title: string): HTMLElement | null {
    const existing = this.badges.get(link);
    if (existing?.element.isConnected && existing.key === key) return existing.element;
    existing?.element.remove();
    const mount = findBadgeMount(link);
    if (!mount) return null;
    const badge = document.createElement("span");
    badge.className = "adopp-list-badge";
    setBadgeContent(badge, text);
    badge.title = title;
    badge.style.cssText = "display:inline-flex;flex:none;align-items:center;gap:4px;margin-inline-start:8px;font:600 11px/1.4 Consolas,'Cascadia Mono',monospace;white-space:nowrap;vertical-align:middle";
    mount.append(badge);
    this.badges.set(link, { key, element: badge });
    return badge;
  }

  private ownsBadge(link: HTMLAnchorElement, key: string, badge: HTMLElement): boolean {
    const mounted = this.badges.get(link);
    return linkMatchesKey(link, key) && mounted?.key === key && mounted.element === badge && badge.isConnected;
  }
}

function routeKey(route: PrRoute): string {
  return `${route.origin}/${route.project}/${route.repository}/${route.pullRequestId}`;
}

function linkMatchesKey(link: HTMLAnchorElement, key: string): boolean {
  const route = parsePrRoute(new URL(link.href, location.href));
  return route !== null && routeKey(route) === key;
}

function findBadgeMount(link: HTMLAnchorElement): HTMLElement | null {
  return link.querySelector<HTMLElement>(".bolt-table-two-line-cell .bolt-table-two-line-cell-item");
}

function setBadgeContent(badge: HTMLElement, text: string): void {
  const match = /^\+(\d+) −(\d+)( ~)?$/.exec(text);
  if (!match) {
    badge.textContent = text;
    return;
  }
  const additions = document.createElement("span");
  additions.className = "adopp-list-badge-additions";
  additions.style.color = "var(--status-success-foreground,#107c10)";
  additions.textContent = `+${match[1]}`;
  const deletions = document.createElement("span");
  deletions.className = "adopp-list-badge-deletions";
  deletions.style.color = "var(--status-error-foreground,#a4262c)";
  deletions.textContent = `−${match[2]}${match[3] ?? ""}`;
  badge.replaceChildren(additions, deletions);
}

function isNearViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const preloadMargin = innerHeight;
  return rect.width > 0
    && rect.height > 0
    && rect.bottom >= -preloadMargin
    && rect.top <= innerHeight + preloadMargin;
}

function viewportPriority(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  if (rect.bottom >= 0 && rect.top <= innerHeight) return 0;
  return Math.min(Math.abs(rect.bottom), Math.abs(rect.top - innerHeight));
}
