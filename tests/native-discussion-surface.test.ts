// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dev.azure.com/org/project/_git/repo/pullrequest/7"}

import { afterEach, describe, expect, it, vi } from "vitest";
import { DISCUSSION_CHANNEL } from "../src/native-discussions/protocol";

const reviewer = { id: "reviewer", displayName: "Reviewer" };

function mountDiffEditor(): void {
  const host = document.createElement("div");
  host.className = "repos-diff-editor";
  document.body.append(host);
  const editor = (side: string) => ({
    getModel: () => ({ getLineCount: () => 200 }),
    changeViewZones: (callback: (accessor: {
      addZone(zone: { domNode: HTMLElement; afterLineNumber: number }): string;
      removeZone(id: string): void;
      layoutZone(id: string): void;
    }) => void) => callback({
      addZone: (zone) => {
        zone.domNode.id = `zone-${side}`;
        zone.domNode.dataset.side = side;
        zone.domNode.dataset.afterLine = String(zone.afterLineNumber);
        host.append(zone.domNode);
        return zone.domNode.id;
      },
      removeZone: (id) => document.getElementById(id)?.remove(),
      layoutZone: () => undefined
    })
  });
  const left = editor("left");
  const right = editor("right");
  Reflect.set(host, "__reactFiber$test", { stateNode: { editor: {
    getOriginalEditor: () => left,
    getModifiedEditor: () => right
  } } });
}

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState({}, "", "/org/project/_git/repo/pullrequest/7");
  vi.restoreAllMocks();
});

