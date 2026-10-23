import type { CopilotHealth } from "../core/copilot-gateway";

export interface ConnectionDependencies {
  health(background?: boolean): Promise<CopilotHealth>;
  onHealth?(health: CopilotHealth): void;
}

export class CompanionConnection {
  readonly element: HTMLElement;
  readonly indicator: HTMLButtonElement;
  readonly accounts: HTMLElement;
  private checking = false;
  private checked = false;

  constructor(document: Document, private readonly dependencies: ConnectionDependencies) {
    this.element = document.createElement("section");
    this.element.className = "connection-status";
    this.element.dataset.state = "unchecked";
    this.element.setAttribute("aria-labelledby", "connection-title");
    this.element.innerHTML = `
      <div class="section-heading"><div><h2 id="connection-title">Connection status</h2><p id="connection" class="connection-badge" role="status" aria-live="polite">Not checked</p></div><div class="connection-actions"><button id="refresh" type="button">Refresh status</button></div></div>
      <p id="connection-hint" class="muted">Check your local Copilot connection.</p>
      <div class="connection-accounts"></div>
      <details id="connection-details" hidden><summary>Connection details</summary><p id="connection-error" role="alert" hidden></p><dl id="diagnostics"></dl></details>`;
    this.indicator = document.createElement("button");
    this.indicator.type = "button";
    this.indicator.className = "companion-header-status";
    this.indicator.setAttribute("aria-controls", "connection-panel");
    this.indicator.innerHTML = '<span role="status" aria-live="polite"></span>';
    this.renderIndicator(null);
    this.accounts = this.element.querySelector(".connection-accounts")!;
    this.element.querySelector("#refresh")!.addEventListener("click", () => void this.refresh());
  }

  async refresh(background = false): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    const refresh = this.element.querySelector<HTMLButtonElement>("#refresh")!;
    const connection = this.element.querySelector<HTMLElement>("#connection")!;
    const error = this.element.querySelector<HTMLElement>("#connection-error")!;
    const diagnostics = this.element.querySelector("#diagnostics")!;
    const hint = this.element.querySelector<HTMLElement>("#connection-hint")!;
    const detailsPanel = this.element.querySelector<HTMLElement>("#connection-details")!;
    refresh.disabled = true;
    if (!background || !this.checked) {
      this.renderIndicator(null, true);
      connection.textContent = "Checking companion...";
      this.element.dataset.state = "checking";
      hint.textContent = "Checking your local Copilot connection.";
      detailsPanel.hidden = true;
      error.hidden = true;
      error.textContent = "";
      diagnostics.replaceChildren();
    }
    this.element.setAttribute("aria-busy", "true");
    try {
      const health = await this.dependencies.health(background);
      diagnostics.replaceChildren();
      error.textContent = "";
      error.hidden = true;
      this.renderIndicator(health);
      this.dependencies.onHealth?.(health);
      connection.textContent = !health.connected ? "Companion unavailable" : health.authenticated ? "Connected and signed in" : "Companion connected, sign-in or account selection required";
      this.element.dataset.state = !health.connected ? "unavailable" : health.authenticated ? "ready" : "auth-required";
      hint.textContent = !health.connected ? "Install or repair the companion below to connect Copilot."
        : health.authenticated ? "Copilot is ready to use in ADO Boost." : "Run setup to sign in, or select your account below.";
      if (health.detail && (!health.connected || !health.authenticated)) {
        error.textContent = health.detail;
        error.hidden = false;
      }
      const details: Array<[string, string | undefined]> = [
        ["GitHub account", health.login], ["GitHub host", health.host],
        ["Companion version", health.companion?.version], ["Copilot CLI version", health.cliVersion],
        ["Protocol version", health.protocolVersion?.toString()]
      ];
      for (const [label, value] of details) {
        if (!value) continue;
        const term = this.element.ownerDocument.createElement("dt");
        const description = this.element.ownerDocument.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        diagnostics.append(term, description);
      }
      detailsPanel.hidden = error.hidden && !diagnostics.childElementCount;
    } catch (cause) {
      diagnostics.replaceChildren();
      this.dependencies.onHealth?.({ connected: false, authenticated: false });
      this.renderIndicator({ connected: false, authenticated: false });
      connection.textContent = "Companion unavailable";
      this.element.dataset.state = "unavailable";
      hint.textContent = "Install or repair the companion below to connect Copilot.";
      error.textContent = cause instanceof Error ? cause.message : "Companion status check failed";
      error.hidden = false;
      detailsPanel.hidden = false;
    } finally {
      this.checking = false;
      this.checked = true;
      refresh.disabled = false;
      this.element.setAttribute("aria-busy", "false");
    }
  }

  private renderIndicator(health: CopilotHealth | null, checking = false): void {
    const status = checking ? "Checking" : !health ? "Not checked" : !health.connected ? "Copilot not set up" : health.authenticated ? "Connected" : "Needs login";
    const login = !checking && health?.connected && health.authenticated ? health.login : undefined;
    this.indicator.dataset.state = checking ? "checking" : !health ? "unchecked" : !health.connected ? "unavailable" : health.authenticated ? "ready" : "auth-required";
    this.indicator.querySelector("span")!.textContent = login || status;
    const label = `Local Copilot: ${status}${login ? `, signed in as ${login}${health?.host ? ` (${health.host})` : ""}` : ""}`;
    this.indicator.setAttribute("aria-label", `${label}. Open Copilot Connection`);
    this.indicator.title = label;
  }
}
