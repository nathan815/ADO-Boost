export class PanelToast {
  private readonly element: HTMLDivElement;
  private readonly message: HTMLSpanElement;
  private readonly windowRef: Window;
  private timeout: number | undefined;
  private hovered = false;
  private destroyed = false;

  constructor(private readonly root: ShadowRoot) {
    const documentRef = root.ownerDocument;
    this.windowRef = documentRef.defaultView!;
    this.element = documentRef.createElement("div");
    this.element.className = "panel-toast";
    this.element.setAttribute("role", "alert");
    this.element.setAttribute("aria-atomic", "true");
    this.message = documentRef.createElement("span");
    const dismiss = documentRef.createElement("button");
    dismiss.type = "button";
    dismiss.className = "icon";
    dismiss.textContent = "Dismiss";
    dismiss.setAttribute("aria-label", "Dismiss notification");
    dismiss.addEventListener("click", () => this.dismiss());
    this.element.append(this.message, dismiss);
    this.element.addEventListener("pointerenter", () => { this.hovered = true; this.pause(); });
    this.element.addEventListener("pointerleave", () => { this.hovered = false; this.resume(); });
    this.element.addEventListener("focusin", () => this.pause());
    this.element.addEventListener("focusout", () => this.resume());
  }

  show(message: string): void {
    if (this.destroyed) return;
    this.pause();
    this.message.textContent = message;
    this.mount();
    this.resume();
  }

  mount(): void {
    if (!this.destroyed && this.message.textContent) this.root.append(this.element);
  }

  dismiss(): void {
    this.pause();
    this.element.remove();
    this.message.textContent = "";
    this.hovered = false;
  }

  destroy(): void {
    this.dismiss();
    this.destroyed = true;
  }

  private pause(): void {
    this.windowRef.clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  private resume(): void {
    this.pause();
    if (this.hovered || this.element.contains(this.root.activeElement) || !this.message.textContent) return;
    this.timeout = this.windowRef.setTimeout(() => this.dismiss(), 10000);
  }
}
