// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelToast } from "../src/ui/panel-toast";

describe("PanelToast", () => {
  let root: ShadowRoot;
  let toast: PanelToast;

  beforeEach(() => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    root = host.attachShadow({ mode: "open" });
    toast = new PanelToast(root);
  });

  afterEach(() => {
    toast.destroy();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("announces the error as text without stealing focus", () => {
    const input = document.createElement("textarea");
    root.append(input);
    input.focus();
    toast.show("Couldn't jump. <b>Try again.</b>");
    const alert = root.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Couldn't jump. <b>Try again.</b>");
    expect(alert.querySelector("b")).toBeNull();
    expect(root.activeElement).toBe(input);
    expect(alert.getAttribute("aria-atomic")).toBe("true");
  });

  it("can be dismissed immediately and clears its timer", () => {
    toast.show("Couldn't jump.");
    root.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')!.click();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("expires after ten seconds and restarts the timeout for a replacement", () => {
    toast.show("First failure");
    vi.advanceTimersByTime(9000);
    toast.show("Second failure");
    vi.advanceTimersByTime(9000);
    expect(root.querySelector('[role="alert"]')!.textContent).toContain("Second failure");
    expect(root.querySelectorAll('[role="alert"]')).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses dismissal while hovered", () => {
    toast.show("Couldn't jump.");
    const alert = root.querySelector('[role="alert"]')!;
    alert.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(20000);
    expect(alert.isConnected).toBe(true);
    alert.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(10000);
    expect(alert.isConnected).toBe(false);
  });

  it("pauses dismissal while keyboard focus is inside the toast", () => {
    const input = document.createElement("textarea");
    root.append(input);
    toast.show("Couldn't jump.");
    root.querySelector<HTMLButtonElement>("button")!.focus();
    vi.advanceTimersByTime(20000);
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    input.focus();
    vi.advanceTimersByTime(10000);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it("can remount after a panel render without resetting the timeout", () => {
    toast.show("Couldn't jump.");
    vi.advanceTimersByTime(5000);
    root.innerHTML = "<main>Discussion panel</main>";
    toast.mount();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain("Couldn't jump.");
    vi.advanceTimersByTime(5000);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it("cleans up and ignores late errors after destruction", () => {
    toast.show("Couldn't jump.");
    toast.destroy();
    toast.show("A late navigation failure");
    toast.mount();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
