import { DISCUSSION_CHANNEL, discussionCommandSchema, type DiscussionConfiguration } from "./protocol";
import { InlineDraftSurface } from "./inline";

let config: DiscussionConfiguration | null = null;
let observer: MutationObserver | null = null;
let scheduled = 0;
let renderedPage = "";
const pendingComposers = new Map<string, HTMLTextAreaElement>();
const nativeEditingDrafts = new Set<string>();
const inlineDrafts = new InlineDraftSurface();
let nativeComposer: NativeComposerContract | null = null;
let activeNativeEditor: ActiveNativeEditor | null = null;

interface NativeReact {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
}

interface NativeComposerContract {
  react: NativeReact;
  component: unknown;
  props: Record<string, unknown>;
  model: new (props: {
    comment: {
      content: string;
      id: number;
      isDeleted: boolean;
      usersLiked: unknown[];
      author: unknown;
    };
    onDirtyChange: () => void;
  }) => unknown;
}

interface NativeItemProvider {
  internalItems: unknown[];
  splice(index: number, deleteCount: number, ...items: unknown[]): void;
}

interface NativeList {
  props: {
    renderRow(index: number, item: unknown, details: unknown): unknown;
  };
  forceUpdate(): void;
}

interface ActiveNativeEditor {
  draftId: string;
  item: object;
  provider: NativeItemProvider;
  list: NativeList;
  originalRenderRow: NativeList["props"]["renderRow"];
  renderRow: NativeList["props"]["renderRow"];
}

function schedule(): void {
  window.clearTimeout(scheduled);
  scheduled = window.setTimeout(reconcile, 100);
}

function reconcile(): void {
  observer?.disconnect();
  renderedPage = location.href;
  try {
    if (!config || !config.enabled || config.page !== location.origin + location.pathname) {
      removeOwnedDrafts();
      removeComposerActions();
      report("waiting", "Native draft surfaces are waiting for an enabled pull request view.");
      return;
    }
    ensureStyles();
    removeStaleDrafts();
    clearSavedComposers();
    const inlineAvailable = renderDrafts();
    renderComposerActions();
    normalizeNativeDraftEditors();
    orderDrafts();
    report(inlineAvailable ? "active" : "unavailable", inlineAvailable
      ? "Native draft comments and Add to review actions are active."
      : "The inline draft editor is unavailable. Drafts are preserved in the review sidebar.");
  } finally {
    if (config) observer?.observe(document.body, { childList: true, subtree: true });
  }
}

function renderDrafts(): boolean {
  const selectedDrafts = isFilesView() ? config!.drafts
    .filter((draft) => draft.kind === "inline" && draft.path === selectedPath()).sort(compareDrafts) : [];
  const inlineAvailable = inlineDrafts.render(selectedDrafts, (draft) => {
    const card = draftCard(draft, "inline");
    card.dataset.adoppNativeDraft = draft.id;
    card.dataset.adoppDraftSignature = draftSignature(draft);
    return card;
  });
  for (const draft of config!.drafts) {
    if (draft.kind === "inline") continue;
    const existing = document.querySelector<HTMLElement>(`[data-adopp-native-draft="${draft.id}"]`);
    if (nativeEditingDrafts.has(draft.id)) {
      existing?.remove();
      continue;
    }
    const signature = draftSignature(draft);
    if (existing?.dataset.adoppDraftSignature === signature) continue;
    existing?.remove();
    if (draft.kind === "reply" && draft.threadId) {
      const thread = document.querySelector<HTMLElement>(`.threadId-${draft.threadId}`)?.closest(".repos-discussion-thread");
      const reply = thread?.querySelector<HTMLElement>(".repos-discussion-thread-reply");
      if (thread && reply) {
        const card = draftCard(draft, "reply");
        card.dataset.adoppNativeDraft = draft.id;
        card.dataset.adoppDraftSignature = signature;
        reply.before(card);
      }
      continue;
    }
    if (draft.kind === "general" && !isFilesView()) {
      const feed = document.querySelector<HTMLElement>(".activity-feed-list");
      const body = feed?.tagName === "TABLE" ? feed.querySelector("tbody") : feed;
      if (!body) continue;
      const row = document.createElement(feed?.tagName === "TABLE" ? "tr" : "div");
      row.dataset.adoppNativeDraft = draft.id;
      row.dataset.adoppDraftSignature = signature;
      row.className = feed?.tagName === "TABLE" ? "bolt-timeline-row adopp-native-draft-row" : "adopp-native-draft-row";
      if (row.tagName === "TR") {
        const cell = document.createElement("td");
        cell.className = "bolt-timeline-cell flex-row";
        const sequence = document.createElement("div");
        sequence.className = "activity-feed-sequence bolt-timeline-sequence flex-column flex-center flex-noshrink";
        sequence.innerHTML = '<div class="bolt-timeline-icon-prefix"></div><span class="fluent-icons-enabled"><span aria-hidden="true" class="activity-feed-timeline-icon margin-vertical-4 secondary-text justify-center flex-noshrink fabric-icon ms-Icon--Chat"></span></span><div class="bolt-timeline-icon-suffix flex-grow"></div>';
        const content = document.createElement("div");
        content.className = "bolt-timeline-cell-content flex-row flex-grow scroll-hidden";
        const grow = document.createElement("div");
        grow.className = "flex-grow scroll-hidden";
        const spacing = document.createElement("div");
        spacing.className = "flex-row flex-grow padding-bottom-16 scroll-hidden padding-left-8 padding-right-4";
        spacing.append(draftCard(draft, "general"));
        grow.append(spacing);
        content.append(grow);
        cell.append(sequence, content);
        row.append(cell);
      } else {
        row.className = "flex-row flex-grow padding-bottom-16 scroll-hidden padding-left-8 padding-right-4 adopp-native-draft-row";
        row.append(draftCard(draft, "general"));
      }
      const composerRow = findComposerRow(body);
      if (composerRow) composerRow.after(row);
      else body.prepend(row);
      continue;
    }
  }
  return inlineAvailable;
}

