// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { isTypingEvent } from "../src/ui/keyboard";

describe("Keyboard event edit detection", () => {
  it.each(["input", "textarea", "select"])("recognizes %s across a shadow boundary", (tag) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const input = document.createElement(tag);
    root.append(input);
    let typing = false;
    const handler = (event: KeyboardEvent) => { typing = isTypingEvent(event); };
    document.addEventListener("keydown", handler, true);
    try {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true, composed: true }));
      expect(typing).toBe(true);
    } finally {
      document.removeEventListener("keydown", handler, true);
      host.remove();
    }
  });

  it("recognizes nested contenteditable targets and leaves normal page shortcuts available", () => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.setAttribute("contenteditable", "true");
    const span = document.createElement("span");
    editable.append(span);
    document.body.append(editable);
    const values: boolean[] = [];
    const handler = (event: KeyboardEvent) => { values.push(isTypingEvent(event)); };
    document.addEventListener("keydown", handler, true);
    try {
      span.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
      expect(values).toEqual([true, false]);
    } finally {
      document.removeEventListener("keydown", handler, true);
      editable.remove();
    }
  });
});
