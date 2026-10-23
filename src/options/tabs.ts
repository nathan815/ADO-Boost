export class OptionsTabs {
  readonly element: HTMLElement;
  readonly settings: HTMLElement;
  readonly connection: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly buttons: HTMLButtonElement[];

  constructor(document: Document, private readonly location: Location) {
    this.element = document.createElement("div");
    this.element.innerHTML = `
      <div class="options-tabs" role="tablist" aria-label="Options">
        <button id="settings-tab" type="button" role="tab" aria-controls="settings-panel">Settings</button>
        <button id="connection-tab" type="button" role="tab" aria-controls="connection-panel">Copilot Connection</button>
      </div>
      <div id="settings-panel" role="tabpanel" aria-labelledby="settings-tab">
        <div class="setup-required" role="status" hidden><div><strong>Setup required for Copilot</strong><p>Go to the Copilot Connection tab to complete setup.</p></div><button class="primary" type="button">Install or repair</button></div>
        <div class="settings-content"></div>
      </div>
      <div id="connection-panel" role="tabpanel" aria-labelledby="connection-tab" hidden></div>`;
    this.settings = this.element.querySelector(".settings-content")!;
    this.connection = this.element.querySelector("#connection-panel")!;
    this.banner = this.element.querySelector(".setup-required")!;
    this.buttons = [...this.element.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    this.buttons.forEach((button, index) => {
      button.addEventListener("click", () => this.select(index === 1));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
        this.select(next === 1);
        this.buttons[next]?.focus();
      });
    });
    this.banner.querySelector("button")!.addEventListener("click", () => {
      this.select(true);
      this.buttons[1]?.focus();
    });
    document.defaultView?.addEventListener("hashchange", () => this.render());
    this.render();
  }

  setSetupRequired(required: boolean): void {
    this.banner.hidden = !required;
  }

  openConnection(): void {
    this.select(true);
    this.buttons[1]?.focus();
  }

  private select(connection: boolean): void {
    this.location.hash = connection ? "copilot-connection" : "settings";
    this.render();
  }

  private render(): void {
    const connection = this.location.hash === "#copilot-connection";
    this.buttons.forEach((button, index) => {
      const selected = (index === 1) === connection;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    this.element.querySelector<HTMLElement>("#settings-panel")!.hidden = connection;
    this.connection.hidden = !connection;
  }
}
