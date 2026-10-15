// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewPanelLayout } from "../src/ui/review-panel-layout";

let layout: ReviewPanelLayout | undefined;

afterEach(() => {
  layout?.destroy();
  layout = undefined;
  document.body.innerHTML = "";
});

function mount() {
  document.body.innerHTML = '<div class="region-content"><main class="repos-pr-details-page"><p>Native PR</p></main></div>';
  const content = document.querySelector<HTMLElement>("main")!;
  const container = content.parentElement!;
  const host = document.createElement("div");
  layout = new ReviewPanelLayout(host);
  return { host, content, container };
}

describe("ReviewPanelLayout", () => {
  it("reserves space beside the original PR content only when opened inline", () => {
    const { host, content, container } = mount();
    expect(host.parentElement).toBe(container);
    expect(container.hasAttribute("data-adopp-panel-layout")).toBe(false);
    layout!.update(true, "inline");
    expect(host.dataset.layout).toBe("inline");
    expect(host.dataset.open).toBe("true");
    expect(content.hasAttribute("data-adopp-panel-main")).toBe(true);
    expect(container.dataset.adoppPanelLayout).toBe("inline");
    expect(container.firstElementChild).toBe(content);
    expect(content.textContent).toBe("Native PR");
    layout!.update(false, "inline");
    expect(container.hasAttribute("data-adopp-panel-layout")).toBe(false);
    expect(content.hasAttribute("data-adopp-panel-main")).toBe(false);
    expect(host.dataset.open).toBe("false");
  });

  it("releases reserved space for explicit overlay mode and restores it when docked", () => {
    const { host, content, container } = mount();
    layout!.update(true, "inline");
    layout!.update(true, "overlay");
    expect(host.dataset.layout).toBe("overlay");
    expect(container.hasAttribute("data-adopp-panel-layout")).toBe(false);
    expect(content.hasAttribute("data-adopp-panel-main")).toBe(false);
    layout!.update(true, "inline");
    expect(container.dataset.adoppPanelLayout).toBe("inline");
  });

  it("reattaches after native PR content is replaced and restores the old container", async () => {
    const { host, content, container } = mount();
    layout!.update(true, "inline");
    const replacement = document.createElement("div");
    replacement.innerHTML = '<main class="repos-pr-details-page">New native PR</main>';
    container.replaceWith(replacement);
    await vi.waitFor(() => expect(host.parentElement).toBe(replacement));
    expect(replacement.dataset.adoppPanelLayout).toBe("inline");
    expect(content.hasAttribute("data-adopp-panel-main")).toBe(false);
    expect(container.hasAttribute("data-adopp-panel-layout")).toBe(false);
    expect(document.querySelectorAll("[data-adopp-panel-main]")).toHaveLength(1);
  });

  it("reports an unavailable native mount without falling back to an overlay, then recovers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const host = document.createElement("div");
      layout = new ReviewPanelLayout(host);
      layout.update(true, "inline");
      expect(host.dataset.layout).toBe("unavailable");
      expect(warn).toHaveBeenCalledOnce();
      const container = document.createElement("div");
      container.innerHTML = '<main class="repos-pr-details-page">PR loaded</main>';
      document.body.append(container);
      await vi.waitFor(() => expect(host.parentElement).toBe(container));
      expect(host.dataset.layout).toBe("inline");
    } finally {
      warn.mockRestore();
    }
  });

  it("removes all owned layout changes on disposal without removing native content", async () => {
    const { host, content, container } = mount();
    const styles = [...document.head.querySelectorAll("style")];
    layout!.update(true, "inline");
    layout!.destroy();
    layout = undefined;
    expect(host.isConnected).toBe(false);
    expect(content.isConnected).toBe(true);
    expect(container.hasAttribute("data-adopp-panel-layout")).toBe(false);
    expect(content.hasAttribute("data-adopp-panel-main")).toBe(false);
    expect(styles.every((style) => !style.isConnected)).toBe(true);
    container.append(document.createElement("p"));
    await Promise.resolve();
    expect(host.isConnected).toBe(false);
  });
});
