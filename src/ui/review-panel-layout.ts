const layoutStyles = `
[data-adopp-panel-main] { min-width: 0 !important; flex: 1 1 0% !important; }
[data-adopp-panel-layout="inline"] { flex-direction: row !important; }
@media (max-width: 900px) {
  [data-adopp-panel-layout="inline"] { flex-wrap: wrap !important; overflow-y: auto !important; }
  [data-adopp-panel-layout="inline"] > [data-adopp-panel-main] { flex-basis: 100% !important; min-height: 60vh; }
}
`;

export class ReviewPanelLayout {
  private readonly style = document.createElement("style");
  private readonly observer = new MutationObserver(() => this.reconcile());
  private content: HTMLElement | null = null;
  private container: HTMLElement | null = null;
  private open = false;
  private mode: "inline" | "overlay" = "inline";
  private unavailableReported = false;

  constructor(private readonly host: HTMLElement) {
    this.style.textContent = layoutStyles;
    document.head.append(this.style);
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.reconcile();
  }

  update(open: boolean, mode: "inline" | "overlay"): void {
    this.open = open;
    this.mode = mode;
    this.reconcile();
  }

  destroy(): void {
    this.observer.disconnect();
    this.release();
    this.style.remove();
    this.host.remove();
  }

  private release(): void {
    this.content?.removeAttribute("data-adopp-panel-main");
    this.container?.removeAttribute("data-adopp-panel-layout");
    this.content = null;
    this.container = null;
  }

  private reconcile(): void {
    const content = document.querySelector<HTMLElement>(".repos-pr-details-page, [data-adopp-panel-content]");
    const container = content?.parentElement ?? null;
    if (content !== this.content || container !== this.container) {
      this.release();
      this.content = content;
      this.container = container;
    }
    const docked = this.open && this.mode === "inline" && container !== null;
    if (this.open && this.mode === "inline" && !container && !this.unavailableReported) {
      console.warn("ADO Boost cannot dock the review panel: native PR content is unavailable. Waiting for the page layout.");
      this.unavailableReported = true;
    }
    if (container) this.unavailableReported = false;
    this.host.dataset.layout = docked ? "inline" : this.mode === "overlay" ? "overlay" : "unavailable";
    this.host.dataset.open = String(this.open);
    if (docked) {
      this.content?.setAttribute("data-adopp-panel-main", "");
      container.dataset.adoppPanelLayout = "inline";
    } else {
      this.content?.removeAttribute("data-adopp-panel-main");
      container?.removeAttribute("data-adopp-panel-layout");
    }
    const parent = container ?? document.documentElement;
    if (this.host.parentElement !== parent) parent.append(this.host);
  }
}
