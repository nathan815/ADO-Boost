// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { openOnboarding } from "../src/background/onboarding";
import { createOnboarding } from "../src/onboarding/page";
import { COMPANION_INSTALL_COMMAND } from "../src/core/companion-setup";

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("first-install welcome", () => {
  it("opens only on a new installation, never on an extension or browser update", async () => {
    const dependencies = { getURL: (path: string) => `chrome-extension://test/${path}`, open: vi.fn().mockResolvedValue(undefined) };
    for (const reason of ["update", "chrome_update", "shared_module_update"]) await openOnboarding(reason, dependencies);
    expect(dependencies.open).not.toHaveBeenCalled();
    await openOnboarding("install", dependencies);
    expect(dependencies.open).toHaveBeenCalledExactlyOnceWith("chrome-extension://test/onboarding.html");
    dependencies.open.mockRejectedValueOnce(new Error("Tabs unavailable"));
    await expect(openOnboarding("install", dependencies)).rejects.toThrow("Tabs unavailable");
  });

  it("welcomes users, reuses the installer, and automatically switches to success without requiring Copilot for core features", async () => {
    vi.useFakeTimers();
    const health = vi.fn().mockResolvedValueOnce({ connected: false, authenticated: false })
      .mockResolvedValue({ connected: true, authenticated: true, login: "reviewer" });
    const copy = vi.fn().mockResolvedValue(undefined);
    const page = createOnboarding(document.body, { health, copy, platform: "win" });
    try {
      expect(document.querySelector("h1")?.textContent).toBe("Welcome to ADO Boost");
      expect(document.querySelector(".welcome-logo")).not.toBeNull();
      expect(document.querySelectorAll(".welcome-features li")).toHaveLength(4);
      expect(document.querySelector(".welcome-features li h2")?.textContent).toBe("Your PR Home");
      expect(document.querySelector(".welcome-features li p")?.textContent).toContain("dashboard, profiles, and activity feed");
      expect(document.querySelector(".welcome-overview .welcome-header")).not.toBeNull();
      expect(document.querySelector(".welcome-overview .welcome-features")).not.toBeNull();
      expect(document.querySelector(".welcome-overview .welcome-continue")).toBeNull();
      expect(document.querySelector(".welcome-overview")?.nextElementSibling?.className).toBe("welcome-connection");
      expect(document.querySelector(".welcome-setup")?.nextElementSibling?.className).toBe("welcome-footer");
      const continueLink = document.querySelector<HTMLAnchorElement>(".welcome-continue")!;
      const alternative = document.querySelector<HTMLElement>(".welcome-or")!;
      expect(alternative.textContent).toBe("OR");
      expect(alternative.hidden).toBe(false);
      expect(continueLink.classList.contains("primary")).toBe(false);
      expect(document.querySelector(".welcome-features")?.textContent).toContain("private drafts");
      expect(document.querySelector(".welcome-features")?.textContent).toContain("Optional");
      expect(document.querySelector(".page-header")).toBeNull();
      expect(document.querySelector(".welcome-eyebrow")).toBeNull();
      expect(document.querySelector(".welcome-label")).toBeNull();
      expect(document.querySelector(".welcome-setup-intro")).toBeNull();
      expect(document.body.textContent).not.toContain("Connect your local Copilot to unlock AI features.");
      expect(document.querySelector('[role="tablist"]')).toBeNull();
      expect(document.querySelector(".welcome-continue")?.getAttribute("href")).toBe("./options.html");
      const install = document.querySelector(".install-focus")!;
      const connection = document.querySelector(".connection-status")!;
      expect(install.compareDocumentPosition(connection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(document.body.textContent).toContain("Core features work without the companion.");
      expect(document.querySelector<HTMLTextAreaElement>("#install-command")?.value).toBe(COMPANION_INSTALL_COMMAND);
      expect(document.querySelector("#setup-settings-link")).toBeNull();
      expect(document.body.textContent).not.toContain("We'll detect your connection automatically.");
      document.querySelector<HTMLButtonElement>("#copy-command")!.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(copy).toHaveBeenCalledWith(COMPANION_INSTALL_COMMAND);
      page.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(document.querySelector<HTMLElement>(".install-focus")?.hidden).toBe(false);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(document.querySelector<HTMLElement>(".connection-success")?.hidden).toBe(false);
      expect(document.querySelector<HTMLElement>(".install-focus")?.hidden).toBe(true);
      expect(document.querySelector(".connection-success")?.textContent).toContain("Successfully configured local Copilot connection!");
      expect(continueLink.classList.contains("primary")).toBe(true);
      expect(alternative.hidden).toBe(true);
      expect(document.querySelector<HTMLElement>(".welcome-footer p")?.hidden).toBe(true);
      for (const connected of [true, false]) {
        health.mockResolvedValueOnce({ connected, authenticated: false });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(continueLink.classList.contains("primary")).toBe(false);
        expect(alternative.hidden).toBe(false);
        expect(document.querySelector<HTMLElement>(".welcome-footer p")?.hidden).toBe(false);
      }
    } finally {
      page.stop();
    }
  });
});
