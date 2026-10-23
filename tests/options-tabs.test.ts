// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { OptionsTabs } from "../src/options/tabs";
import { CompanionSetupPage } from "../src/companion-setup/page";

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

function setup(hash = "") {
  window.history.replaceState(null, "", `/${hash}`);
  const tabs = new OptionsTabs(document, window.location);
  document.body.append(tabs.element);
  return tabs;
}

describe("options tabs", () => {
  it("defaults to Settings and switches to connection in the same document from the primary banner action", () => {
    const tabs = setup();
    const settings = document.querySelector<HTMLElement>("#settings-panel")!;
    expect(settings.hidden).toBe(false);
    expect(tabs.connection.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>(".setup-required")!.hidden).toBe(true);
    tabs.setSetupRequired(true);
    expect(document.querySelector(".setup-required")?.textContent).toContain("Setup required for Copilot");
    expect(document.querySelector(".setup-required p")?.textContent).toBe("Go to the Copilot Connection tab to complete setup.");
    document.querySelector<HTMLButtonElement>(".setup-required button")!.click();
    expect(window.location.hash).toBe("#copilot-connection");
    expect(settings.hidden).toBe(true);
    expect(tabs.connection.hidden).toBe(false);
    expect(document.querySelector("#connection-tab")?.getAttribute("aria-selected")).toBe("true");
  });

  it("supports deep links, keyboard tab navigation, and browser history without replacing panel contents", () => {
    const tabs = setup("#copilot-connection");
    tabs.connection.innerHTML = "<textarea>Preserved</textarea>";
    expect(tabs.connection.hidden).toBe(false);
    const connection = document.querySelector<HTMLButtonElement>("#connection-tab")!;
    connection.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(tabs.connection.hidden).toBe(true);
    expect(document.activeElement?.id).toBe("settings-tab");
    expect(connection.tabIndex).toBe(-1);
    document.querySelector("#settings-tab")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement?.id).toBe("connection-tab");
    window.history.replaceState(null, "", "/#settings");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(tabs.connection.hidden).toBe(true);
    tabs.openConnection();
    expect(tabs.connection.querySelector("textarea")?.value).toBe("Preserved");
  });

  it("shows setup required for missing, signed-out, or failing health and clears it after a successful refresh", async () => {
    const tabs = setup();
    const health = vi.fn()
      .mockResolvedValueOnce({ connected: false, authenticated: false })
      .mockResolvedValueOnce({ connected: true, authenticated: false })
      .mockRejectedValueOnce(new Error("Host disconnected"))
      .mockResolvedValue({ connected: true, authenticated: true });
    const page = new CompanionSetupPage(tabs.connection, {
      health, copy: vi.fn(), platform: "win",
      onHealth: (result) => tabs.setSetupRequired(!result.connected || !result.authenticated)
    });
    const banner = document.querySelector<HTMLElement>(".setup-required")!;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.refresh();
      expect(banner.hidden).toBe(false);
    }
    await page.refresh();
    expect(banner.hidden).toBe(true);
  });

  it("mounts both tabs in options and preserves connection controls while searching settings", async () => {
    vi.stubGlobal("chrome", undefined);
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    await import("../src/options/index");
    expect(document.querySelector("h1")?.textContent).toBe("ADO Boost");
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>(".setup-required")?.hidden).toBe(false));
    const command = document.querySelector("#install-command");
    const search = document.querySelector<HTMLInputElement>("#search")!;
    search.value = "diff";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector("#install-command")).toBe(command);
    document.querySelector<HTMLButtonElement>(".setup-required button")!.click();
    expect(document.querySelector<HTMLElement>("#connection-panel")?.hidden).toBe(false);
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(document.querySelector('a[href*="companion-setup.html"]')).toBeNull();
  });
});
