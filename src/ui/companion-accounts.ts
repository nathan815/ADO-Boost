import type { CompanionAccount, CompanionAccounts, CompanionAccountsGateway } from "../core/companion-accounts";

export class CompanionAccountSettings {
  readonly element: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly status: HTMLOutputElement;
  private state: CompanionAccounts = { accounts: [], selected: null };
  private busy = false;
  private loaded = false;

  constructor(private readonly gateway: CompanionAccountsGateway, document: Document, private readonly onAccountChange?: () => Promise<void>) {
    this.element = document.createElement("div");
    this.element.className = "setting companion-account-setting";
    this.element.innerHTML = `<label for="companion-account"><strong>Copilot account</strong><small>Choose the GitHub account billed for Copilot requests. Your other local Copilot sessions are unchanged.</small></label><div class="companion-account-controls"><select id="companion-account" aria-label="Copilot account"></select></div><output role="alert" hidden></output>`;
    this.select = this.element.querySelector("select")!;
    this.status = this.element.querySelector("output")!;
    this.select.addEventListener("change", () => {
      const account = this.state.accounts[Number(this.select.value)];
      if (account) void this.selectAccount(account);
    });
    this.render();
  }

  load(background = false): Promise<void> {
    return this.perform(() => this.gateway.list(), background);
  }

  private async selectAccount(account: CompanionAccount): Promise<void> {
    if (this.busy) return;
    try {
      await this.perform(() => this.gateway.select(account));
      await this.onAccountChange?.();
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : "Could not change the Copilot account.";
      this.status.hidden = false;
    }
  }

  private async perform(request: () => Promise<CompanionAccounts>, background = false): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    let changed = false;
    if (!background) {
      this.status.textContent = "";
      this.status.hidden = true;
      this.render();
    }
    try {
      const state = await request();
      changed = !this.loaded || JSON.stringify(state) !== JSON.stringify(this.state);
      this.state = state;
      this.loaded = true;
    } finally {
      this.busy = false;
      if (!background || changed) this.render();
    }
  }

  private render(): void {
    this.select.replaceChildren();
    const placeholder = this.select.ownerDocument.createElement("option");
    placeholder.value = "";
    placeholder.textContent = this.state.selected ? `Pinned: ${this.state.selected.login} (${this.state.selected.host})`
      : this.loaded && !this.state.accounts.length ? "No signed-in accounts" : "Choose an account";
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
  }
}
