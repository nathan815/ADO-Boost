import { parsePrRoute } from "../core/route";
import type { PrRoute } from "../core/types";

export class PrVisitTracker {
  private current = "";

  constructor(private readonly record: (route: PrRoute) => Promise<void>) {}

  update(url: URL, enabled: boolean): Promise<void> {
    const route = enabled ? parsePrRoute(url) : null;
    const key = route ? JSON.stringify([route.organization.toLowerCase(), route.project.toLowerCase(), route.repository.toLowerCase(), route.pullRequestId]) : "";
    if (this.current === key) return Promise.resolve();
    this.current = key;
    return route ? this.record(route) : Promise.resolve();
  }
}
