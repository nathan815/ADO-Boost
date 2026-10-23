import { COMPANION_INSTALL_COMMAND } from "../core/companion-setup";
import { CompanionConnection, type ConnectionDependencies } from "../ui/companion-connection";
import type { CopilotHealth } from "../core/copilot-gateway";

interface SetupDependencies extends ConnectionDependencies {
  copy(text: string): Promise<void>;
  platform: string;
}

export class CompanionSetupPage {
  readonly connection: CompanionConnection;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private pollGeneration = 0;
  private polling = false;
  private showInstall = false;
  private ready = false;

  constructor(private readonly root: HTMLElement, private readonly dependencies: SetupDependencies) {
    root.innerHTML = `
      <section class="connection-success" role="status" hidden><strong>Successfully configured local Copilot connection!</strong><p>You're ready to use Copilot in ADO Boost.</p><button id="show-install" type="button" aria-controls="install-section" aria-expanded="false">Install or repair</button></section>
      <section id="install-section" class="install-focus" aria-labelledby="install-title">
        <h2 id="install-title">Install Copilot companion</h2>
        <p class="install-intro">Copy the command, paste it into PowerShell, and follow the prompts.</p>
        <div class="install-action"><button id="copy-command" class="primary" type="button">Copy install command</button><output id="copy-status" aria-live="polite"></output></div>
        <label for="install-command">Run in PowerShell</label><textarea id="install-command" readonly rows="3" spellcheck="false"></textarea>
        <p class="install-note">Setup asks before installing missing prerequisites and guides you through sign-in.</p>
        <p id="platform-note" class="muted"></p>
      </section>
      <details class="setup-help"><summary>Already installed or need help?</summary><p>Run <code>ado-boost setup</code> to sign in or repair the connection. Use <code>ado-boost doctor</code> for diagnostics. For an older ZIP, run <code>.\\ado-boost.cmd doctor</code> from its extracted folder.</p><p>Open a new terminal if the command is not found. After a repair, close other ADO Boost pages and refresh status; reload the extension if needed. You do not need to load a second copy.</p><p>Review scripts as required by your organization. Do not bypass execution policy or security warnings. Copilot requires a subscription and your organization's permission.</p><a href="https://github.com/nathan815/ADO-Boost#optional-copilot-companion" target="_blank" rel="noopener">Companion documentation</a></details>`;
    root.querySelector<HTMLTextAreaElement>("#install-command")!.value = COMPANION_INSTALL_COMMAND;
    root.querySelector("#platform-note")!.textContent = dependencies.platform === "win"
      ? "Windows + Microsoft Edge. Core features work without the companion."
      : "Windows + Microsoft Edge only. This installer does not add native-host support for macOS, Linux, or Chrome.";
    this.connection = new CompanionConnection(root.ownerDocument, {
      health: dependencies.health,
      onHealth: (health) => {
        this.renderConnection(health);
        dependencies.onHealth?.(health);
      }
    });
    root.prepend(this.connection.element);
    root.querySelector("#copy-command")!.addEventListener("click", () => void this.copy());
    root.querySelector("#show-install")!.addEventListener("click", () => {
      this.showInstall = !this.showInstall;
      this.renderInstall();
    });
  }

  refresh(background = false): Promise<void> {
    return this.connection.refresh(background);
  }

  start(): void {
    if (this.polling) return;
    this.polling = true;
    const generation = ++this.pollGeneration;
    const poll = async () => {
      await this.refresh(true);
      if (this.polling && generation === this.pollGeneration) this.pollTimer = setTimeout(() => void poll(), 5_000);
    };
    void poll();
  }

  stop(): void {
    this.polling = false;
    this.pollGeneration++;
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  private renderConnection(health: CopilotHealth): void {
    this.ready = health.connected && health.authenticated;
    if (!this.ready) this.showInstall = false;
    this.root.querySelector<HTMLElement>(".connection-success")!.hidden = !this.ready;
    this.renderInstall();
  }

  private renderInstall(): void {
    this.root.querySelector<HTMLElement>(".install-focus")!.hidden = this.ready && !this.showInstall;
    this.root.querySelector("#show-install")!.setAttribute("aria-expanded", String(this.showInstall));
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
