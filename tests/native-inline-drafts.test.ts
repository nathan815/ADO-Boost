// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { InlineDraftSurface } from "../src/native-discussions/inline";
import type { DiscussionConfiguration } from "../src/native-discussions/protocol";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("anchors to the requested side and line, sizes to content, and releases its zone", () => {
  document.body.innerHTML = '<div class="repos-diff-editor"><div class="view-zones" aria-hidden="true"></div></div>';
  const host = document.querySelector<HTMLElement>(".repos-diff-editor")!;
  const root = host.firstElementChild!;
  let resize = () => undefined as void;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  const added: { afterLineNumber: number; heightInPx: number; domNode: HTMLElement }[] = [];
  const layout = vi.fn();
  const remove = vi.fn(() => root.replaceChildren());
  const editor = {
    getModel: () => ({ getLineCount: () => 100 }),
    changeViewZones: (callback: (accessor: {
      addZone(zone: typeof added[number]): string;
      layoutZone(id: string): void;
      removeZone(id: string): void;
    }) => void) => callback({
      addZone: (zone) => { added.push(zone); root.append(zone.domNode); return "draft-zone"; },
      layoutZone: layout,
      removeZone: remove
    })
  };
  const original = vi.fn(() => editor);
  const modified = vi.fn(() => editor);
  Reflect.set(host, "__reactFiber$test", { stateNode: { editor: {
    getOriginalEditor: original,
    getModifiedEditor: modified
  } } });
  const draft: DiscussionConfiguration["drafts"][number] = {
    id: "draft", kind: "inline", source: "manual", path: "/app.ts", line: 45, side: "right",
    body: "Small draft", createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z", delivery: "pending"
  };
  const createCard = vi.fn(() => {
    const card = document.createElement("div");
    card.textContent = draft.body;
    return card;
  });
  const surface = new InlineDraftSurface();
  expect(surface.render([draft], createCard)).toBe(true);
  expect(modified).toHaveBeenCalledOnce();
  expect(original).not.toHaveBeenCalled();
  expect(added[0]?.afterLineNumber).toBe(45);
  expect(added[0]?.heightInPx).toBe(120);
  expect(root.getAttribute("aria-hidden")).toBe("false");
  const content = root.querySelector<HTMLElement>(".adopp-inline-draft-content")!;
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue({ height: 96 } as DOMRect);
  resize();
  expect(added[0]?.heightInPx).toBe(96);
  expect(layout).toHaveBeenCalledWith("draft-zone");
  surface.render([draft], createCard);
  expect(createCard).toHaveBeenCalledOnce();
  surface.render([], createCard);
  expect(remove).toHaveBeenCalledWith("draft-zone");
  expect(disconnect).toHaveBeenCalledOnce();
  expect(root.getAttribute("aria-hidden")).toBe("true");
  expect(root.children).toHaveLength(0);
});