function draftCard(draft: DiscussionConfiguration["drafts"][number], placement: "general" | "inline" | "reply"): HTMLElement {
  const card = document.createElement("div");
  card.className = placement === "reply"
    ? `adopp-native-draft adopp-native-draft-${placement}`
    : placement === "inline"
      ? "repos-editor-discussion margin-vertical-8 adopp-native-draft adopp-native-draft-inline"
      : "repos-comment-card flex-row flex-grow bolt-card-no-vertical-padding no-padding bolt-card flex-column depth-8 bolt-card-white adopp-native-draft adopp-native-draft-general";
  const nativeCard = document.querySelector<HTMLElement>(placement === "inline"
    ? ".repos-editor-discussion:not(.adopp-native-draft)" : ".repos-comment-card:not(.adopp-native-draft)");
  if (nativeCard) card.style.setProperty("--adopp-native-card-background", getComputedStyle(nativeCard).backgroundColor);
  const locationMarkup = draft.kind === "reply" ? `<span class="adopp-draft-location">Reply to thread ${draft.threadId}</span>` : "";
  const status = draft.delivery === "failed" ? "Failed draft" : draft.delivery === "ambiguous" ? "Posting uncertain" : "Draft";
  const reviewer = escapeHtml(config!.reviewer.displayName);
  const avatar = reviewerAvatar(config!.reviewer.displayName);
  const timestamp = draftTimestamp(draft.updatedAt);
  const actions = placement === "inline"
    ? `<button aria-label="Edit draft" title="Edit draft" class="bolt-button bolt-icon-button enabled subtle icon-only bolt-focus-treatment adopp-draft-edit" type="button"><span class="fluent-icons-enabled"><span aria-hidden="true" class="left-icon flex-noshrink fabric-icon ms-Icon--Edit medium"></span></span></button><button aria-label="Remove draft" title="Remove draft" class="bolt-button bolt-icon-button enabled subtle icon-only bolt-focus-treatment adopp-draft-remove" type="button"><span class="fluent-icons-enabled"><span aria-hidden="true" class="left-icon flex-noshrink fabric-icon ms-Icon--Delete medium"></span></span></button>`
    : `<button class="bolt-button enabled subtle bolt-focus-treatment adopp-draft-edit" type="button">Edit</button><button class="bolt-button enabled subtle bolt-focus-treatment adopp-draft-remove" type="button">Remove</button>`;
  const viewer = `<div class="repos-comment-viewer"><div class="repos-discussion-comment flex-column"><div class="flex-column"><div class="flex-row"><div><div class="bolt-coin flex-noshrink repos-comment-header-persona size24" aria-label="${reviewer}">${avatar}</div></div><div class="repos-comment-editor-fit flex-column flex-grow scroll-hidden padding-left-8"><div class="repos-discussion-comment-header flex-row flex-grow flex-center rhythm-horizontal-4 margin-bottom-8"><div class="scroll-hidden flex-row flex-center"><span class="font-weight-semibold padding-right-8 text-ellipsis">${reviewer}</span><div class="flex-row flex-center rhythm-horizontal-4 margin-left-4"><span class="text-ellipsis" aria-label="Draft updated ${escapeHtml(timestamp.full)}"><time class="body-s secondary-text margin-right-4 bolt-time-item white-space-nowrap" datetime="${escapeHtml(draft.updatedAt)}">${escapeHtml(timestamp.short)}</time></span></div><span class="adopp-draft-badge margin-left-4" title="Private review draft. Not posted to Azure DevOps.">${status}</span>${locationMarkup}</div><div class="flex-row flex-grow flex-noshrink justify-end flex-center">${actions}</div></div><div class="markdown-content markdown-editor-preview repos-comment-editor-max-width markdown-preview-checkbox-indent adopp-draft-body">${renderText(draft.body)}</div>${draft.error ? `<div class="adopp-draft-error" role="alert">${escapeHtml(draft.error)}</div>` : ""}</div></div></div></div></div>`;
  card.innerHTML = placement === "reply"
    ? viewer
    : placement === "inline"
      ? `<div class="repos-discussion-thread flex-column flex-grow scroll-hidden">${viewer}</div>`
      : `<div class="bolt-card-content flex-row flex-grow"><div class="repos-discussion-thread flex-column flex-grow scroll-hidden">${viewer}</div></div>`;
  card.querySelector(".adopp-draft-edit")?.addEventListener("click", () => {
    startDraftEdit(card, draft);
  });
  card.querySelector(".adopp-draft-remove")?.addEventListener("click", () => {
    window.postMessage({
      channel: DISCUSSION_CHANNEL, kind: "action", session: config!.session, action: "remove", id: draft.id
    }, window.location.origin);
  });
  return card;
}

