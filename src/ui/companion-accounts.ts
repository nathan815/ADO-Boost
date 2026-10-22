import type { CompanionAccounts, CompanionAccountsGateway } from "../core/companion-accounts";

export class CompanionAccountSettings {
  readonly element: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly refresh: HTMLButtonElement;
  private readonly status: HTMLOutputElement;
  private state: CompanionAccounts = { accounts: [], selected: null };
  private busy = false;

  constructor(private readonly gateway: CompanionAccountsGateway, document: Document) {
    this.element = document.createElement("div");
    this.element.className = "setting";
    this.element.innerHTML = `<label class="companion-account-control" for="companion-account"><strong>Copilot account</strong><small>Pin the GitHub account used for AI requests. Changing it cancels requests using the previous account. Your other Copilot sessions are unchanged.</small><select id="companion-account" aria-label="Copilot account"></select><output aria-live="polite"></output></label><button type="button">Refresh accounts</button>`;
    this.select = this.element.querySelector("select")!;
    this.refresh = this.element.querySelector("button")!;
    this.status = this.element.querySelector("output")!;
    this.refresh.addEventListener("click", () => void this.load());
    this.select.addEventListener("change", () => {
      const account = this.state.accounts[Number(this.select.value)];
      if (account) void this.perform(() => this.gateway.select(account), "Account saved. New requests use the pinned account.");
    });
    this.render();
  }

  load(): Promise<void> {
    return this.perform(() => this.gateway.list(), "Account list refreshed.");
  }

  private async perform(request: () => Promise<CompanionAccounts>, success: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.status.textContent = "Checking companion accounts...";
    this.render();
    try {
      this.state = await request();
      this.status.textContent = this.state.accounts.length ? success : "No signed-in accounts found. Run ado-boost login, then refresh accounts.";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Companion account request failed";
      this.status.textContent = `${message.replace(/[.!?]+$/, "")}. Run ado-boost doctor and make sure the companion is up to date.`;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private render(): void {
    this.select.replaceChildren();
    const placeholder = this.select.ownerDocument.createElement("option");
    placeholder.value = "";
    placeholder.textContent = this.state.selected ? `Pinned: ${this.state.selected.login} (${this.state.selected.host})` : "Choose an account";
    placeholder.disabled = true;
    placeholder.selected = true;
    this.select.append(placeholder);
    this.state.accounts.forEach((account, index) => {
      const option = this.select.ownerDocument.createElement("option");
      option.value = String(index);
      option.textContent = `${account.login} (${account.host})`;
      option.selected = account.login.toLowerCase() === this.state.selected?.login.toLowerCase() && account.host === this.state.selected?.host;
      this.select.append(option);
    });
    this.select.disabled = this.busy || !this.state.accounts.length;
    this.refresh.disabled = this.busy;
  }
}
