import type { CopilotHealth } from "../core/copilot-gateway";
import { COMPANION_INSTALL_COMMAND } from "../core/companion-setup";

interface SetupDependencies {
  health(): Promise<CopilotHealth>;
  copy(text: string): Promise<void>;
  platform: string;
  onHealth?(health: CopilotHealth): void;
}

export class CompanionSetupPage {
  private checking = false;

  constructor(private readonly root: HTMLElement, private readonly dependencies: SetupDependencies) {
    root.innerHTML = `
      <section class="connection-status" data-state="unchecked" aria-labelledby="connection-title">
        <div class="section-heading"><div><h2 id="connection-title">Connection status</h2><p id="connection" class="connection-badge" role="status" aria-live="polite">Not checked</p></div><button id="refresh" type="button">Refresh status</button></div>
        <p id="connection-hint" class="muted">Check your local Copilot connection.</p>
        <details id="connection-details" hidden><summary>Connection details</summary><p id="connection-error" role="alert" hidden></p><dl id="diagnostics"></dl></details>
      </section>
      <section class="install-focus" aria-labelledby="install-title">
        <h2 id="install-title">Install Copilot companion</h2>
        <p class="install-intro">Copy the command, paste it into PowerShell, and follow the prompts.</p>
        <div class="install-action"><button id="copy-command" class="primary" type="button">Copy install command</button><output id="copy-status" aria-live="polite"></output></div>
        <label for="install-command">Run in PowerShell</label><textarea id="install-command" readonly rows="3" spellcheck="false"></textarea>
        <p class="install-note">Setup asks before installing missing prerequisites and guides you through sign-in.</p>
        <p id="platform-note" class="muted"></p>
        <p class="install-next">Once setup finishes, <button id="check-after-install" class="text-button" type="button">refresh status</button> and enable Copilot features in the <a href="#settings">Settings tab</a>.</p>
      </section>
      <details class="setup-help"><summary>Already installed or need help?</summary><p>Run <code>ado-boost setup</code> to sign in or repair the connection. Use <code>ado-boost doctor</code> for diagnostics. For an older ZIP, run <code>.\\ado-boost.cmd doctor</code> from its extracted folder.</p><p>Open a new terminal if the command is not found. After a repair, close other ADO Boost pages and refresh status; reload the extension if needed. You do not need to load a second copy.</p><p>Review scripts as required by your organization. Do not bypass execution policy or security warnings. Copilot requires a subscription and your organization's permission.</p><a href="https://github.com/nathan815/ADO-Boost#optional-copilot-companion" target="_blank" rel="noopener">Companion documentation</a></details>`;
    root.querySelector<HTMLTextAreaElement>("#install-command")!.value = COMPANION_INSTALL_COMMAND;
    root.querySelector("#platform-note")!.textContent = dependencies.platform === "win"
      ? "Windows + Microsoft Edge. Core features work without the companion."
      : "Windows + Microsoft Edge only. This installer does not add native-host support for macOS, Linux, or Chrome.";
    root.querySelector("#refresh")!.addEventListener("click", () => void this.refresh());
    root.querySelector("#copy-command")!.addEventListener("click", () => void this.copy());
    root.querySelector("#check-after-install")!.addEventListener("click", () => void this.refresh());
  }

  async refresh(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    const refresh = this.root.querySelector<HTMLButtonElement>("#refresh")!;
    const connection = this.root.querySelector<HTMLElement>("#connection")!;
    const error = this.root.querySelector<HTMLElement>("#connection-error")!;
    const diagnostics = this.root.querySelector("#diagnostics")!;
    const card = this.root.querySelector<HTMLElement>(".connection-status")!;
    const hint = this.root.querySelector<HTMLElement>("#connection-hint")!;
    const detailsPanel = this.root.querySelector<HTMLElement>("#connection-details")!;
    refresh.disabled = true;
    connection.textContent = "Checking companion...";
    card.dataset.state = "checking";
    card.setAttribute("aria-busy", "true");
    hint.textContent = "Checking your local Copilot connection.";
    detailsPanel.hidden = true;
    error.hidden = true;
    error.textContent = "";
    diagnostics.replaceChildren();
    try {
      const health = await this.dependencies.health();
      this.dependencies.onHealth?.(health);
      connection.textContent = !health.connected ? "Companion unavailable" : health.authenticated ? "Connected and signed in" : "Companion connected, sign-in or account selection required";
      card.dataset.state = !health.connected ? "unavailable" : health.authenticated ? "ready" : "auth-required";
      hint.textContent = !health.connected ? "Install or repair the companion below to connect Copilot."
        : health.authenticated ? "Copilot is ready to use in ADO Boost." : "Run setup to sign in, or select your account below.";
      if (health.detail) {
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
        const term = this.root.ownerDocument.createElement("dt");
        const description = this.root.ownerDocument.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        diagnostics.append(term, description);
      }
      detailsPanel.hidden = !health.detail && !diagnostics.childElementCount;
    } catch (cause) {
      this.dependencies.onHealth?.({ connected: false, authenticated: false });
      connection.textContent = "Companion unavailable";
      card.dataset.state = "unavailable";
      hint.textContent = "Install or repair the companion below to connect Copilot.";
      error.textContent = cause instanceof Error ? cause.message : "Companion status check failed";
      error.hidden = false;
      detailsPanel.hidden = false;
    } finally {
      this.checking = false;
      refresh.disabled = false;
      card.setAttribute("aria-busy", "false");
    }
  }

  private async copy(): Promise<void> {
    const status = this.root.querySelector<HTMLOutputElement>("#copy-status")!;
    try {
      await this.dependencies.copy(COMPANION_INSTALL_COMMAND);
      status.textContent = "Copied.";
    } catch (error) {
      status.textContent = `${error instanceof Error ? error.message : "Clipboard unavailable"}. Select the command above and copy it manually.`;
    }
  }
}
