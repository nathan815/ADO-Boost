import { UI_PORT, prPageSchema, workspaceRouteSchema, type ReadRequest, type WorkspaceRequest } from "./protocol";
import { applyWorkspaceTheme } from "./theme";
import { settledPr } from "./profile";

export interface WorkspaceTransport {
  request<T>(request: WorkspaceRequest): Promise<T>;
}

export class WorkspaceClient implements WorkspaceTransport {
  private readonly port = chrome.runtime.connect({ name: UI_PORT });
  private readonly pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private disconnected = false;
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor() {
    this.heartbeat = setInterval(() => {
      if (document.visibilityState === "visible" && !this.disconnected) {
        void this.request({ type: "ping" }).catch((error: unknown) => {
          document.dispatchEvent(new CustomEvent("workspace-disconnected", { detail: error instanceof Error ? error.message : "Workspace disconnected." }));
        });
      }
    }, 20_000);
    this.port.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== "object") return;
      const data = message as Record<string, unknown>;
      if (data.kind === "route") {
        const route = workspaceRouteSchema.safeParse(data);
        if (route.success) document.dispatchEvent(new CustomEvent("workspace-route", { detail: route.data }));
        return;
      }
      if (data.kind === "theme" && data.ok === true) applyWorkspaceTheme(data.data);
      if (typeof data.id !== "string") return;
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      clearTimeout(pending.timer);
      if (data.ok === true) pending.resolve(data.data);
      else {
        const message = typeof data.error === "string" ? data.error : "Workspace operation failed";
        pending.reject(new Error(message));
        if (/signed-in account changed|Sign in to this|organization changed/.test(message)) {
          document.dispatchEvent(new CustomEvent("workspace-disconnected", { detail: message }));
        }
      }
    });
    this.port.onDisconnect.addListener(() => {
      this.disconnected = true;
      clearInterval(this.heartbeat);
      const error = new Error("Workspace disconnected. Reload this Azure DevOps page.");
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.pending.clear();
      document.dispatchEvent(new CustomEvent("workspace-disconnected", { detail: error.message }));
    });
  }

  request<T>(request: WorkspaceRequest): Promise<T> {
    if (this.disconnected) return Promise.reject(new Error("Workspace disconnected. Reload this Azure DevOps page."));
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Workspace request timed out. Refresh to retry."));
      }, 120_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.port.postMessage({ id, request });
    });
  }
}

export class WorkspaceQueries {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  constructor(private readonly transport: WorkspaceTransport, private readonly now: () => number = Date.now) {}

  read<T>(query: ReadRequest, refresh = false, retention: "recent" | "history" = "recent"): Promise<T> {
    const key = JSON.stringify(query);
    const flightKey = JSON.stringify([query, refresh, retention]);
    const pending = this.inFlight.get(flightKey);
    if (pending) return pending as Promise<T>;
    const cacheable = query.kind !== "people" && query.kind !== "identity" && query.kind !== "repositories";
    const promise = (async () => {
      if (!refresh && cacheable) {
        const value = await this.transport.request<T | null>({ type: "cache", key, ...(retention === "history" ? { retention } : {}) });
        if (value !== null) return value;
      }
      const value = await this.transport.request<T>({ type: "read", query });
      if (cacheable) {
        const permanent = retention === "history" && (query.kind !== "prs" || prPageSchema.parse(value).items.every((pr) => settledPr(pr, this.now())));
        await this.transport.request({ type: "cache", key, value, ...(retention === "history" ? { retention, permanent } : {}) });
      }
      return value;
    })().finally(() => this.inFlight.delete(flightKey));
    this.inFlight.set(flightKey, promise);
    return promise;
  }
}