describe("native discussion page surface", () => {
  it("renders marked drafts and preserves Post while adding Add to review", async () => {
    const session = "16748ae6-f0a9-4dad-ac76-88e2bafc32c1";
    document.body.innerHTML = `<table class="activity-feed-list"><tbody>
      <tr class="bolt-list-row-spacer invisible"><td></td></tr>
      <tr data-native-composer><td><div class="repos-comment-editor-fit"><textarea aria-label="Add a comment">Queue me</textarea><div><button id="native-comment" class="bolt-button primary">Comment</button></div></div></td></tr>
      <tr><td>Native activity</td></tr>
    </tbody></table>`;
    await import("../src/native-discussions/main");
    const messages: unknown[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message) => { messages.push(message); });
    const send = (data: unknown) => window.dispatchEvent(new MessageEvent("message", {
      data, source: window, origin: location.origin
    }));
    send({
      channel: DISCUSSION_CHANNEL,
      kind: "configure",
      session,
      page: location.origin + location.pathname,
      reviewer,
      enabled: true,
      drafts: [{
        id: "d71ea4d1-9146-4376-a2f0-f25e1c681776",
        kind: "general",
        source: "manual",
        body: "Private feedback",
        createdAt: "2026-10-16T00:00:00Z",
        updatedAt: "2026-10-16T00:00:00Z",
        delivery: "pending"
      }]
    });
    expect(document.querySelector("[data-adopp-native-draft]")?.textContent).toContain("Draft");
    expect(document.querySelector("[data-adopp-native-draft]")?.textContent).toContain("Private feedback");
    expect(document.getElementById("adopp-native-discussion-styles")?.textContent).not.toContain("background-color");
    expect(document.querySelector("[data-adopp-native-draft] .activity-feed-sequence .ms-Icon--Chat")).not.toBeNull();
    expect(document.querySelector("[data-adopp-native-draft] .bolt-timeline-cell-content .repos-comment-card")).not.toBeNull();
    expect(document.querySelector("[data-native-composer]")?.nextElementSibling?.hasAttribute("data-adopp-native-draft")).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".primary")?.textContent).toBe("Post");
    const add = document.querySelector<HTMLButtonElement>("[data-adopp-add-review]")!;
    expect(add.textContent).toBe("Add to review");
    expect(add.disabled).toBe(false);
    expect(add.hasAttribute("id")).toBe(false);
    expect(add.hasAttribute("data-adopp-original-post-label")).toBe(false);
    add.click();
    expect(messages).toContainEqual(expect.objectContaining({
      channel: DISCUSSION_CHANNEL,
      kind: "action",
      session,
      action: "add",
      draft: { kind: "general", body: "Queue me" }
    }));
    document.querySelector<HTMLButtonElement>(".adopp-draft-edit")?.click();
    const draftEditor = document.querySelector<HTMLTextAreaElement>(".adopp-draft-editor textarea")!;
    draftEditor.value = "Updated private feedback";
    draftEditor.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>(".adopp-draft-edit-save")?.click();
    expect(messages).toContainEqual(expect.objectContaining({
      channel: DISCUSSION_CHANNEL,
      kind: "action",
      session,
      action: "update",
      id: "d71ea4d1-9146-4376-a2f0-f25e1c681776",
      body: "Updated private feedback"
    }));
    send({ channel: DISCUSSION_CHANNEL, kind: "dispose", session });
    expect(document.querySelector("[data-adopp-native-draft]")).toBeNull();
    expect(document.querySelector("[data-adopp-add-review]")).toBeNull();
    expect(document.querySelector<HTMLButtonElement>(".primary")?.textContent).toBe("Comment");
  });

  it("shows draft timestamps and keeps drafts in reverse updated order", async () => {
    const session = "3a86103e-e042-47a5-b327-4e2d40d555b7";
    document.body.innerHTML = `<table class="activity-feed-list"><tbody>
      <tr data-native-composer><td><div class="repos-comment-editor-fit"><textarea aria-label="Add a comment"></textarea><div><button class="bolt-button primary">Comment</button></div></div></td></tr>
      <tr><td>Native activity</td></tr>
    </tbody></table>`;
    await import("../src/native-discussions/main");
    const send = (data: unknown) => window.dispatchEvent(new MessageEvent("message", {
      data, source: window, origin: location.origin
    }));
    send({
      channel: DISCUSSION_CHANNEL,
      kind: "configure",
      session,
      page: location.origin + location.pathname,
      reviewer,
      enabled: true,
      drafts: [
        {
          id: "47f79e9d-b54a-48fe-b89e-104f23a2fdb3",
          kind: "general",
          source: "manual",
          body: "Older draft",
          createdAt: "2026-10-15T10:00:00Z",
          updatedAt: "2026-10-15T10:00:00Z",
          delivery: "pending"
        },
        {
          id: "23769ea5-3c5d-42eb-a383-6f76615733b7",
          kind: "general",
          source: "manual",
          body: "Newer draft",
          createdAt: "2026-10-16T10:00:00Z",
          updatedAt: "2026-10-16T10:00:00Z",
          delivery: "pending"
        }
      ]
    });
    expect([...document.querySelectorAll(".adopp-draft-body")].map((element) => element.textContent)).toEqual([
      "Newer draft",
      "Older draft"
    ]);
    expect([...document.querySelectorAll<HTMLTimeElement>("[data-adopp-native-draft] time")].map((time) => time.dateTime)).toEqual([
      "2026-10-16T10:00:00Z",
      "2026-10-15T10:00:00Z"
    ]);
    const firstTime = document.querySelector<HTMLTimeElement>("[data-adopp-native-draft] time")!;
    const firstBadge = document.querySelector<HTMLElement>("[data-adopp-native-draft] .adopp-draft-badge")!;
    expect(firstTime.textContent).toMatch(/:/);
    expect(firstTime.compareDocumentPosition(firstBadge) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    send({ channel: DISCUSSION_CHANNEL, kind: "dispose", session });
  });

  it("allows saving a nonempty draft independently of the native Post state", async () => {
    const session = "47ccce22-a729-41f6-a770-1fe8bd47a18e";
    document.body.innerHTML = '<div class="repos-comment-editor-fit"><textarea aria-label="Add a comment">Keep locally</textarea><div><button class="bolt-button primary disabled" aria-disabled="true" disabled>Comment</button></div></div>';
    await import("../src/native-discussions/main");
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        channel: DISCUSSION_CHANNEL,
        kind: "configure",
        session,
        page: location.origin + location.pathname,
        reviewer,
        enabled: true,
        drafts: []
      },
      source: window,
      origin: location.origin
    }));
    const add = document.querySelector<HTMLButtonElement>("[data-adopp-add-review]");
    expect(add?.disabled).toBe(false);
    expect(add?.classList.contains("enabled")).toBe(true);
    expect(add?.classList.contains("disabled")).toBe(false);
    expect(add?.hasAttribute("aria-disabled")).toBe(false);
    window.dispatchEvent(new MessageEvent("message", {
      data: { channel: DISCUSSION_CHANNEL, kind: "dispose", session },
      source: window,
      origin: location.origin
    }));
  });

  it("normalizes cloned actions in reply and inline composers", async () => {
    const session = "83b0a722-d70c-45d9-8157-b295ae62c6f8";
    document.body.innerHTML = `
      <article class="repos-discussion-thread">
        <span class="threadId-42"></span>
        <div class="repos-comment-editor-fit"><textarea aria-label="Add a comment">Reply locally</textarea><div><button class="bolt-button primary disabled" aria-disabled="true" disabled>Reply</button></div></div>
      </article>
      <div class="repos-editor-discussion-host">
        <div class="repos-comment-editor-fit"><textarea aria-label="Add a comment">Inline locally</textarea><div><button class="bolt-button primary disabled" aria-disabled="true" disabled>Comment</button></div></div>
      </div>`;
    await import("../src/native-discussions/main");
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        channel: DISCUSSION_CHANNEL,
        kind: "configure",
        session,
        page: location.origin + location.pathname,
        reviewer,
        enabled: true,
        drafts: []
      },
      source: window,
      origin: location.origin
    }));
    const actions = [...document.querySelectorAll<HTMLButtonElement>("[data-adopp-add-review]")];
    expect(actions).toHaveLength(2);
    expect(actions.every((action) =>
      !action.disabled
      && action.classList.contains("enabled")
      && !action.classList.contains("disabled")
      && !action.hasAttribute("aria-disabled")
    )).toBe(true);
    window.dispatchEvent(new MessageEvent("message", {
      data: { channel: DISCUSSION_CHANNEL, kind: "dispose", session },
      source: window,
      origin: location.origin
    }));
  });

  it("places reply and selected-file drafts in their native discussion surfaces", async () => {
    const session = "db71cd71-55b8-4c86-a9d6-74d22789c48b";
    await import("../src/native-discussions/main");
    const send = (data: unknown) => window.dispatchEvent(new MessageEvent("message", {
      data, source: window, origin: location.origin
    }));
    document.body.innerHTML = '<article class="repos-discussion-thread"><input class="threadId-42"><div class="repos-discussion-thread-reply"></div></article>';
    send({
      channel: DISCUSSION_CHANNEL,
      kind: "configure",
      session,
      page: location.origin + location.pathname,
      reviewer,
      enabled: true,
      drafts: [{
        id: "a9a3bf18-e143-49d4-8fad-ad38e8e1c343",
        kind: "reply",
        source: "manual",
        body: "Private reply",
        threadId: 42,
        createdAt: "2026-10-16T00:00:00Z",
        updatedAt: "2026-10-16T00:00:00Z",
        delivery: "pending"
      }]
    });
    expect(document.querySelector(".repos-discussion-thread > [data-adopp-native-draft]")?.textContent).toContain("Private reply");

    history.replaceState({}, "", `${location.pathname}?_a=files&path=%2Fsrc%2Fapp.ts`);
    document.body.innerHTML = '<div class="repos-changes-viewer"></div>';
    mountDiffEditor();
    send({
      channel: DISCUSSION_CHANNEL,
      kind: "configure",
      session,
      page: location.origin + location.pathname,
      reviewer,
      enabled: true,
      drafts: [{
        id: "4eb398f5-ae6d-4e41-9c96-75b15cb25c9d",
        kind: "inline",
        source: "manual",
        body: "Private inline",
        path: "/src/app.ts",
        line: 9,
        side: "left",
        trackingId: 12,
        createdAt: "2026-10-16T00:00:00Z",
        updatedAt: "2026-10-16T00:00:00Z",
        delivery: "pending"
      }]
    });
    const inline = document.querySelector(".repos-diff-editor [data-adopp-native-draft]");
    expect(inline?.textContent).toContain("Private inline");
    expect(inline?.querySelector(".adopp-draft-location")).toBeNull();
    expect(inline?.classList.contains("repos-editor-discussion")).toBe(true);
    expect(inline?.classList.contains("bolt-card")).toBe(false);
    expect(inline?.querySelector(".adopp-draft-edit[aria-label='Edit draft'] .ms-Icon--Edit")).not.toBeNull();
    expect(inline?.querySelector(".adopp-draft-remove[aria-label='Remove draft'] .ms-Icon--Delete")).not.toBeNull();
    expect(inline?.querySelector(".repos-discussion-comment-auto-hide-button,.repos-discussion-comment-auto-hide")).toBeNull();
    expect(inline?.closest<HTMLElement>(".adopp-inline-draft-zone")?.dataset).toMatchObject({ side: "left", afterLine: "9" });
    expect(getComputedStyle(inline!.closest(".adopp-inline-draft-zone")!).zIndex).toBe("1");
    expect(getComputedStyle(inline!.closest(".adopp-inline-draft-content")!).userSelect).toBe("text");
    send({ channel: DISCUSSION_CHANNEL, kind: "dispose", session });
  });

  it.each(["left", "right"] as const)("queues an inline %s-side draft from the composer's native thread model", async (side) => {
    const session = "b512dfb3-51e8-48d8-8e02-c2b9a82f41ef";
    history.replaceState({}, "", `${location.pathname}?_a=files&path=%2Fother.ts`);
    document.body.innerHTML = `<div class="repos-changes-viewer"><div class="repos-editor-discussion-host">
      <div class="repos-comment-editor-fit"><textarea class="bolt-textfield-auto-adjust-hidden"></textarea><textarea id="native-inline" class="threadId--11" aria-label="Add a comment">Inline feedback</textarea><div><button class="cancel">Cancel</button><button class="bolt-button primary">Comment</button></div></div>
    </div></div>`;
    mountDiffEditor();
    const textarea = document.querySelector<HTMLTextAreaElement>("#native-inline")!;
    document.querySelector(".cancel")!.addEventListener("click", () => {
      document.querySelector(".repos-editor-discussion-host")!.remove();
    });
    Reflect.set(textarea, "__reactFiber$test", {
      memoizedProps: {},
      return: {
        memoizedProps: {
          thread: {
            props: {
              thread: {
                id: -11,
                threadContext: { filePath: "/src/app.ts", [`${side}FileStart`]: { line: 9, offset: 1 } }
              }
            }
          }
        }
      }
    });
    await import("../src/native-discussions/main");
    const messages: unknown[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message) => { messages.push(message); });
    const send = (data: unknown) => window.dispatchEvent(new MessageEvent("message", {
      data, source: window, origin: location.origin
    }));
    const configuration = {
      channel: DISCUSSION_CHANNEL,
      kind: "configure",
      session,
      page: location.origin + location.pathname,
      reviewer,
      enabled: true,
      drafts: []
    };
    send(configuration);
    document.querySelector<HTMLButtonElement>("[data-adopp-add-review]")!.click();
    expect(messages).toContainEqual(expect.objectContaining({
      action: "add",
      draft: { kind: "inline", path: "/src/app.ts", line: 9, side, body: "Inline feedback" }
    }));
    expect(textarea.value).toBe("Inline feedback");
    history.replaceState({}, "", `${location.pathname}?_a=files&path=%2Fsrc%2Fapp.ts`);
    send({
      ...configuration,
      drafts: [{
        id: "c0758270-03ea-49d5-8230-cf89f74fcfe7",
        kind: "inline",
        source: "manual",
        path: "/src/app.ts",
        line: 9,
        side,
        body: "Inline feedback",
        createdAt: "2026-10-16T00:00:00Z",
        updatedAt: "2026-10-16T00:00:00Z",
        delivery: "pending"
      }]
    });
    expect(textarea.value).toBe("");
    expect(document.querySelector(".repos-editor-discussion-host:not(.adopp-inline-draft-content)")).toBeNull();
    expect(document.querySelector(".repos-diff-editor [data-adopp-native-draft]")?.textContent).toContain("Inline feedback");
    expect(document.querySelector(".repos-changes-viewer > [data-adopp-native-draft]")).toBeNull();
    send({ channel: DISCUSSION_CHANNEL, kind: "dispose", session });
  });

  it("shows an error instead of silently ignoring an inline composer without line context", async () => {
    const session = "9dc6b3b5-805f-41d2-bfae-56c1ad7dcb24";
    document.body.innerHTML = `<div class="repos-editor-discussion-host">
      <div class="repos-comment-editor-fit"><textarea aria-label="Add a comment">Keep my feedback</textarea><div><button class="bolt-button primary">Comment</button></div></div>
    </div>`;
    await import("../src/native-discussions/main");
    const messages: unknown[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message) => { messages.push(message); });
    const send = (data: unknown) => window.dispatchEvent(new MessageEvent("message", {
      data, source: window, origin: location.origin
    }));
    send({
      channel: DISCUSSION_CHANNEL, kind: "configure", session,
      page: location.origin + location.pathname, reviewer, enabled: true, drafts: []
    });
    document.querySelector<HTMLButtonElement>("[data-adopp-add-review]")!.click();
    expect(document.querySelector("[role='alert']")?.textContent).toContain("file and line");
    expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Keep my feedback");
    expect(messages).not.toContainEqual(expect.objectContaining({ action: "add" }));
    send({ channel: DISCUSSION_CHANNEL, kind: "dispose", session });
  });
});