function startDraftEdit(card: HTMLElement, draft: DiscussionConfiguration["drafts"][number]): void {
  if (tryNativeDraftEdit(draft)) return;
  if (draft.kind === "general" && canLoadHostReact()) {
    void primeNativeComposer().then((loaded) => {
      if (!card.isConnected) return;
      if (!loaded || !tryNativeDraftEdit(draft)) enterDraftEdit(card, draft);
    });
    return;
  }
  enterDraftEdit(card, draft);
}

function canLoadHostReact(): boolean {
  const require = Reflect.get(window, "require");
  if (typeof require !== "function") return false;
  const react = Reflect.apply(require, window, ["react"]);
  return isRecord(react) && typeof react.createElement === "function";
}

async function primeNativeComposer(): Promise<boolean> {
  if (nativeComposer) return true;
  const feed = document.querySelector(".activity-feed-list");
  const current = feed?.querySelector<HTMLTextAreaElement>("textarea:not([aria-hidden='true'])");
  if (current) {
    if (current.value.trim()) return false;
    captureNativeComposer(current);
    return nativeComposer !== null;
  }
  const collapsed = feed?.querySelector<HTMLElement>("input[placeholder*='comment' i],input[aria-label*='comment' i]");
  if (!collapsed) return false;
  collapsed.click();
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    const textarea = feed?.querySelector<HTMLTextAreaElement>("textarea:not([aria-hidden='true'])");
    if (!textarea) continue;
    captureNativeComposer(textarea);
    const editor = textarea.closest<HTMLElement>(".repos-comment-editor-fit,.repos-comment-editor-max-width");
    const cancel = [...(editor?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) =>
      button.textContent?.trim() === "Cancel"
    );
    cancel?.click();
    return nativeComposer !== null;
  }
  return false;
}

