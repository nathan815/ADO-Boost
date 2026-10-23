export class PanelToast {
  private readonly element: HTMLDivElement;
  private readonly message: HTMLSpanElement;
  private readonly action: HTMLDivElement;
  private destroyed = false;

  constructor(private readonly root: ShadowRoot) {
    const documentRef = root.ownerDocument;
    this.element = documentRef.createElement("div");
    this.element.className = "panel-toast";
    this.element.setAttribute("role", "alert");
    this.element.setAttribute("aria-atomic", "true");
    const content = documentRef.createElement("div");
    content.className = "panel-toast-content";
    const brand = documentRef.createElement("strong");
    brand.textContent = "ADO Boost";
    this.message = documentRef.createElement("span");
    this.action = documentRef.createElement("div");
    content.append(brand, this.message, this.action);
    const dismiss = documentRef.createElement("button");
    dismiss.type = "button";
    dismiss.className = "icon";
    dismiss.textContent = "\u00d7";
    dismiss.setAttribute("aria-label", "Dismiss notification");
    dismiss.title = "Dismiss notification";
    dismiss.addEventListener("click", () => this.dismiss());
    this.element.append(content, dismiss);
  }

  show(message: string, action?: HTMLElement): void {
    if (this.destroyed) return;
    this.message.textContent = message;
    this.action.replaceChildren(...(action ? [action] : []));
    this.mount();
  }

  mount(): void {
    if (!this.destroyed && this.message.textContent) this.root.append(this.element);
  }

  dismiss(): void {
    this.element.remove();
    this.message.textContent = "";
  }

  destroy(): void {
    this.dismiss();
    this.destroyed = true;
  }
}
