// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { panelStyles } from "../src/ui/styles";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Sidebar content sizing", () => {
  it("allows sidebar grid tracks and their items to shrink below intrinsic comment widths", () => {
    document.body.innerHTML = `<style>${panelStyles}</style><div class="rail"><main class="workspace"><div class="thread-list"><article class="thread-item"></article></div><div class="draft-list"><article class="draft-item"></article></div></main></div>`;
    for (const selector of [".rail", ".thread-list", ".draft-list"]) {
      expect(getComputedStyle(document.querySelector(selector)!).gridTemplateColumns).toBe("minmax(0,1fr)");
    }
    for (const selector of [".workspace", ".thread-item", ".draft-item"]) {
      expect(getComputedStyle(document.querySelector(selector)!).minWidth).toBe("0");
    }
  });

  it("keeps wide tables and code locally scrollable without breaking table words into characters", () => {
    document.body.innerHTML = `<style>${panelStyles}</style><div class="thread-content"><table><tbody><tr><td>Useful feedback</td></tr></tbody></table><pre><code>longUnbrokenCode</code></pre></div>`;
    for (const selector of ["table", "pre"]) {
      const style = getComputedStyle(document.querySelector(selector)!);
      expect(style.maxWidth).toBe("100%");
      expect(style.overflow).toBe("auto");
    }
    expect(getComputedStyle(document.querySelector("table")!).overflowWrap).toBe("normal");
    expect(getComputedStyle(document.querySelector("pre")!).whiteSpace).toBe("pre");
  });
});
