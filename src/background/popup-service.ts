import type { CopilotHealth } from "../core/copilot-gateway";
import type { PrSummary, RecentPrService } from "../core/recent-prs";
import { parsePrRoute } from "../core/route";
import { SerialExecutor } from "../core/serial-executor";
import type { PrRoute } from "../core/types";

export type PopupMessage =
  | { channel: "adopp-popup"; kind: "record-visit"; route: unknown }
  | { channel: "adopp-popup"; kind: "list-recent" | "clear-recent" | "health" };

export function isPopupMessage(value: unknown): value is PopupMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.channel === "adopp-popup" && ["record-visit", "list-recent", "clear-recent", "health"].includes(String(message.kind));
}

interface PopupServiceDependencies {
  extensionId: string;
  popupUrl: string;
  history: RecentPrService;
  enabled: () => Promise<boolean>;
  summary: (route: PrRoute) => Promise<PrSummary>;
  health: () => Promise<CopilotHealth>;
  now?: () => number;
}

export class PopupService {
  private readonly writes = new SerialExecutor();

  constructor(private readonly dependencies: PopupServiceDependencies) {}

  async handle(message: PopupMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
    const deps = this.dependencies;
    if (sender.id !== deps.extensionId) throw new Error("Requests are accepted only from this extension");
    if (message.kind === "record-visit") {
      const url = sender.tab?.url;
      const parsed = url ? new URL(url) : null;
      const route = parsed?.protocol === "https:" ? parsePrRoute(parsed) : null;
      if (sender.frameId !== 0 || !route || !matchesRoute(message.route, route)) throw new Error("History updates must match the active PR content script");
      const viewedAt = (deps.now ?? Date.now)();
      return this.writes.run("history", async () => {
        if (!await deps.enabled()) return;
        const summary = await deps.summary(route);
        if (await deps.enabled()) await deps.history.record(summary, viewedAt);
      });
    }
    if (sender.url !== deps.popupUrl) throw new Error("This request is accepted only from the extension popup");
    if (message.kind === "health") return deps.health();
    if (message.kind === "list-recent") return deps.history.list();
    return this.writes.run("history", () => deps.history.clear());
  }
}

function matchesRoute(value: unknown, route: PrRoute): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Object.entries(route).every(([key, expected]) => candidate[key] === expected);
}