function enterDraftEdit(card: HTMLElement, draft: DiscussionConfiguration["drafts"][number]): void {
  const body = card.querySelector<HTMLElement>(".adopp-draft-body");
  if (!body || card.querySelector(".adopp-draft-editor")) return;
  const editor = document.createElement("div");
  editor.className = "adopp-draft-editor flex-column rhythm-vertical-8";
  editor.innerHTML = `<div class="bolt-textfield flex-row flex-center focus-treatment"><textarea rows="3" aria-label="Edit draft comment" class="bolt-textfield-input flex-grow bolt-textfield-auto-adjust"></textarea></div><div class="flex-row justify-end rhythm-horizontal-8"><button class="bolt-button enabled subtle bolt-focus-treatment adopp-draft-edit-cancel" type="button">Cancel</button><button class="bolt-button enabled primary bolt-focus-treatment adopp-draft-edit-save" type="button">Save draft</button></div>`;
  const textarea = editor.querySelector<HTMLTextAreaElement>("textarea")!;
  const save = editor.querySelector<HTMLButtonElement>(".adopp-draft-edit-save")!;
  textarea.value = draft.body;
  const update = () => setDraftButtonDisabled(save, !textarea.value.trim());
  textarea.addEventListener("input", update);
  editor.querySelector(".adopp-draft-edit-cancel")?.addEventListener("click", () => {
    editor.replaceWith(body);
  });
  save.addEventListener("click", () => {
    const nextBody = textarea.value.trim();
    if (!nextBody || !config) return;
    setDraftButtonDisabled(save, true);
    window.postMessage({
      channel: DISCUSSION_CHANNEL,
      kind: "action",
      session: config.session,
      action: "update",
      id: draft.id,
      body: nextBody
    }, window.location.origin);
  });
  body.replaceWith(editor);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function renderComposerActions(): void {
  const editors = [...document.querySelectorAll<HTMLElement>(".repos-comment-editor-fit,.repos-comment-editor-max-width")]
    .filter((editor) => !editor.closest("[data-adopp-native-editor],[data-adopp-native-draft]")
      && composerTextarea(editor));
  for (const editor of editors) {
    const textarea = composerTextarea(editor);
    if (!textarea) continue;
    captureNativeComposer(textarea);
    const nativePrimary = [...editor.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.classList.contains("primary"));
    const actionHost = nativePrimary?.parentElement ?? editor;
    if (nativePrimary && !nativePrimary.dataset.adoppOriginalPostLabel) {
      nativePrimary.dataset.adoppOriginalPostLabel = nativePrimary.textContent?.trim() || "Post";
      const label = nativePrimary.querySelector<HTMLElement>(".bolt-button-text");
      if (label) label.textContent = "Post";
      else nativePrimary.textContent = "Post";
    }
    const existing = editor.querySelector<HTMLButtonElement>("[data-adopp-add-review]");
    if (existing) {
      setDraftButtonDisabled(existing, !textarea.value.trim());
      if (!textarea.dataset.adoppReviewBound) {
        textarea.dataset.adoppReviewBound = "true";
        textarea.addEventListener("input", () => {
          setDraftButtonDisabled(existing, !textarea.value.trim());
        });
      }
      continue;
    }
    const button = nativePrimary?.cloneNode(true) as HTMLButtonElement | undefined ?? document.createElement("button");
    button.removeAttribute("id");
    delete button.dataset.adoppOriginalPostLabel;
    button.dataset.adoppAddReview = "true";
    button.type = "button";
    button.classList.remove("primary");
    button.classList.add("adopp-add-review");
    setDraftButtonDisabled(button, !textarea.value.trim());
    button.replaceChildren(document.createTextNode("Add to review"));
    const update = () => {
      setDraftButtonDisabled(button, !textarea.value.trim());
    };
    textarea.dataset.adoppReviewBound = "true";
    textarea.addEventListener("input", update);
    button.addEventListener("click", () => {
      const current = composerTextarea(editor);
      if (current) addComposerDraft(editor, current, button);
    });
    actionHost.insertBefore(button, nativePrimary ?? null);
  }
}

function composerTextarea(editor: HTMLElement): HTMLTextAreaElement | null {
  return editor.querySelector<HTMLTextAreaElement>("textarea:not(.bolt-textfield-auto-adjust-hidden):not([aria-hidden='true'])");
}

function captureNativeComposer(textarea: HTMLTextAreaElement): void {
  const require = Reflect.get(window, "require");
  if (typeof require !== "function") return;
  const react = Reflect.apply(require, window, ["react"]);
  if (!isRecord(react) || typeof react.createElement !== "function") return;
  const key = Object.getOwnPropertyNames(textarea).find((name) => name.startsWith("__reactFiber$"));
  let fiber: unknown = key ? Reflect.get(textarea, key) : null;
  const seen = new Set<unknown>();
  for (let depth = 0; isRecord(fiber) && depth < 60 && !seen.has(fiber); depth++) {
    seen.add(fiber);
    const props = fiber.memoizedProps;
    if (isRecord(props) && "onComment" in props && "comment" in props && "markdownEditorProps" in props
      && isRecord(props.comment) && typeof props.comment.constructor === "function" && fiber.type) {
      nativeComposer = {
        react: react as unknown as NativeReact,
        component: fiber.type,
        props,
        model: props.comment.constructor as unknown as NativeComposerContract["model"]
      };
      return;
    }
    fiber = fiber.return;
  }
}

function tryNativeDraftEdit(draft: DiscussionConfiguration["drafts"][number]): boolean {
  if (draft.kind !== "general" || !nativeComposer) return false;
  const host = discoverActivityList();
  if (!host) return false;
  cleanupNativeEditor();
  const { react, component, props, model: Model } = nativeComposer;
  const item = { adoppDraftEditor: draft.id };
  const comment = new Model({
    comment: {
      content: draft.body,
      id: -Math.max(1, Math.abs(hashDraftId(draft.id))),
      isDeleted: false,
      usersLiked: [],
      author: props.author
    },
    onDirtyChange: () => undefined
  });
  const originalRenderRow = host.list.props.renderRow;
  const renderRow = (index: number, row: unknown, details: unknown): unknown => {
    if (row !== item) return originalRenderRow(index, row, details);
    const h = react.createElement.bind(react);
    const finish = (): void => cleanupNativeEditor();
    const save = (_id: unknown, body: unknown): void => {
      if (typeof body !== "string" || !body.trim() || !config) return;
      window.postMessage({
        channel: DISCUSSION_CHANNEL,
        kind: "action",
        session: config.session,
        action: "update",
        id: draft.id,
        body: body.trim()
      }, window.location.origin);
      finish();
    };
    const sequence = h("div", { className: "activity-feed-sequence bolt-timeline-sequence flex-column flex-center flex-noshrink" },
      h("div", { className: "bolt-timeline-icon-prefix" }),
      h("span", { className: "fluent-icons-enabled" },
        h("span", {
          "aria-hidden": "true",
          className: "activity-feed-timeline-icon margin-vertical-4 secondary-text justify-center flex-noshrink fabric-icon ms-Icon--Chat"
        })),
      h("div", { className: "bolt-timeline-icon-suffix flex-grow" }));
    const editor = h(component, {
      ...props,
      comment,
      className: "repos-discussion-thread-reply",
      onCancel: finish,
      onComment: save
    });
    return h("tr", {
      className: "bolt-timeline-row",
      "data-row-index": index,
      "data-adopp-native-editor": draft.id,
      role: "presentation"
    }, h("td", {
      className: "bolt-timeline-cell flex-row",
      "data-column-index": 0,
      role: "presentation"
    }, sequence, h("div", { className: "bolt-timeline-cell-content flex-row flex-grow scroll-hidden" },
      h("div", { className: "flex-grow scroll-hidden" },
        h("div", { className: "flex-row flex-grow padding-bottom-16 scroll-hidden padding-left-8 padding-right-4" },
          h("div", {
            className: "repos-comment-card flex-row flex-grow bolt-card-no-vertical-padding no-padding bolt-card flex-column depth-8 bolt-card-white adopp-native-draft adopp-native-draft-general",
            style: {
              "--adopp-native-card-background": nativeCardBackground()
            }
          }, h("div", { className: "bolt-card-content flex-row flex-grow" },
            h("div", { className: "adopp-native-draft-editor-shell flex-grow" }, editor))))))));
  };
  host.list.props.renderRow = renderRow;
  const composerIndex = host.provider.internalItems.findIndex((candidate) =>
    isRecord(candidate) && candidate.isAddCommentRow === true
  );
  host.provider.splice(composerIndex >= 0 ? composerIndex + 1 : 0, 0, item);
  activeNativeEditor = {
    draftId: draft.id,
    item,
    provider: host.provider,
    list: host.list,
    originalRenderRow,
    renderRow
  };
  nativeEditingDrafts.add(draft.id);
  document.querySelector(`[data-adopp-native-draft="${draft.id}"]`)?.remove();
  host.list.forceUpdate();
  window.queueMicrotask(orderDrafts);
  schedule();
  return true;
}

function discoverActivityList(): { list: NativeList; provider: NativeItemProvider } | null {
  const feed = document.querySelector(".activity-feed-list");
  const key = feed && Object.getOwnPropertyNames(feed).find((name) => name.startsWith("__reactFiber$"));
  let fiber: unknown = key ? Reflect.get(feed, key) : null;
  const seen = new Set<unknown>();
  for (let depth = 0; isRecord(fiber) && depth < 30 && !seen.has(fiber); depth++) {
    seen.add(fiber);
    const props = fiber.memoizedProps;
    const list = fiber.stateNode;
    if (isRecord(props) && isNativeItemProvider(props.itemProvider) && isNativeList(list)) {
      return { list, provider: props.itemProvider };
    }
    fiber = fiber.return;
  }
  return null;
}

function cleanupNativeEditor(): void {
  const active = activeNativeEditor;
  if (!active) return;
  const index = active.provider.internalItems.indexOf(active.item);
  if (index >= 0) active.provider.splice(index, 1);
  if (active.list.props.renderRow === active.renderRow) active.list.props.renderRow = active.originalRenderRow;
  nativeEditingDrafts.delete(active.draftId);
  activeNativeEditor = null;
  active.list.forceUpdate();
  schedule();
}

function normalizeNativeDraftEditors(): void {
  for (const host of document.querySelectorAll<HTMLElement>("[data-adopp-native-editor]")) {
    const primary = host.querySelector<HTMLButtonElement>("button.primary");
    if (!primary) continue;
    const label = primary.querySelector<HTMLElement>(".bolt-button-text");
    if (label) label.textContent = "Save draft";
    else primary.textContent = "Save draft";
  }
}

function nativeCardBackground(): string {
  const nativeCard = document.querySelector<HTMLElement>(".repos-comment-card:not(.adopp-native-draft)");
  return nativeCard ? getComputedStyle(nativeCard).backgroundColor : "var(--background-color, #fff)";
}

function hashDraftId(value: string): number {
  let hash = 0;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash || 1;
}

function isNativeItemProvider(value: unknown): value is NativeItemProvider {
  return isRecord(value) && Array.isArray(value.internalItems) && typeof value.splice === "function";
}

function isNativeList(value: unknown): value is NativeList {
  return isRecord(value) && isRecord(value.props) && typeof value.props.renderRow === "function"
    && typeof value.forceUpdate === "function";
}

function addComposerDraft(editor: HTMLElement, textarea: HTMLTextAreaElement, button: HTMLButtonElement): void {
  const body = textarea.value.trim();
  if (!body || !config) return;
  const location = composerLocation(editor);
  if (!location) {
    let error = editor.querySelector<HTMLElement>("[data-adopp-composer-error]");
    if (!error) {
      error = document.createElement("div");
      error.dataset.adoppComposerError = "true";
      error.className = "adopp-draft-error";
      error.setAttribute("role", "alert");
      editor.append(error);
    }
    error.textContent = "Couldn't find this comment's file and line. Reopen the inline composer and try again.";
    report("unavailable", error.textContent);
    return;
  }
  editor.querySelector("[data-adopp-composer-error]")?.remove();
  button.disabled = true;
  pendingComposers.set(composerSignature(location, body), textarea);
  window.postMessage({
    channel: DISCUSSION_CHANNEL,
    kind: "action",
    session: config.session,
    action: "add",
    draft: { ...location, body }
  }, window.location.origin);
}

function composerLocation(editor: HTMLElement): { kind: "general" | "inline" | "reply"; path?: string; line?: number; side?: "left" | "right"; threadId?: number } | null {
  const threadInput = editor.querySelector<HTMLElement>("[class*='threadId-']") ?? editor.closest(".repos-discussion-thread")?.querySelector<HTMLElement>("[class*='threadId-']");
  const threadId = threadInput?.className.match(/(?:^|\s)threadId-(\d+)(?:\s|$)/)?.[1];
  if (threadId) return { kind: "reply", threadId: Number(threadId) };
  const inlineHost = editor.closest<HTMLElement>(".repos-editor-discussion-host");
  if (!inlineHost) return { kind: "general" };
  const native = discoverNativeThreadContext(editor.querySelector("textarea[id]") ?? editor.querySelector("textarea") ?? editor);
  const path = native.path ?? selectedPath();
  if (!path || !native.line) return null;
  return { kind: "inline", path, line: native.line, side: native.side ?? "right" };
}

function discoverNativeThreadContext(element: Element): { path?: string; line?: number; side?: "left" | "right" } {
  const key = Object.getOwnPropertyNames(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber: unknown = key ? Reflect.get(element, key) : null;
  const seen = new Set<unknown>();
  for (let depth = 0; isRecord(fiber) && depth < 60 && !seen.has(fiber); depth++) {
    seen.add(fiber);
    const props = isRecord(fiber.memoizedProps) ? fiber.memoizedProps : null;
    const model = props && isRecord(props.thread) ? props.thread : props && isRecord(props.threadModel) ? props.threadModel : null;
    const thread = model && isRecord(model.props) && isRecord(model.props.thread) ? model.props.thread
      : model && isRecord(model.thread) ? model.thread : model;
    const context = thread && isRecord(thread.threadContext) ? thread.threadContext : null;
    if (context) {
      const right = isRecord(context.rightFileStart) ? context.rightFileStart : null;
      const left = isRecord(context.leftFileStart) ? context.leftFileStart : null;
      return {
        ...(typeof context.filePath === "string" ? { path: context.filePath } : {}),
        ...(typeof right?.line === "number" ? { line: right.line, side: "right" as const }
          : typeof left?.line === "number" ? { line: left.line, side: "left" as const } : {})
      };
    }
    fiber = fiber.return;
  }
  return {};
}

function clearSavedComposers(): void {
  for (const draft of config?.drafts ?? []) {
    const signature = composerSignature(draft, draft.body);
    const textarea = pendingComposers.get(signature);
    if (!textarea) continue;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, "");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const editor = textarea.closest<HTMLElement>(".repos-comment-editor-fit,.repos-comment-editor-max-width");
    const cancel = [...(editor?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((candidate) => candidate.textContent?.trim() === "Cancel");
    cancel?.click();
    pendingComposers.delete(signature);
  }
}

function composerSignature(location: { kind: string; path?: string | undefined; line?: number | undefined; side?: string | undefined; threadId?: number | undefined }, body: string): string {
  return JSON.stringify([location.kind, location.path ?? "", location.line ?? 0, location.side ?? "", location.threadId ?? 0, body.trim()]);
}

function findComposerRow(body: HTMLElement): Element | null {
  const control = body.querySelector("textarea[aria-label*='comment' i],input[placeholder*='comment' i],input[aria-label*='comment' i]");
  if (!control) return null;
  let row: Element = control;
  while (row.parentElement && row.parentElement !== body) row = row.parentElement;
  return row.parentElement === body ? row : null;
}

function selectedPath(): string | undefined {
  return new URL(location.href).searchParams.get("path") ?? undefined;
}

function isFilesView(): boolean {
  return new URL(location.href).searchParams.get("_a")?.toLowerCase() === "files";
}

function removeOwnedDrafts(): void {
  inlineDrafts.clear();
  for (const element of document.querySelectorAll("[data-adopp-native-draft]")) element.remove();
}

function removeStaleDrafts(): void {
  const current = new Set(config?.drafts.map((draft) => draft.id) ?? []);
  for (const element of document.querySelectorAll<HTMLElement>("[data-adopp-native-draft]")) {
    const id = element.dataset.adoppNativeDraft;
    if (!id || !current.has(id)) element.remove();
  }
}

function orderDrafts(): void {
  if (!config) return;
  const drafts = [...config.drafts].sort(compareDrafts);
  const feed = document.querySelector<HTMLElement>(".activity-feed-list");
  const body = feed?.tagName === "TABLE" ? feed.querySelector<HTMLElement>("tbody") : feed;
  const composer = body ? findComposerRow(body) : null;
  if (body && composer) {
    let cursor = composer;
    for (const draft of drafts.filter((candidate) => candidate.kind === "general")) {
      const row = activeNativeEditor?.draftId === draft.id
        ? document.querySelector<HTMLElement>(`[data-adopp-native-editor="${draft.id}"]`)
        : document.querySelector<HTMLElement>(`[data-adopp-native-draft="${draft.id}"]`);
      if (!row || row.parentElement !== body) continue;
      if (cursor.nextElementSibling !== row) cursor.after(row);
      cursor = row;
    }
  }
  const replyThreads = new Set(drafts.flatMap((draft) =>
    draft.kind === "reply" && draft.threadId ? [draft.threadId] : []
  ));
  for (const threadId of replyThreads) {
    const thread = document.querySelector<HTMLElement>(`.threadId-${threadId}`)?.closest(".repos-discussion-thread");
    const reply = thread?.querySelector<HTMLElement>(".repos-discussion-thread-reply");
    if (!thread || !reply) continue;
    for (const draft of drafts.filter((candidate) => candidate.kind === "reply" && candidate.threadId === threadId)) {
      const card = document.querySelector<HTMLElement>(`[data-adopp-native-draft="${draft.id}"]`);
      if (card?.parentElement === thread) reply.before(card);
    }
  }
}

function compareDrafts(
  left: DiscussionConfiguration["drafts"][number],
  right: DiscussionConfiguration["drafts"][number]
): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || left.id.localeCompare(right.id);
}

function draftTimestamp(value: string): { short: string; full: string } {
  const date = new Date(value);
  const includeYear = date.getFullYear() !== new Date().getFullYear();
  return {
    short: date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: includeYear ? "numeric" : undefined,
      hour: "numeric",
      minute: "2-digit"
    }),
    full: date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
  };
}

