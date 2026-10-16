// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AdoPanelHeader } from "../src/ui/ado-panel-header";

let header: AdoPanelHeader | undefined;

afterEach(() => {
  header?.destroy();
  document.body.innerHTML = "";
});

describe("Sidebar settings button", () => {
  it("keeps the centered gear outline and stroke inside the icon viewport", () => {
    const container = document.createElement("div");
    document.body.append(container);
    header = new AdoPanelHeader(container);
    const onSettings = vi.fn();
    header.render({
      overlay: false,
      announcementEnabled: false,
      announced: false,
      subtitle: "",
      onSettings,
      onLayoutChange: vi.fn(),
      onClose: vi.fn(),
      onAnnounce: vi.fn()
    });

    const button = container.querySelector<HTMLButtonElement>('[aria-label="Open settings"]')!;
    const svg = button.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    const icons = container.querySelectorAll(".header-actions svg");
    expect(icons).toHaveLength(3);
    for (const icon of icons) {
      expect(icon.namespaceURI).toBe("http://www.w3.org/2000/svg");
      expect(icon.getAttribute("stroke")).toBe("currentColor");
      expect(icon.getAttribute("width")).toBe("16");
      expect(icon.getAttribute("height")).toBe("16");
      expect(icon.getAttribute("focusable")).toBe("false");
    }
    const logo = container.querySelector(".header-logo")!;
    expect(logo.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(logo.querySelector("rect")?.getAttribute("fill")).toBe("url(#adopp-logo-tile)");
    expect(logo.querySelector("linearGradient")?.id).toBe("adopp-logo-tile");
    expect(container.querySelector("img")).toBeNull();
    const outline = svg.querySelector("path")!.getAttribute("d")!.split("Z")[0]!;
    expect(outline).toMatch(/^M[\d. ]+L[\d. ]+$/);
    const coordinates = outline.match(/[\d.]+/g)!.map(Number);
    const xs = coordinates.filter((_, index) => index % 2 === 0);
    const ys = coordinates.filter((_, index) => index % 2 === 1);
    const strokeRadius = Number(svg.getAttribute("stroke-width")) / 2;
    for (const axis of [xs, ys]) {
      expect(Math.min(...axis) - strokeRadius).toBeGreaterThan(0);
      expect(Math.max(...axis) + strokeRadius).toBeLessThan(16);
      expect((Math.min(...axis) + Math.max(...axis)) / 2).toBe(8);
    }

    button.click();
    expect(onSettings).toHaveBeenCalledOnce();
  });
});
