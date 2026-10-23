// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionSetupPage } from "../src/companion-setup/page";
import { companionSetupHealth } from "../src/background/companion-setup";
import { COMPANION_INSTALL_COMMAND, companionInstallCommand } from "../src/core/companion-setup";
import { companionSetupLink } from "../src/ui/companion-setup-link";
import { parseCopilotHealth } from "../src/core/copilot-gateway";

const pages: CompanionSetupPage[] = [];
afterEach(() => {
  for (const page of pages.splice(0)) page.stop();
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function setup() {
  const root = document.createElement("main");
  document.body.append(root);
  const health = vi.fn().mockResolvedValue({
    connected: true, authenticated: true, login: "reviewer",
    companion: { version: "0.2.0", pid: 123, uptimeSeconds: 10 }, cliVersion: "1.0"
  });
  const copy = vi.fn().mockResolvedValue(undefined);
  const page = new CompanionSetupPage(root, { health, copy, platform: "win" });
  pages.push(page);
  return { root, health, copy, page };
}

describe("companion setup", () => {
  it("copies the actual runtime extension ID, including store and keyless unpacked installs", async () => {
    const id = "bfafgbohohbfioebcmbcehlnpcmakkbn";
    vi.stubGlobal("chrome", { runtime: { id } });
    const { root, copy } = setup();
    const command = root.querySelector<HTMLTextAreaElement>("#install-command")!.value;
    expect(command).toContain(`-ExtensionId ${id}`);
    expect(command).not.toContain("-FromExtension");
    root.querySelector<HTMLButtonElement>("#copy-command")!.click();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(command));
    expect(companionInstallCommand("oldakfajnbllipnfdaghapeiofnciopo")).toContain("-ExtensionId oldakfajnbllipnfdaghapeiofnciopo");
    for (const invalid of ["", "short", "A".repeat(32), "q".repeat(32), `${id}\n`, `${id};whoami`, `chrome-extension://${id}/`]) {
      expect(() => companionInstallCommand(invalid)).toThrow("Invalid ADO Boost extension ID");
    }
  });

  it("shows a successful sign-in username only in account diagnostics, not as an error", async () => {
    const { root, health, page } = setup();
    health.mockResolvedValueOnce(parseCopilotHealth({
      auth: { isAuthenticated: true, login: "reviewer", statusMessage: "reviewer" }
    }));
    await page.refresh();
    expect(root.querySelector<HTMLElement>("#connection-error")?.hidden).toBe(true);
    expect(root.querySelector("#connection-error")?.textContent).toBe("");
    expect(root.querySelector("#diagnostics")?.textContent).toBe("GitHub accountreviewer");
    expect(root.querySelector<HTMLElement>("#connection-details")?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>(".connection-status")?.dataset.state).toBe("ready");
    health.mockResolvedValueOnce(parseCopilotHealth({
      auth: { isAuthenticated: false, statusMessage: "Please sign in" }
    }));
    await page.refresh();
    expect(root.querySelector<HTMLElement>("#connection-error")?.hidden).toBe(false);
    expect(root.querySelector("#connection-error")?.textContent).toBe("Please sign in");
  });

  it("checks health without a PR, reports actual diagnostics, and refreshes independently", async () => {
    const { root, health, page } = setup();
    health.mockRejectedValueOnce(new Error("<img src=x> Native host not found"));
    await page.refresh();
    expect(root.querySelector("#connection")?.textContent).toBe("Companion unavailable");
    expect(root.querySelector("#connection-error")?.textContent).toBe("<img src=x> Native host not found");
    expect(root.querySelectorAll("img")).toHaveLength(0);
    expect(root.textContent).not.toContain("This checks the companion and sign-in only");
    expect(root.textContent).not.toContain("cannot determine whether Node.js or Copilot CLI is installed");
    expect(root.textContent).not.toContain("We'll detect your connection automatically.");
    expect(root.textContent).not.toContain("ado-boost login");
    expect(root.textContent).toContain("guides you through sign-in");
    expect(root.querySelector<HTMLElement>(".connection-status")?.dataset.state).toBe("unavailable");
    expect(page.connection.indicator.textContent).toBe("Copilot not set up");
    expect(root.querySelector("#connection-hint")?.textContent).toBe("Install or repair the companion below to connect Copilot.");
    await page.refresh();
    expect(root.querySelector("#connection")?.textContent).toBe("Connected and signed in");
    expect(root.querySelector<HTMLElement>(".connection-status")?.dataset.state).toBe("ready");
    expect(page.connection.indicator.textContent).toBe("reviewer");
    expect(page.connection.indicator.getAttribute("aria-label")).toContain("signed in as reviewer");
    expect(root.querySelector("#diagnostics")?.textContent).toContain("reviewer");
    expect(root.querySelector("#diagnostics")?.textContent).toContain("0.2.0");
    expect(root.querySelector<HTMLElement>("#connection-error")?.hidden).toBe(true);
    health.mockResolvedValueOnce({ connected: true, authenticated: false, detail: "Select a Copilot account" });
    await page.refresh();
    expect(root.querySelector("#connection")?.textContent).toContain("sign-in or account selection");
    expect(root.querySelector<HTMLElement>(".connection-status")?.dataset.state).toBe("auth-required");
    expect(page.connection.indicator.textContent).toBe("Needs login");
    expect(page.connection.indicator.textContent).not.toContain("reviewer");
    expect(root.querySelector("#connection-error")?.textContent).toBe("Select a Copilot account");
    expect(root.querySelector("#diagnostics")?.textContent).toBe("");
  });

  it("prevents overlapping checks, copies the displayed command, and surfaces clipboard failures", async () => {
    const { root, page, health, copy } = setup();
    let resolve!: (value: unknown) => void;
    health.mockImplementationOnce(() => new Promise((complete) => { resolve = complete; }));
    const pending = page.refresh();
    await page.refresh();
    expect(health).toHaveBeenCalledOnce();
    expect(root.querySelector<HTMLButtonElement>("#refresh")?.disabled).toBe(true);
    expect(root.querySelector(".connection-status")?.getAttribute("aria-busy")).toBe("true");
    expect(page.connection.indicator.textContent).toBe("Checking");
    resolve({ connected: false, authenticated: false });
    await pending;
    expect(root.querySelector<HTMLButtonElement>("#refresh")?.disabled).toBe(false);
    expect(root.querySelector(".connection-status")?.getAttribute("aria-busy")).toBe("false");
    root.querySelector<HTMLButtonElement>("#copy-command")!.click();
    await vi.waitFor(() => expect(root.querySelector("#copy-command")?.textContent).toBe("Copied"));
    expect(root.querySelector("#copy-status")?.textContent).toBe("");
    expect(copy).toHaveBeenCalledWith(COMPANION_INSTALL_COMMAND);
    expect(COMPANION_INSTALL_COMMAND).toContain('& "$env:TEMP\\install-ado-boost.ps1" }');
    expect(root.querySelector<HTMLTextAreaElement>("#install-command")?.value).toBe(COMPANION_INSTALL_COMMAND);
    copy.mockRejectedValueOnce(new Error("Clipboard blocked"));
    root.querySelector<HTMLButtonElement>("#copy-command")!.click();
    await vi.waitFor(() => expect(root.querySelector("#copy-status")?.textContent).toContain("copy it manually"));
    expect(root.querySelector("#copy-command")?.textContent).toBe("Copy install command");
  });

  it("temporarily changes the copy button label and restarts the delay when copied again", async () => {
    vi.useFakeTimers();
    const { root, page, copy } = setup();
    const button = root.querySelector<HTMLButtonElement>("#copy-command")!;
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.textContent).toBe("Copied");
    expect(root.querySelector("#copy-status")?.textContent).toBe("");
    await vi.advanceTimersByTimeAsync(1_500);
    button.click();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(button.textContent).toBe("Copied");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(button.textContent).toBe("Copy install command");
    copy.mockRejectedValueOnce(new Error("Clipboard blocked"));
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.textContent).toBe("Copy install command");
    expect(root.querySelector("#copy-status")?.textContent).toContain("Clipboard blocked");
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.textContent).toBe("Copied");
    expect(root.querySelector("#copy-status")?.textContent).toBe("");
    page.stop();
    expect(button.textContent).toBe("Copy install command");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("makes installation the primary action, keeps instructions concise, and detects completion automatically", async () => {
    const { root, health, page } = setup();
    const install = root.querySelector(".install-focus")!;
    expect(install.querySelector("h2")?.textContent).toBe("Install Copilot companion");
    expect(install.querySelector("button.primary")?.textContent).toBe("Copy install command");
    expect(install.textContent!.trim().split(/\s+/).length).toBeLessThan(100);
    expect(root.querySelector<HTMLDetailsElement>(".setup-help")?.open).toBe(false);
    page.start();
    await vi.waitFor(() => expect(root.querySelector("#connection")?.textContent).toBe("Connected and signed in"));
    expect(health).toHaveBeenCalledOnce();
    expect(root.querySelector<HTMLElement>(".connection-success")?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>(".install-focus")?.hidden).toBe(true);
    expect(root.querySelector(".connection-success")?.textContent).toContain("Successfully configured local Copilot connection!");
    root.querySelector<HTMLButtonElement>("#show-install")!.click();
    expect(root.querySelector<HTMLElement>(".install-focus")?.hidden).toBe(false);
    await page.refresh();
    expect(root.querySelector<HTMLElement>(".install-focus")?.hidden).toBe(false);
  });

  it("states platform limits rather than offering unsupported native-host registration", () => {
    new CompanionSetupPage(document.body, { health: vi.fn(), copy: vi.fn(), platform: "linux" });
    expect(document.querySelector("#platform-note")?.textContent).toContain("does not add native-host support");
  });

  it("accepts only settings/welcome diagnostics, including tab fragments, and never sends inference requests", async () => {
    const request = vi.fn().mockResolvedValue({ auth: { isAuthenticated: false } });
    const url = "chrome-extension://test/options.html";
    await expect(companionSetupHealth({ id: "test", url }, "test", url, { request })).resolves.toEqual({ connected: true, authenticated: false });
    expect(request.mock.calls).toEqual([["health"]]);
    await expect(companionSetupHealth({ id: "test", url: `${url}#copilot-connection` }, "test", url, { request })).resolves.toEqual({ connected: true, authenticated: false });
    await expect(companionSetupHealth({ id: "test", url: url.replace("options", "onboarding") }, "test", url, { request })).resolves.toEqual({ connected: true, authenticated: false });
    for (const sender of [
      { id: "other", url }, { id: "test", url: "https://dev.azure.com" },
      { id: "test", url: url.replace("options", "popup") }, { id: "test" },
      { id: "test", url: `${url}?untrusted=true` }, { id: "test", url: `${url}.evil#copilot-connection` },
      { id: "test", url: url.replace("options.html", "onboarding.html?untrusted=true") }
    ]) await expect(companionSetupHealth(sender, "test", url, { request })).rejects.toThrow("only");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("polls every five seconds without overlapping or flickering, then stops cleanly", async () => {
    vi.useFakeTimers();
    const { root, health, page } = setup();
    let complete!: (value: unknown) => void;
    health.mockResolvedValueOnce({ connected: false, authenticated: false })
      .mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    page.start();
    page.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(health).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(health).toHaveBeenCalledTimes(2);
    expect(page.connection.indicator.textContent).toBe("Copilot not set up");
    expect(root.querySelector("#connection")?.textContent).toBe("Companion unavailable");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(health).toHaveBeenCalledTimes(2);
    complete({ connected: true, authenticated: true, login: "reviewer" });
    await vi.advanceTimersByTimeAsync(0);
    expect(page.connection.indicator.textContent).toBe("reviewer");
    expect(root.querySelector<HTMLElement>(".connection-success")?.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(health).toHaveBeenCalledTimes(3);
    page.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(health).toHaveBeenCalledTimes(3);
  });

  it("keeps retrying errors and signed-out states and restores install instructions if the connection is lost", async () => {
    vi.useFakeTimers();
    const { root, health, page } = setup();
    health.mockRejectedValueOnce(new Error("Host missing"))
      .mockResolvedValueOnce({ connected: true, authenticated: false })
      .mockResolvedValueOnce({ connected: true, authenticated: true })
      .mockResolvedValueOnce({ connected: false, authenticated: false });
    page.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector<HTMLElement>(".connection-success")?.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(root.querySelector<HTMLElement>(".connection-success")?.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(root.querySelector<HTMLElement>(".connection-success")?.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(root.querySelector<HTMLElement>(".connection-success")?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>(".install-focus")?.hidden).toBe(false);
  });

  it("does not restart a stopped polling chain when an in-flight check completes", async () => {
    vi.useFakeTimers();
    const { health, page } = setup();
    let complete!: (value: unknown) => void;
    health.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    page.start();
    page.stop();
    page.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(health).toHaveBeenCalledTimes(1);
    complete({ connected: true, authenticated: true });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(health).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(health).toHaveBeenCalledTimes(3);
    page.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(health).toHaveBeenCalledTimes(3);
  });

  it("opens setup through the extension background and displays failures without injecting HTML", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("chrome", { runtime: { getURL: (file: string) => `chrome-extension://test/${file}`, sendMessage } });
    const link = companionSetupLink(document);
    document.body.append(link);
    link.click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ channel: "adopp-ui", kind: "open-companion-setup" }));
    expect(link.href).toBe("chrome-extension://test/options.html#copilot-connection");
    sendMessage.mockResolvedValueOnce({ ok: false, error: "<script>Blocked</script>" });
    link.click();
    await vi.waitFor(() => expect(link.textContent).toBe("<script>Blocked</script>"));
    expect(link.querySelector("script")).toBeNull();
  });
});
