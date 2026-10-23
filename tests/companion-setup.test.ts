// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionSetupPage } from "../src/companion-setup/page";
import { companionSetupHealth } from "../src/background/companion-setup";
import { COMPANION_INSTALL_COMMAND } from "../src/core/companion-setup";
import { companionSetupLink } from "../src/ui/companion-setup-link";

afterEach(() => {
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
  return { root, health, copy, page };
}

describe("companion setup", () => {
  it("checks health without a PR, reports actual diagnostics, and refreshes independently", async () => {
    const { root, health, page } = setup();
    health.mockRejectedValueOnce(new Error("<img src=x> Native host not found"));
    await page.refresh();
    expect(root.querySelector("#connection")?.textContent).toBe("Companion unavailable");
    expect(root.querySelector("#connection-error")?.textContent).toBe("<img src=x> Native host not found");
    expect(root.querySelectorAll("img")).toHaveLength(0);
    expect(root.textContent).not.toContain("This checks the companion and sign-in only");
    expect(root.textContent).not.toContain("cannot determine whether Node.js or Copilot CLI is installed");
    expect(root.textContent).not.toContain("ado-boost login");
    expect(root.textContent).toContain("guides you through sign-in");
    expect(root.querySelector<HTMLElement>(".connection-status")?.dataset.state).toBe("unavailable");
    await page.refresh();
    expect(root.querySelector("#connection")?.textContent).toBe("Connected and signed in");
    expect(root.querySelector<HTMLElement>(".connection-status")?.dataset.state).toBe("ready");
    expect(root.querySelector("#diagnostics")?.textContent).toContain("reviewer");
    expect(root.querySelector("#diagnostics")?.textContent).toContain("0.2.0");
    expect(root.querySelector<HTMLElement>("#connection-error")?.hidden).toBe(true);
    health.mockResolvedValueOnce({ connected: true, authenticated: false, detail: "Select a Copilot account" });
    await page.refresh();
    expect(root.querySelector("#connection")?.textContent).toContain("sign-in or account selection");
    expect(root.querySelector<HTMLElement>(".connection-status")?.dataset.state).toBe("auth-required");
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
    resolve({ connected: false, authenticated: false });
    await pending;
    expect(root.querySelector<HTMLButtonElement>("#refresh")?.disabled).toBe(false);
    expect(root.querySelector(".connection-status")?.getAttribute("aria-busy")).toBe("false");
    root.querySelector<HTMLButtonElement>("#copy-command")!.click();
    await vi.waitFor(() => expect(root.querySelector("#copy-status")?.textContent).toBe("Copied."));
    expect(copy).toHaveBeenCalledWith(COMPANION_INSTALL_COMMAND);
    expect(root.querySelector<HTMLTextAreaElement>("#install-command")?.value).toBe(COMPANION_INSTALL_COMMAND);
    copy.mockRejectedValueOnce(new Error("Clipboard blocked"));
    root.querySelector<HTMLButtonElement>("#copy-command")!.click();
    await vi.waitFor(() => expect(root.querySelector("#copy-status")?.textContent).toContain("copy it manually"));
  });

  it("makes installation the primary action, keeps instructions concise, and offers a post-install status check", async () => {
    const { root, health } = setup();
    const install = root.querySelector(".install-focus")!;
    expect(install.querySelector("h2")?.textContent).toBe("Install Copilot companion");
    expect(install.querySelector("button.primary")?.textContent).toBe("Copy install command");
    expect(install.textContent!.trim().split(/\s+/).length).toBeLessThan(100);
    expect(root.querySelector<HTMLDetailsElement>(".setup-help")?.open).toBe(false);
    root.querySelector<HTMLButtonElement>("#check-after-install")!.click();
    await vi.waitFor(() => expect(root.querySelector("#connection")?.textContent).toBe("Connected and signed in"));
    expect(health).toHaveBeenCalledOnce();
  });

  it("states platform limits rather than offering unsupported native-host registration", () => {
    new CompanionSetupPage(document.body, { health: vi.fn(), copy: vi.fn(), platform: "linux" });
    expect(document.querySelector("#platform-note")?.textContent).toContain("does not add native-host support");
  });

  it("accepts only settings-page diagnostics, including tab fragments, and never sends inference requests", async () => {
    const request = vi.fn().mockResolvedValue({ auth: { isAuthenticated: false } });
    const url = "chrome-extension://test/options.html";
    await expect(companionSetupHealth({ id: "test", url }, "test", url, { request })).resolves.toEqual({ connected: true, authenticated: false });
    expect(request.mock.calls).toEqual([["health"]]);
    await expect(companionSetupHealth({ id: "test", url: `${url}#copilot-connection` }, "test", url, { request })).resolves.toEqual({ connected: true, authenticated: false });
    for (const sender of [
      { id: "other", url }, { id: "test", url: "https://dev.azure.com" },
      { id: "test", url: url.replace("options", "popup") }, { id: "test" },
      { id: "test", url: `${url}?untrusted=true` }, { id: "test", url: `${url}.evil#copilot-connection` }
    ]) await expect(companionSetupHealth(sender, "test", url, { request })).rejects.toThrow("only");
    expect(request).toHaveBeenCalledTimes(2);
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
