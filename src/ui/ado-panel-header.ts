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
  onToggleLayout: () => void;
  onClose: () => void;
  onAnnounce: () => void;
}

export class AdoPanelHeader {
  constructor(private readonly container: HTMLElement) {}

  render(options: PanelHeaderOptions): void {
    const layoutLabel = options.overlay ? "Dock panel beside page" : "Show panel as overlay";
    render(h("div", null,
      h("div", { className: "header-line" },
        h("h2", null, "PR discussions"),
        h("div", { className: "header-actions" },
          h(Button, { className: "settings", subtle: true, ariaLabel: "Open settings" }, icon("settings")),
          h(Button, { className: "panel-layout-toggle", subtle: true, ariaLabel: layoutLabel, ariaPressed: !options.overlay }, icon("layout")),
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
    this.container.querySelector(".panel-layout-toggle")?.addEventListener("click", options.onToggleLayout);
    this.container.querySelector(".close")?.addEventListener("click", options.onClose);
    this.container.querySelector(".announce-review")?.addEventListener("click", options.onAnnounce);
    for (const button of this.container.querySelectorAll<HTMLButtonElement>("[aria-label]")) {
      button.title = button.getAttribute("aria-label") ?? "";
    }
  }

  destroy(): void {
    unmountComponentAtNode(this.container);
  }
}

function icon(name: "settings" | "layout" | "close") {
  const paths = {
    settings: "M6.5 1.5h3l.5 2 1.5 1 2-.5 1.5 2.5-1.5 1.5v2l1.5 1.5-1.5 2.5-2-.5-1.5 1-.5 2h-3l-.5-2-1.5-1-2 .5L1 10.5 2.5 9v-2L1 5.5 2.5 3l2 .5 1.5-1 .5-1ZM10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
    layout: "M1.5 2.5h13v11h-13zM9.5 2.5v11",
    close: "m4 4 8 8m0-8-8 8"
  };
  return h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.2, "aria-hidden": true }, h("path", { d: paths[name] }));
}
