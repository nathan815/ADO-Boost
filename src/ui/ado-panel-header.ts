import { createElement as h } from "react";
import { render, unmountComponentAtNode } from "react-dom";
import { Button } from "azure-devops-ui/Button";
import coreStyles from "azure-devops-ui/Core/core.css?inline";
import buttonStyles from "azure-devops-ui/Components/Button/Button.css?inline";

export const adoComponentStyles = `${coreStyles}\n${buttonStyles}`;

interface PanelHeaderOptions {
  overlay: boolean;
  announcementEnabled: boolean;
  announced: boolean;
  subtitle: string;
  onSettings: () => void;
  onLayoutChange: (overlay: boolean) => void;
  onClose: () => void;
  onAnnounce: () => void;
}

export class AdoPanelHeader {
  private menu: HTMLElement | null = null;
  private trigger: HTMLButtonElement | null = null;
  private readonly listeners = new AbortController();

  constructor(private readonly container: HTMLElement) {}

  render(options: PanelHeaderOptions): void {
    render(h("div", null,
      h("div", { className: "header-line" },
        h("h2", null, "PR discussions"),
        h("div", { className: "header-actions" },
          h(Button, { className: "settings", subtle: true, ariaLabel: "Open settings" }, icon("settings")),
          h("div", { className: "panel-layout-control" },
            h(Button, { className: "panel-layout-toggle", subtle: true, ariaLabel: "Panel layout" }, icon("layout")),
            h("div", { className: "panel-layout-menu bolt-contextual-menu", role: "menu", "aria-label": "Panel layout", hidden: true },
              ...[{ overlay: false, text: "Docked beside page" }, { overlay: true, text: "Overlay" }].map((item) =>
                h("button", {
                  key: item.text, type: "button", className: "panel-layout-option bolt-button enabled subtle",
                  role: "menuitemradio", "aria-checked": options.overlay === item.overlay, tabIndex: -1,
                  "data-overlay": String(item.overlay)
                }, h("span", { className: "panel-layout-check", "aria-hidden": true }, options.overlay === item.overlay ? icon("check") : null), item.text)
              )
            )
          ),
          h(Button, { className: "close", subtle: true, ariaLabel: "Close review navigator" }, icon("close"))
        )
      ),
      h("p", { className: "subtitle" }, options.subtitle),
      options.announcementEnabled ? h("div", { className: "review-start" },
        options.announced
          ? h("p", { className: "review-start-status", role: "status", tabIndex: -1 }, "You've started reviewing")
          : h(Button, { className: "announce-review", primary: true, text: "Announce Review Start" })
      ) : null
    ), this.container);
    // React 16 delegates to document, where shadow events are retargeted to the host.
    this.container.querySelector(".settings")?.addEventListener("click", options.onSettings);
    this.trigger = this.container.querySelector<HTMLButtonElement>(".panel-layout-toggle");
    this.menu = this.container.querySelector<HTMLElement>(".panel-layout-menu");
    this.trigger?.setAttribute("aria-haspopup", "menu");
    this.trigger?.setAttribute("aria-expanded", "false");
    const signal = this.listeners.signal;
    this.trigger?.addEventListener("click", () => {
      if (!this.closeLayoutMenu()) this.openLayoutMenu();
    }, { signal });
    this.trigger?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      this.openLayoutMenu(event.key === "ArrowUp");
    }, { signal });
    for (const item of this.menu?.querySelectorAll<HTMLButtonElement>(".panel-layout-option") ?? []) {
      item.addEventListener("click", () => {
        this.closeLayoutMenu();
        options.onLayoutChange(item.dataset.overlay === "true");
      }, { signal });
    }
    this.menu?.addEventListener("keydown", (event) => {
      const items = [...this.menu!.querySelectorAll<HTMLButtonElement>(".panel-layout-option")];
      const index = items.findIndex((item) => event.composedPath().includes(item));
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        this.closeLayoutMenu();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }, { signal });
    document.addEventListener("pointerdown", (event) => {
      if (!event.composedPath().includes(this.menu!) && !event.composedPath().includes(this.trigger!)) this.closeLayoutMenu(false);
    }, { capture: true, signal });
    this.container.querySelector(".close")?.addEventListener("click", options.onClose);
    this.container.querySelector(".announce-review")?.addEventListener("click", options.onAnnounce);
    for (const button of this.container.querySelectorAll<HTMLButtonElement>("[aria-label]")) {
      button.title = button.getAttribute("aria-label") ?? "";
    }
  }

  destroy(): void {
    this.listeners.abort();
    unmountComponentAtNode(this.container);
  }

  closeLayoutMenu(restoreFocus = true): boolean {
    if (!this.menu || this.menu.hidden) return false;
    this.menu.hidden = true;
    this.trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) this.trigger?.focus();
    return true;
  }

  private openLayoutMenu(last = false): void {
    if (!this.menu) return;
    this.menu.hidden = false;
    this.trigger?.setAttribute("aria-expanded", "true");
    const items = this.menu.querySelectorAll<HTMLButtonElement>(".panel-layout-option");
    (last ? items[items.length - 1] : this.menu.querySelector<HTMLButtonElement>('[aria-checked="true"]'))?.focus();
  }
}

function icon(name: "settings" | "layout" | "close" | "check") {
  const paths = {
    settings: "M6.5 1.5h3l.5 2 1.5 1 2-.5 1.5 2.5-1.5 1.5v2l1.5 1.5-1.5 2.5-2-.5-1.5 1-.5 2h-3l-.5-2-1.5-1-2 .5L1 10.5 2.5 9v-2L1 5.5 2.5 3l2 .5 1.5-1 .5-1ZM10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
    layout: "M1.5 2.5h13v11h-13zM9.5 2.5v11",
    close: "m4 4 8 8m0-8-8 8",
    check: "m3 8 3 3 7-7"
  };
  return h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.2, "aria-hidden": true }, h("path", { d: paths[name] }));
}
