import { FetchHttpClient } from "../adapters/ado-api";
import { WorkspaceApi } from "./api";
import { HOST_PORT, organizationContext, readSchema, workspaceRoute } from "./protocol";
import { workspaceColorScheme, workspaceThemeTokens } from "./theme";

export class WorkspaceHost {
  private entry: HTMLAnchorElement | null = null;
  private frame: HTMLIFrameElement | null = null;
  private surface: HTMLDivElement | null = null;
  private port: chrome.runtime.Port | null = null;
  private controller: AbortController | null = null;
  private hidden: HTMLElement | null = null;
  private focus: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private enabled = false;
  private scheduled = false;
  private connectionLost = false;
  private compatibility: HTMLParagraphElement | null = null;
  private readonly collapsedNavigation = new Set<HTMLElement>();
  private homeNavigation: { destination: URL; sourcePath: string; timer: ReturnType<typeof setInterval> } | null = null;
  private navigationNotice: HTMLParagraphElement | null = null;
  private readonly verifySession = () => { this.port?.postMessage({ kind: "verify-session" }); };
  private readonly visibilityChanged = () => {
    if (document.visibilityState !== "visible") return;
    if (this.connectionLost) { this.close(); this.reconcile(); }
    else this.verifySession();
  };
  private readonly check = () => {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.reconcile(); });
  };

  start(): void {
    this.observer = new MutationObserver(this.check);
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-expanded"] });
    addEventListener("popstate", this.check);
    addEventListener("focus", this.verifySession);
    document.addEventListener("visibilitychange", this.visibilityChanged);
  }

  update(enabled: boolean): void { this.enabled = enabled; this.reconcile(); }

  stop(): void {
    this.enabled = false;
    this.observer?.disconnect();
    removeEventListener("popstate", this.check);
    removeEventListener("focus", this.verifySession);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.close();
    this.cancelHomeNavigation();
    this.navigationNotice?.remove();
    this.entry?.remove();
    this.entry = null;
  }

  private reconcile(): void {
    const context = organizationContext(new URL(location.href));
    const nav = document.querySelector(".project-navigation .navigation-section") ?? document.querySelector(".project-navigation") ?? document.querySelector(".region-header");
    if (!this.enabled || !context) {
      this.entry?.remove(); this.close(); this.cancelHomeNavigation(); this.navigationNotice?.remove();
      return;
    }
    if (this.homeNavigation) {
      const { destination, sourcePath } = this.homeNavigation;
      if (location.pathname === destination.pathname && document.querySelector("#__bolt-ms-vss-web-home-hub-group-link.displayed")) {
        this.cancelHomeNavigation();
        history.replaceState(history.state, "", destination);
      } else if (location.pathname !== sourcePath && location.pathname !== destination.pathname) this.cancelHomeNavigation();
      else return;
    }
    if (nav && (!this.entry?.isConnected || this.entry.parentElement !== nav)) {
      this.entry?.remove();
      this.entry = document.createElement("a");
      const icon = document.createElement("img");
      icon.src = chrome.runtime.getURL("icons/ado-boost.svg");
      icon.alt = "";
      icon.width = 24; icon.height = 24;
      const iconContainer = document.createElement("span");
      iconContainer.className = "navigation-icon flex-row flex-center flex-noshrink justify-center";
      iconContainer.append(icon);
      const label = document.createElement("span");
      label.textContent = "PR Hub";
      label.className = "navigation-text expanded-only text-ellipsis flex-grow";
      this.entry.append(iconContainer, label);
      this.entry.title = "PR Hub - ADO Boost";
      this.entry.setAttribute("aria-label", "PR Hub");
      if (nav.getAttribute("role") === "menubar") this.entry.setAttribute("role", "menuitem");
      this.entry.href = this.workspaceUrl("dashboard");
      this.entry.dataset.adoBoostWorkspace = "entry";
      this.entry.className = "ado-boost-workspace-entry hub-group navigation-element navigation-link focus-treatment flex-row flex-center flex-noshrink bolt-link no-underline-link";
      this.entry.style.cssText = "display:flex;align-items:center;flex-shrink:0;min-height:48px;color:inherit;text-decoration:none;font:600 14px 'Segoe UI',sans-serif";
      this.entry.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        this.navigationNotice?.remove();
        const destination = this.workspaceUrl("dashboard");
        if (new URL(destination).pathname !== location.pathname) { this.openOverview(new URL(destination)); return; }
        if (destination !== location.href) history.pushState(null, "", destination);
        this.reconcile();
      });
      nav.prepend(this.entry);
    }
    if (this.entry) this.entry.href = this.workspaceUrl("dashboard");
    const view = new URL(location.href).searchParams.get("adoBoost");
    if (this.entry) {
      if (view) this.entry.setAttribute("aria-current", "page");
      else this.entry.removeAttribute("aria-current");
      this.entry.style.boxShadow = view ? "inset 3px 0 var(--communication-background, #0078d4)" : "";
      this.entry.style.background = view ? "rgba(0,120,212,.08)" : "";
    }
    if (!view) { this.close(); return; }
    const content = document.querySelector<HTMLElement>(".region-content");
    if (!content?.parentElement) {
      if (nav && !this.compatibility?.isConnected) {
        this.compatibility = document.createElement("p");
        this.compatibility.setAttribute("role", "status");
        this.compatibility.textContent = "ADO Boost could not find a compatible content region. Open an ADO project or reload this page.";
        nav.append(this.compatibility);
        console.warn("ADO Boost workspace is waiting for the native content region");
      }
      return;
    }
    this.compatibility?.remove();
    this.compatibility = null;
    const route = `${view}|${new URL(location.href).searchParams.get("adoBoostPerson") ?? ""}`;
    if (this.frame?.isConnected && this.hidden === content && this.frame.dataset.base === context.base) {
      this.collapseNavigation();
      if (this.frame.dataset.route !== route) {
        this.frame.dataset.route = route;
        this.port?.postMessage({ kind: "route", ...workspaceRoute(new URL(location.href)) });
      }
      return;
    }
    this.close();
    this.focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.hidden = content;
    content.classList.add("ado-boost-workspace-hidden");
    const style = document.createElement("style");
    style.dataset.adoBoostWorkspace = "style";
    style.textContent = `
      .ado-boost-workspace-hidden { display: none !important; }
      .project-navigation:has(.ado-boost-workspace-entry[aria-current="page"]) .hub-group-container > [role="menu"] { display: none; }
      .project-navigation:has(.ado-boost-workspace-entry[aria-current="page"]) .hub-group-container.expanded-container,
      .project-navigation:has(.ado-boost-workspace-entry[aria-current="page"]) .hub-group-container.displayed-container,
      .project-navigation:has(.ado-boost-workspace-entry[aria-current="page"]) .navigation-link.displayed { background-color: transparent; }
      .project-navigation:has(.ado-boost-workspace-entry[aria-current="page"]) .navigation-link.displayed:hover { background-color: var(--nav-vertical-item-hover-background, rgba(0,0,0,.08)); }
      .project-navigation:has(.ado-boost-workspace-entry[aria-current="page"]) .navigation-link.displayed:not(:focus-visible) { border-color: transparent; }
      .project-navigation:has(.ado-boost-workspace-entry[aria-current="page"]) .hub-group-container.displayed-container::before,
      .project-navigation:has(.ado-boost-workspace-entry[aria-current="page"]) .navigation-link.displayed::before { display: none; }
      .project-navigation:has(.ado-boost-workspace-entry[aria-current="page"]) .navigation-link.displayed .navigation-text { font-weight: 400; }
    `;
    const frame = document.createElement("iframe");
    frame.title = "ADO Boost workspace";
    frame.src = chrome.runtime.getURL("workspace.html");
    frame.dataset.base = context.base;
    frame.dataset.route = route;
    frame.style.cssText = "border:0;flex:1;min-width:0;width:100%;height:100%;visibility:hidden";
    this.frame = frame;
    this.surface = document.createElement("div");
    this.surface.dataset.adoBoostWorkspace = "surface";
    this.surface.style.cssText = "display:flex;flex:1;min-width:0;width:100%;height:100%";
    this.updateFrameBackground(content);
    this.surface.append(frame);
    content.parentElement.append(style, this.surface);
    this.collapseNavigation();
    this.controller = new AbortController();
    this.connectionLost = false;
    const signal = this.controller.signal;
    const api = new WorkspaceApi(new FetchHttpClient(), context);
    const port = chrome.runtime.connect({ name: HOST_PORT });
    this.port = port;
    port.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== "object") return;
      const data = message as Record<string, unknown>;
      if (data.kind === "ready") {
        frame.style.visibility = "visible";
        port.postMessage({ id: data.id, ok: true, data: null });
        return;
      }
      if (data.kind === "close") { this.navigate(null); return; }
      if (data.kind === "navigate" && typeof data.view === "string") {
        this.navigate(data.view, typeof data.person === "string" ? data.person : undefined);
        return;
      }
      if (data.kind === "session" || data.kind === "theme") {
        this.updateFrameBackground(content);
        const colors = getComputedStyle(content);
        const theme: Record<string, string> = {};
        for (const key of workspaceThemeTokens) {
          theme[key] = colors.getPropertyValue(key).trim();
        }
        if (data.kind === "theme") { port.postMessage({ id: data.id, ok: true, data: theme }); return; }
        void api.read({ kind: "identity" }, signal).then((viewer) => port.postMessage({
          id: data.id, ok: true, data: { context, viewer, theme, ...workspaceRoute(new URL(location.href)) }
        })).catch((error: unknown) => this.replyError(port, data.id, error, signal));
        return;
      }
      const parsed = readSchema.safeParse(data.query);
      if (!parsed.success) { port.postMessage({ id: data.id, ok: false, error: "Invalid workspace read request" }); return; }
      void api.read(parsed.data, signal).then((result) => {
        if (!signal.aborted) port.postMessage({ id: data.id, ok: true, data: result });
      }).catch((error: unknown) => this.replyError(port, data.id, error, signal));
    });
    port.onDisconnect.addListener(() => {
      if (!signal.aborted) {
        this.connectionLost = true;
        console.error("ADO Boost workspace connection lost", chrome.runtime.lastError?.message);
        frame.title = "ADO Boost disconnected. Reload the page to reconnect.";
        if (document.visibilityState === "visible") setTimeout(() => {
          if (this.connectionLost && !signal.aborted) { this.close(); this.reconcile(); }
        }, 1000);
      }
    });
  }

  private replyError(port: chrome.runtime.Port, id: unknown, error: unknown, signal: AbortSignal): void {
    if (!signal.aborted) port.postMessage({ id, ok: false, error: error instanceof Error ? error.message : "Workspace request failed" });
  }

  private updateFrameBackground(content: HTMLElement): void {
    const colors = getComputedStyle(content);
    const background = colors.getPropertyValue("--background-color").trim() || colors.backgroundColor;
    if (this.surface) this.surface.style.backgroundColor = background;
    if (this.frame) {
      this.frame.style.backgroundColor = background;
      this.frame.style.colorScheme = workspaceColorScheme(background) ?? colors.colorScheme;
    }
  }

  private openOverview(destination: URL): void {
    this.cancelHomeNavigation();
    const overview = document.querySelector<HTMLAnchorElement>(".project-navigation #__bolt-ms-vss-web-home-hub-group-link");
    if (!overview || new URL(overview.href).origin !== destination.origin || new URL(overview.href).pathname !== destination.pathname) {
      this.reportNavigationError("ADO Boost could not find the project's Overview link. Open Overview, then select PR Hub again.");
      return;
    }
    const deadline = Date.now() + 15_000;
    const timer = setInterval(() => {
      if (Date.now() >= deadline) {
        this.cancelHomeNavigation();
        this.reportNavigationError("ADO Boost could not open project Overview. Select Overview, then try PR Hub again.");
      } else this.check();
    }, 100);
    this.homeNavigation = { destination, sourcePath: location.pathname, timer };
    overview.click();
    this.reconcile();
  }

  private cancelHomeNavigation(): void {
    if (this.homeNavigation) clearInterval(this.homeNavigation.timer);
    this.homeNavigation = null;
  }

  private reportNavigationError(message: string): void {
    console.error(message);
    this.navigationNotice?.remove();
    this.navigationNotice = document.createElement("p");
    this.navigationNotice.setAttribute("role", "alert");
    this.navigationNotice.textContent = message;
    this.entry?.after(this.navigationNotice);
  }

  private workspaceUrl(view: string): string {
    const current = new URL(location.href);
    const context = organizationContext(current);
    if (!context) throw new Error("PR Hub requires an Azure DevOps organization.");
    const project = current.pathname.split("/").filter(Boolean)[current.hostname === "dev.azure.com" ? 1 : 0];
    const url = new URL(context.base);
    if (project && !project.startsWith("_")) url.pathname = `${url.pathname.replace(/\/$/, "")}/${project}`;
    url.searchParams.set("adoBoost", view);
    return url.href;
  }

  private navigate(view: string | null, person?: string): void {
    const url = new URL(location.href);
    if (view) url.searchParams.set("adoBoost", view);
    else url.searchParams.delete("adoBoost");
    if (person) url.searchParams.set("adoBoostPerson", person);
    else url.searchParams.delete("adoBoostPerson");
    if (url.href !== location.href) history.pushState(null, "", url);
    this.reconcile();
  }

  private collapseNavigation(): void {
    for (const toggle of document.querySelectorAll<HTMLElement>('.project-navigation .hub-group[aria-expanded="true"]')) {
      this.collapsedNavigation.add(toggle);
      toggle.setAttribute("aria-expanded", "false");
    }
  }

  private close(): void {
    this.compatibility?.remove();
    this.compatibility = null;
    this.controller?.abort();
    this.controller = null;
    this.port?.disconnect();
    this.port = null;
    this.frame?.remove();
    this.frame = null;
    this.surface?.remove();
    this.surface = null;
    document.querySelectorAll('[data-ado-boost-workspace="style"]').forEach((element) => element.remove());
    for (const toggle of this.collapsedNavigation) {
      if (toggle.getAttribute("aria-expanded") === "false" && toggle.closest(".hub-group-container")?.classList.contains("expanded-container")) {
        toggle.setAttribute("aria-expanded", "true");
      }
    }
    this.collapsedNavigation.clear();
    this.hidden?.classList.remove("ado-boost-workspace-hidden");
    this.hidden = null;
    this.focus?.focus({ preventScroll: true });
    this.focus = null;
  }
}