function draftSignature(draft: DiscussionConfiguration["drafts"][number]): string {
  return JSON.stringify([draft.kind, draft.body, draft.updatedAt, draft.delivery, draft.error ?? ""]);
}

function removeComposerActions(): void {
  for (const element of document.querySelectorAll("[data-adopp-add-review]")) element.remove();
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-adopp-original-post-label]")) {
    const label = button.querySelector<HTMLElement>(".bolt-button-text");
    if (label) label.textContent = button.dataset.adoppOriginalPostLabel ?? "";
    else button.textContent = button.dataset.adoppOriginalPostLabel ?? "";
    delete button.dataset.adoppOriginalPostLabel;
  }
}

function report(state: "waiting" | "active" | "unavailable", detail: string): void {
  if (!config) return;
  window.postMessage({ channel: DISCUSSION_CHANNEL, kind: "status", session: config.session, state, detail }, location.origin);
}

function ensureStyles(): void {
  if (document.getElementById("adopp-native-discussion-styles")) return;
  const style = document.createElement("style");
  style.id = "adopp-native-discussion-styles";
  style.textContent = `.adopp-native-draft{position:relative}.adopp-native-draft-general,.adopp-native-draft-inline,.adopp-native-draft-reply .repos-comment-viewer{background-color:color-mix(in srgb,var(--communication-foreground,var(--palette-primary-80,#0078d4)) 3%,var(--adopp-native-card-background,var(--background-color,#fff)))}.adopp-native-draft-editor-shell{box-sizing:border-box;min-width:0;margin:4px;padding:8px 12px}.adopp-draft-badge{border:1px solid var(--communication-foreground,var(--palette-primary-80,#0078d4));border-radius:10px;padding:1px 7px;font-size:11px;font-weight:600;color:var(--communication-foreground,var(--palette-primary-80,#0078d4));white-space:nowrap}.adopp-draft-location{margin-left:8px;color:var(--text-secondary-color,rgba(0,0,0,.65));font-size:12px}.adopp-draft-edit+.adopp-draft-remove{margin-inline-start:4px}.adopp-draft-body{white-space:pre-wrap}.adopp-draft-editor textarea{min-height:64px;resize:vertical}.adopp-draft-error{margin-top:8px;color:var(--status-error-text,#a4262c)}.adopp-add-review{margin-inline-end:8px}`;
  document.head.append(style);
  style.textContent += ".adopp-inline-draft-zone{overflow:hidden;z-index:1}.adopp-inline-draft-content{display:flex;flex-direction:column;gap:8px;padding:0 12px 0 0;box-sizing:border-box;user-select:text;-webkit-user-select:text}.adopp-inline-draft-content>.adopp-native-draft-inline{flex:0 0 auto;min-height:0;background-color:color-mix(in srgb,var(--communication-foreground,var(--palette-primary-80,#0078d4)) 3%,var(--adopp-native-card-background,var(--background-color,#fff)))}";
}

