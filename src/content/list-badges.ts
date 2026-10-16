import type { PullRequestListStat, PullRequestListStatService } from "../core/list-stats";
import { parsePrRoute } from "../core/route";
import type { PrRoute } from "../core/types";
import { lineCountParts } from "../core/line-counts";

const MAX_VISIBLE_ANALYSES = 4;
const STYLE_ID = "adopp-list-badge-styles";

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
  private readonly resolved = new Set<string>();
  private running = 0;
  private scheduledScan = 0;
  private readonly queue: QueuedAnalysis[] = [];
  private readonly pending = new WeakMap<HTMLAnchorElement, string>();
  private readonly badges = new WeakMap<HTMLAnchorElement, MountedBadge>();

  constructor(private readonly stats: PullRequestListStatService) {}

  start(): void {
    ensureStyles();
    void this.stats.prune().catch((error) => {
      console.warn("ADO Boost could not prune cached PR list stats", error);
    });
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
      if (mounted?.element.isConnected && mounted.key !== key) mounted.element.remove();
      const cached = this.stats.peek(route);
      if (cached) {
        const fresh = this.stats.isFresh(cached);
        this.attach(link, key, statText(cached), statTitle(cached, fresh ? "fresh" : "checking"));
        if (fresh) {
          this.resolved.add(key);
          continue;
        }
      }
      if (this.resolved.has(key) || this.pending.get(link) === key) continue;
      const priority = viewportPriority(link);
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
    if (this.controller.signal.aborted || !linkMatchesKey(link, key)) return;
    const cached = this.stats.peek(route) ?? await this.stats.getCached(route);
    if (this.controller.signal.aborted || !linkMatchesKey(link, key)) return;
    let badge: HTMLElement | null;
    if (cached) {
      badge = this.attach(link, key, statText(cached), statTitle(cached, "checking"));
    } else {
      badge = this.attach(link, key, "…", "ADO Boost is calculating changed lines");
    }
    if (!badge) return;
    try {
      const resolution = await this.stats.resolve(route, cached, this.controller.signal);
      if (this.controller.signal.aborted) return;
      this.resolved.add(key);
      if (!this.ownsBadge(link, key, badge)) return;
      setBadgeContent(badge, statText(resolution.stat, resolution.freshness === "unverified"));
      badge.title = resolution.freshness === "unverified"
        ? statTitle(resolution.stat, "unverified", resolution.error)
        : statTitle(resolution.stat, resolution.freshness);
    } catch (error) {
      this.resolved.add(key);
      if (!this.controller.signal.aborted && this.ownsBadge(link, key, badge)) {
        setBadgeContent(badge, cached ? statText(cached, true) : "stats unavailable");
        badge.title = cached
          ? statTitle(cached, "unverified", error instanceof Error ? error.message : "PR validation failed")
          : error instanceof Error ? error.message : "PR analysis failed";
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
    badge.title = title;
    badge.style.cssText = "display:inline-flex;flex:none;align-items:center;gap:4px;margin-inline-start:8px;font:600 11px/1.4 Consolas,'Cascadia Mono',monospace;white-space:nowrap;vertical-align:middle";
    setBadgeContent(badge, text);
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
  return `${route.origin}/${route.organization}/${route.project}/${route.repository}/${route.pullRequestId}`;
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
    badge.style.display = text ? "inline-flex" : "none";
    return;
  }
  const parts = lineCountParts(Number(match[1]), Number(match[2]));
  const children: Node[] = parts.map((part) => {
    const element = document.createElement("span");
    element.className = `adopp-list-badge-${part.kind === "minus" ? "deletions" : "additions"}`;
    element.style.color = part.kind === "minus" ? "var(--status-error-foreground,#a4262c)" : "var(--status-success-foreground,#107c10)";
    element.textContent = part.text;
    return element;
  });
  if (match[3]) children.push(document.createTextNode(parts.length ? " ~" : "~"));
  badge.replaceChildren(...children);
  badge.style.display = children.length ? "inline-flex" : "none";
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes adopp-list-badge-fade-in { from { opacity: .25; } to { opacity: 1; } }
    .adopp-list-badge-additions,.adopp-list-badge-deletions { animation: adopp-list-badge-fade-in 140ms ease-out both; }
    @media (prefers-reduced-motion: reduce) {
      .adopp-list-badge-additions,.adopp-list-badge-deletions { animation: none; }
    }
  `;
  document.head.append(style);
}

function statText(stat: PullRequestListStat, uncertain = false): string {
  return `+${stat.additions} −${stat.deletions}${stat.exact && !uncertain ? "" : " ~"}`;
}

function statTitle(
  stat: PullRequestListStat,
  state: "checking" | "fresh" | "validated" | "recalculated" | "unverified",
  error?: string
): string {
  const base = `${stat.fileCount} files · iteration ${stat.iterationId} · merge-base comparison${stat.exact ? "" : " · partial"} · ${stat.ignoreTrimWhitespace ? "whitespace ignored" : "whitespace included"}`;
  if (state === "checking") return `${base} · checking for updates`;
  if (state === "fresh") return `${base} · cached`;
  if (state === "validated") return `${base} · cache validated`;
  if (state === "recalculated") return base;
  return `${base} · cached result could not be validated${error ? `: ${error}` : ""}`;
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
