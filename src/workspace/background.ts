import { z } from "zod";
import { HOST_PORT, UI_PORT, organizationContext, personSchema, requestSchema, workspaceRouteSchema } from "./protocol";
import { WorkspaceStorage } from "./storage";

const sessionSchema = z.object({
  context: z.object({ origin: z.string(), organization: z.string(), base: z.string() }),
  viewer: personSchema, theme: z.record(z.string(), z.string()),
  view: z.enum(["dashboard", "people", "profile", "feed", "projects"]),
  subject: personSchema.nullable()
});

export function workspaceSender(sender: chrome.runtime.MessageSender | undefined, name: string, extension: string) {
  const tab = sender?.tab?.id;
  if (sender?.id !== extension || tab === undefined || !sender.url || !sender.tab?.url || !URL.canParse(sender.url) || !URL.canParse(sender.tab.url)) return null;
  const context = organizationContext(new URL(sender.tab.url));
  if (!context) return null;
  if (name === HOST_PORT && sender.frameId === 0 && organizationContext(new URL(sender.url))?.base === context.base) return { tab, context };
  if (name === UI_PORT && sender.frameId && sender.url === `chrome-extension://${extension}/workspace.html`) return { tab, context };
  return null;
}

export function startWorkspaceService(now: () => number = Date.now): void {
  const hosts = new Map<number, chrome.runtime.Port>();
  let storage: WorkspaceStorage | null = null;
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== HOST_PORT && port.name !== UI_PORT) return;
    const validated = workspaceSender(port.sender, port.name, chrome.runtime.id);
    if (!validated) { port.disconnect(); return; }
    const { tab, context: tabContext } = validated;
    if (port.name === HOST_PORT) {
      hosts.get(tab)?.disconnect();
      hosts.set(tab, port);
      port.onDisconnect.addListener(() => { if (hosts.get(tab) === port) hosts.delete(tab); });
      return;
    }
    const host = hosts.get(tab);
    if (!host) { port.disconnect(); return; }
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    let viewer: string | null = null;
    let disconnected = false;
    const call = (payload: Record<string, unknown>): Promise<unknown> => new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Azure DevOps did not respond. Refresh to retry."));
      }, 60_000);
      pending.set(id, { resolve, reject, timer });
      host.postMessage({ ...payload, id });
    });
    let sessionCheck: Promise<z.infer<typeof sessionSchema>> | null = null;
    let checkingSession = false;
    let sessionFailed = false;
    let verifiedAt = 0;
    const verifySession = (force = false) => {
      if (sessionCheck && (checkingSession || (!force && (sessionFailed || now() - verifiedAt < 30_000)))) return sessionCheck;
      checkingSession = true;
      sessionCheck = call({ kind: "session" }).then((value) => {
        const session = sessionSchema.parse(value);
        if (session.context.base !== tabContext.base) throw new Error("The Azure DevOps organization changed. Reopen the workspace.");
        if (viewer !== null && viewer !== session.viewer.id) throw new Error("The signed-in account changed. Close and reopen the workspace.");
        viewer = session.viewer.id;
        verifiedAt = now();
        sessionFailed = false;
        return session;
      }).catch((error: unknown) => {
        sessionFailed = true;
        throw error;
      }).finally(() => { checkingSession = false; });
      return sessionCheck;
    };
    const forward = (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const data = message as Record<string, unknown>;
      if (data.kind === "verify-session") {
        void verifySession(true).catch((error: unknown) => {
          console.error("ADO Boost session verification failed", error);
          port.disconnect();
        });
        return;
      }
      if (data.kind === "route") {
        const route = workspaceRouteSchema.safeParse(data);
        if (route.success && !disconnected) port.postMessage({ kind: "route", ...route.data });
        return;
      }
      const request = typeof data.id === "string" ? pending.get(data.id) : undefined;
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(String(data.id));
      if (data.ok === true) request.resolve(data.data);
      else request.reject(new Error(typeof data.error === "string" ? data.error : "Workspace request failed"));
    };
    host.onMessage.addListener(forward);
    const disconnect = () => port.disconnect();
    host.onDisconnect.addListener(disconnect);
    port.onDisconnect.addListener(() => {
      disconnected = true;
      host.onMessage.removeListener(forward);
      host.onDisconnect.removeListener(disconnect);
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Workspace closed")); }
      pending.clear();
    });
    port.onMessage.addListener((message: unknown) => {
      const parsed = requestSchema.safeParse(message);
      if (!parsed.success) { port.disconnect(); return; }
      const { id, request } = parsed.data;
      if (pending.size >= 8) { port.postMessage({ id, ok: false, error: "Too many workspace requests. Try again after loading finishes." }); return; }
      if (request.type === "ping" || request.type === "ready") {
        void call({ kind: request.type === "ping" ? "theme" : "ready" }).then((data: unknown) => {
          if (!disconnected) port.postMessage({ id, ok: true, data, ...(request.type === "ping" ? { kind: "theme" } : {}) });
        }).catch((error: unknown) => {
          if (!disconnected) port.postMessage({ id, ok: false, error: error instanceof Error ? error.message : "Workspace initialization failed" });
        });
        return;
      }
      void (async () => {
        const session = await verifySession(request.type === "preferences");
        storage ??= new WorkspaceStorage(indexedDB);
        const partition = WorkspaceStorage.partition(session.context.organization, session.viewer.id);
        if (request.type === "read") return call({ query: request.query });
        if (request.type === "preferences") {
          const preferences = await storage.preferences(partition, request.value);
          return { ...session, preferences };
        }
        if (request.type === "cache") return storage.cache(partition, request.key, request.value, {
          retention: request.retention ?? "recent", permanent: request.permanent ?? false
        });
        if (request.type === "clear-cache") { await storage.clearCache(partition); return null; }
        if (request.type === "navigate") {
          host.postMessage({ kind: "navigate", view: request.view, ...(request.person ? { person: JSON.stringify(request.person) } : {}) });
          return null;
        }
        host.postMessage({ kind: "close" });
        return null;
      })().then((data: unknown) => {
        if (!disconnected) port.postMessage({ id, ok: true, data });
      }).catch((error: unknown) => {
        if (!disconnected) port.postMessage({ id, ok: false, error: error instanceof Error ? error.message : "Workspace operation failed" });
      });
    });
  });
}
