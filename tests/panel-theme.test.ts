// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { panelStyles } from "../src/ui/styles";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Sidebar theme", () => {
  it("uses the native navigation background with a page-background fallback", () => {
    document.body.innerHTML = `<style>${panelStyles}</style>`;
    const rules = [...document.querySelector("style")!.sheet!.cssRules] as CSSStyleRule[];
    const host = rules.find((rule) => rule.selectorText === ":host")!;
    expect(host.style.getPropertyValue("--rail-bg")).toBe("var(--nav-vertical-background-color,var(--bg))");
    expect(host.style.getPropertyValue("--bg")).toBe("var(--background-color,#fff)");
  });

  it("keeps the rail and sticky discussion actions on the same navigation surface", () => {
    document.body.innerHTML = `<style>${panelStyles}</style><div class="rail"><div class="discussion-actions"></div><input class="search"><div class="dialog"></div></div>`;
    for (const selector of [".rail", ".discussion-actions"]) {
      expect(getComputedStyle(document.querySelector(selector)!).background).toBe("var(--rail-bg)");
    }
    for (const selector of [".search", ".dialog"]) {
      expect(getComputedStyle(document.querySelector(selector)!).background).toBe("var(--bg)");
    }
  });
});
