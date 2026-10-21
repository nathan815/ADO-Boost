// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CopilotHealth } from "../src/core/copilot-gateway";
import { CompanionStatus } from "../src/ui/companion-status";

let status: CompanionStatus | undefined;
const methods = ["showPopover", "hidePopover"] as const;
const originals = methods.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));

beforeAll(() => {
  for (const name of methods) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: function (this: HTMLElement) {
        const state = name === "showPopover" ? "open" : "closed";
        this.dataset.popoverState = state;
        const event = new Event("beforetoggle");
        Object.defineProperty(event, "newState", { value: state });
        this.dispatchEvent(event);
      }
    });
  }
});
afterAll(() => methods.forEach((name, index) => {
  const descriptor = originals[index];
  if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, name);
}));
afterEach(() => { status?.destroy(); document.body.innerHTML = ""; });

function fixture(request = vi.fn<() => Promise<CopilotHealth>>().mockResolvedValue({ connected: true, authenticated: true, login: "reviewer" })) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  const slot = document.createElement("div");
  root.append(slot);
  status = new CompanionStatus(request, document);
  status.mount(slot);
  const toggle = root.querySelector<HTMLButtonElement>(".companion-toggle")!;
  const details = root.querySelector<HTMLElement>(".companion-popover")!;
  const refresh = root.querySelector<HTMLButtonElement>(".companion-refresh")!;
  return { root, slot, toggle, details, refresh, request };
}

describe("sidebar companion status", () => {
  it("does not connect until requested, checks once, and shows connection details in a popover", async () => {
    const { toggle, details, request } = fixture();
    expect(toggle.textContent).toBe("Not checked");
    expect(request).not.toHaveBeenCalled();
    status!.checkOnce();
    status!.checkOnce();
    await vi.waitFor(() => expect(toggle.textContent).toBe("Connected"));
    expect(request).toHaveBeenCalledOnce();
    toggle.click();
    expect(details.getAttribute("popover")).toBe("auto");
    expect(details.dataset.popoverState).toBe("open");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(details.textContent).toContain("Signed in as reviewer");
    expect(details.textContent).not.toContain("Checks connection and sign-in only");
    expect(details.textContent).not.toContain("No PR content is sent");
    expect(status!.close()).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(status!.close()).toBe(false);
  });

  it("refreshes independently and reports authentication, connection errors, and recovery", async () => {
    const { toggle, details, refresh, request } = fixture();
    request.mockRejectedValueOnce(new Error("<img src=x> Host missing"));
    toggle.click();
    expect(refresh.disabled).toBe(true);
    await vi.waitFor(() => expect(toggle.textContent).toBe("Unavailable"));
    expect(details.querySelector(".companion-error")?.textContent).toBe("<img src=x> Host missing");
    expect(details.querySelector("img")).toBeNull();
    expect(details.textContent).toContain("ado-boost doctor");
    request.mockResolvedValueOnce({ connected: true, authenticated: false, detail: "Sign in with ado-boost login" });
    refresh.click();
    await vi.waitFor(() => expect(toggle.textContent).toBe("Needs login"));
    expect(details.textContent).toContain("Sign in with ado-boost login");
    expect(details.querySelector<HTMLElement>(".companion-error")?.hidden).toBe(true);
    refresh.click();
    await vi.waitFor(() => expect(toggle.textContent).toBe("Connected"));
  });

  it("keeps popover state and focus across sidebar rerenders and responds to native light-dismiss", async () => {
    const { root, slot, toggle, details, refresh } = fixture();
    status!.checkOnce();
    await vi.waitFor(() => expect(toggle.textContent).toBe("Connected"));
    toggle.click();
    refresh.focus();
    status!.detach();
    status!.mount(slot);
    expect(details.dataset.popoverState).toBe("open");
    expect(root.activeElement).toBe(refresh);
    details.hidePopover();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();
    expect(details.dataset.popoverState).toBe("open");
  });

  it("does not update a destroyed status control when a pending check completes", async () => {
    let complete!: (health: CopilotHealth) => void;
    const request = vi.fn<() => Promise<CopilotHealth>>().mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const { toggle } = fixture(request);
    status!.checkOnce();
    status!.destroy();
    complete({ connected: true, authenticated: true });
    await Promise.resolve();
    expect(toggle.isConnected).toBe(false);
    expect(toggle.textContent).toBe("Checking");
  });
});
