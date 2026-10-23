import type { CopilotHealth } from "../core/copilot-gateway";
import { companionSetupLink } from "./companion-setup-link";

export class CompanionStatus {
  readonly element: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private readonly details: HTMLElement;
  private readonly refreshButton: HTMLButtonElement;
  private readonly listeners = new AbortController();
  private health: CopilotHealth | null = null;
  private checking = false;
  private checked = false;
  private error = "";
  private expanded = false;
  private reopen = false;
  private focused: HTMLElement | null = null;
  private destroyed = false;

  constructor(private readonly request: () => Promise<CopilotHealth>, document: Document) {
    this.element = document.createElement("div");
    this.element.className = "companion-status";
    this.element.innerHTML = `<button class="companion-toggle" type="button" aria-controls="companion-details" aria-haspopup="dialog" aria-expanded="false"><span class="companion-dot" aria-hidden="true"></span><span class="grouping-spinner" aria-hidden="true" hidden></span><span class="companion-label" role="status" aria-live="polite"></span></button><section id="companion-details" class="companion-popover" popover="auto" role="dialog" aria-labelledby="companion-heading"><div class="section-head"><h3 id="companion-heading">Copilot companion</h3><button type="button" class="secondary companion-refresh">Refresh</button></div><p class="companion-detail-status" role="status" aria-live="polite"></p><p class="muted companion-login" hidden></p><p class="companion-error" role="alert" hidden></p><p class="muted companion-hint" hidden></p></section>`;
    this.toggle = this.element.querySelector<HTMLButtonElement>(".companion-toggle")!;
    this.details = this.element.querySelector<HTMLElement>(".companion-popover")!;
    this.details.append(companionSetupLink(document));
    this.refreshButton = this.element.querySelector<HTMLButtonElement>(".companion-refresh")!;
    this.toggle.addEventListener("click", () => {
      if (this.close()) return;
      this.position();
      this.details.showPopover();
      this.expanded = true;
      this.toggle.setAttribute("aria-expanded", "true");
      this.refreshButton.focus();
      this.checkOnce();
    });
    this.details.addEventListener("beforetoggle", (event) => {
      this.expanded = (event as ToggleEvent).newState === "open";
      this.toggle.setAttribute("aria-expanded", String(this.expanded));
    });
    this.refreshButton.addEventListener("click", () => void this.refresh());
    document.defaultView?.addEventListener("resize", () => { if (this.expanded) this.position(); }, { signal: this.listeners.signal });
    this.render();
  }

  checkOnce(): void {
    if (!this.checked) void this.refresh();
  }

  detach(): void {
    const root = this.element.getRootNode();
    this.focused = root instanceof ShadowRoot && root.activeElement instanceof HTMLElement && this.element.contains(root.activeElement) ? root.activeElement : null;
    this.reopen = this.expanded;
    if (this.expanded) this.details.hidePopover();
    this.expanded = false;
    this.toggle.setAttribute("aria-expanded", "false");
    this.element.remove();
  }

  mount(container: HTMLElement | null): void {
    if (container) {
      container.append(this.element);
      if (this.reopen) {
        this.position();
        this.details.showPopover();
        this.expanded = true;
        this.toggle.setAttribute("aria-expanded", "true");
      }
      this.focused?.focus();
    }
    this.reopen = false;
    this.focused = null;
  }

  close(): boolean {
    if (!this.expanded) return false;
    this.details.hidePopover();
    this.expanded = false;
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.focus();
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.abort();
    this.close();
    this.element.remove();
  }

  private async refresh(): Promise<void> {
    if (this.checking || this.destroyed) return;
    this.checking = true;
    this.checked = true;
    this.error = "";
    this.render();
    try {
      const health = await this.request();
      if (!this.destroyed) this.health = health;
    } catch (error) {
      if (this.destroyed) return;
      this.health = null;
      this.error = error instanceof Error ? error.message : "Companion connection failed";
    } finally {
      if (!this.destroyed) {
        this.checking = false;
        this.render();
      }
    }
  }

  private render(): void {
    const status = this.checking ? "Checking" : this.error || this.health && !this.health.connected ? "Unavailable"
      : !this.health ? "Not checked" : this.health.authenticated ? "Connected" : "Needs login";
    this.toggle.dataset.state = this.checking ? "checking" : !this.health ? this.error ? "unavailable" : "unknown"
      : !this.health.connected ? "unavailable" : this.health.authenticated ? "connected" : "login";
    this.toggle.setAttribute("aria-label", `Copilot companion: ${status}`);
    this.element.querySelector(".companion-label")!.textContent = status;
    this.element.querySelector(".companion-detail-status")!.textContent = status;
    this.element.querySelector<HTMLElement>(".companion-dot")!.hidden = this.checking;
    this.element.querySelector<HTMLElement>(".grouping-spinner")!.hidden = !this.checking;
    this.refreshButton.disabled = this.checking;
    const setMessage = (selector: string, text: string) => {
      const node = this.element.querySelector<HTMLElement>(selector)!;
      node.textContent = text;
      node.hidden = !text;
    };
    setMessage(".companion-login", !this.checking && this.health?.connected && this.health.authenticated && this.health.login ? `Signed in as ${this.health.login}` : "");
    setMessage(".companion-error", this.error);
    setMessage(".companion-hint", this.error ? "Run ado-boost doctor, then refresh."
      : !this.checking && this.health?.connected && !this.health.authenticated ? this.health.detail ?? "Run ado-boost setup to sign in and finish setup, then refresh." : "");
  }

  private position(): void {
    const view = this.element.ownerDocument.defaultView!;
    const bounds = this.toggle.getBoundingClientRect();
    const width = Math.min(300, view.innerWidth - 24);
    this.details.style.width = `${width}px`;
    this.details.style.left = `${Math.max(12, Math.min(bounds.right - width, view.innerWidth - width - 12))}px`;
    this.details.style.top = `${bounds.bottom + 8}px`;
    this.details.style.maxHeight = `${Math.max(80, view.innerHeight - bounds.bottom - 20)}px`;
  }
}
