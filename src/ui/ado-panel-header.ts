import { createElement as h, createRef } from "react";
import { render, unmountComponentAtNode } from "react-dom";
import { Button } from "azure-devops-ui/Button";
import { MenuButton } from "azure-devops-ui/Menu";
import coreStyles from "azure-devops-ui/Core/core.css?inline";
import buttonStyles from "azure-devops-ui/Components/Button/Button.css?inline";
import expandableButtonStyles from "azure-devops-ui/Components/Button/ExpandableButton.css?inline";
import logoSvg from "./icons/ado-boost.svg?raw";
import settingsSvg from "./icons/settings.svg?raw";
import layoutSvg from "./icons/layout.svg?raw";
import closeSvg from "./icons/close.svg?raw";

export const adoComponentStyles = `${coreStyles}\n${buttonStyles}\n${expandableButtonStyles}`;

let nextLayoutMenuId = 0;

interface PanelHeaderOptions {
  overlay: boolean;
  announcementEnabled: boolean;
  announced: boolean;
  finished?: boolean;
  subtitle: string;
  onSettings: () => void;
  onLayoutChange: (overlay: boolean) => void;
  onClose: () => void;
  onAnnounce: () => void;
}

export class AdoPanelHeader {
  private readonly layoutButton = createRef<MenuButton>();
  private menuOpen = false;
  private trigger: HTMLButtonElement | null = null;
  private readonly listeners = new AbortController();

  constructor(private readonly container: HTMLElement) {}

  render(options: PanelHeaderOptions): void {
    render(h("div", null,
      h("div", { className: "header-line" },
        h("div", { className: "header-brand" },
          inlineSvg(logoSvg),
          h("h2", null, "ADO Boost")
        ),
        h("div", { className: "header-actions" },
          h(Button, { className: "settings", subtle: true, ariaLabel: "Open settings" }, icon("settings")),
          h(MenuButton, {
            ref: this.layoutButton,
            buttonClassName: "panel-layout-toggle",
            subtle: true,
            hideDropdownIcon: true,
            ariaLabel: "Panel layout",
            onExpand: () => { this.menuOpen = true; },
            onCollapse: () => { this.menuOpen = false; this.trigger?.focus(); },
            contextualMenuProps: {
              className: "adopp-layout-callout",
              menuProps: {
                id: `adopp-panel-layout-${++nextLayoutMenuId}`,
                ariaLabel: "Panel layout",
                items: [
                  { id: "adopp-layout-docked", className: "adopp-layout-docked", text: "Docked beside page", checked: !options.overlay, readonly: true },
                  { id: "adopp-layout-overlay", className: "adopp-layout-overlay", text: "Overlay", checked: options.overlay, readonly: true }
                ]
              },
              onActivate: (item) => {
                this.closeLayoutMenu();
                options.onLayoutChange(item.id === "adopp-layout-overlay");
              }
            }
          }, icon("layout")),
          h(Button, { className: "close", subtle: true, ariaLabel: "Close ADO Boost" }, icon("close"))
        )
      ),
      h("p", { className: "subtitle" }, options.subtitle),
      options.announcementEnabled ? h("div", { className: "review-start" },
        options.announced
          ? h("p", { className: "review-start-status", role: "status", tabIndex: -1 }, options.finished ? "You've finished reviewing" : "You've started reviewing")
          : h(Button, { className: "announce-review", primary: true, text: "Announce Review Start" })
      ) : null
    ), this.container);
    // React 16 delegates to document, where shadow events are retargeted to the host.
    this.container.querySelector(".settings")?.addEventListener("click", options.onSettings);
    this.trigger = this.container.querySelector<HTMLButtonElement>(".panel-layout-toggle");
    const signal = this.listeners.signal;
    this.trigger?.addEventListener("click", () => {
      if (!this.closeLayoutMenu()) this.layoutButton.current?.expand();
    }, { signal });
    this.trigger?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" || event.ctrlKey) return;
      event.preventDefault();
      this.layoutButton.current?.expand();
    }, { signal });
    // The portaled menu needs React's document handlers, but unused letter keys must not reach ADO shortcuts.
    for (const type of ["keydown", "keypress", "keyup"] as const) {
      window.addEventListener(type, (event) => {
        if (event.key.length !== 1 || event.key === " ") return;
        if (event.composedPath().some((node) => node instanceof Element && node.classList.contains("adopp-layout-callout"))) {
          event.stopPropagation();
        }
      }, { capture: true, signal });
    }
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

  closeLayoutMenu(): boolean {
    if (!this.menuOpen) return false;
    this.layoutButton.current?.collapse();
    return true;
  }
}

function icon(name: "settings" | "layout" | "close") {
  return inlineSvg({ settings: settingsSvg, layout: layoutSvg, close: closeSvg }[name]);
}

function inlineSvg(markup: string) {
  // Only bundled SVG assets belong here; inline markup preserves inherited theme colors.
  return h("span", { style: { display: "contents" }, dangerouslySetInnerHTML: { __html: markup } });
}
