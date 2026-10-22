// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { applyWorkspaceTheme } from "../src/workspace/theme";

describe("workspace theme boundary", () => {
  it("accepts only known color tokens and follows host light/dark colors", () => {
    const root = document.createElement("div");
    applyWorkspaceTheme({
      "--background-color": "rgba(26, 32, 41, 1)",
      "--text-primary-color": "rgba(255, 255, 255, .95)",
      "--unknown": "red", "--focus-border-color": "url(https://evil.test)"
    }, root);
    expect(root.style.colorScheme).toBe("dark");
    expect(root.style.getPropertyValue("--background-color")).toBe("rgba(26, 32, 41, 1)");
    expect(root.style.getPropertyValue("--unknown")).toBe("");
    expect(root.style.getPropertyValue("--focus-border-color")).toBe("");
    applyWorkspaceTheme({ "--background-color": "rgb(255, 255, 255)" }, root);
    expect(root.style.colorScheme).toBe("light");
  });
});