function setDraftButtonDisabled(button: HTMLButtonElement, disabled: boolean): void {
  button.disabled = disabled;
  button.classList.toggle("disabled", disabled);
  button.classList.toggle("enabled", !disabled);
  if (disabled) {
    button.setAttribute("aria-disabled", "true");
    button.dataset.isFocusable = "false";
  } else {
    button.removeAttribute("aria-disabled");
    button.dataset.isFocusable = "true";
  }
}

function reviewerAvatar(displayName: string): string {
  const image = [...document.querySelectorAll<HTMLImageElement>(".bolt-coin img")].find((candidate) =>
    candidate.closest(".bolt-coin")?.getAttribute("aria-label") === displayName
  );
  if (image?.src) return `<img class="bolt-coin-content using-image size24" src="${escapeHtml(image.src)}" alt="">`;
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return `<span class="bolt-coin-content size24 adopp-draft-initials">${escapeHtml(initials || "?")}</span>`;
}

function renderText(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] as string);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const parsed = discussionCommandSchema.safeParse(event.data);
  if (!parsed.success) return;
  if (parsed.data.kind === "dispose") {
    if (config?.session !== parsed.data.session) return;
    config = null;
    observer?.disconnect();
    observer = null;
    window.clearTimeout(scheduled);
    removeOwnedDrafts();
    removeComposerActions();
    cleanupNativeEditor();
    nativeComposer = null;
    return;
  }
  config = parsed.data;
  observer ??= new MutationObserver((records) => {
    if (location.href !== renderedPage || records.some((record) => relevantMutation(record))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  reconcile();
});

function relevantMutation(record: MutationRecord): boolean {
  if (record.target instanceof Element && record.target.closest("[data-adopp-native-draft],[data-adopp-add-review]")) return false;
  if (record.target instanceof Element && record.target.closest(".activity-feed-list,.repos-discussion-thread,.repos-editor-discussion-host,.repos-comment-editor-fit,.repos-comment-editor-max-width")) return true;
  const nodes = [...record.addedNodes, ...record.removedNodes];
  return nodes.some((node) => node instanceof Element && (
    node.matches(".activity-feed-list,.repos-discussion-thread,.repos-editor-discussion-host,.repos-comment-editor-fit,.repos-comment-editor-max-width,.repos-diff-editor")
    || node.querySelector(".activity-feed-list,.repos-discussion-thread,.repos-editor-discussion-host,.repos-comment-editor-fit,.repos-comment-editor-max-width,.repos-diff-editor")
  ));
}
