export function isTypingEvent(event: KeyboardEvent): boolean {
  return event.composedPath().some((target) =>
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLElement && (target.isContentEditable || target.getAttribute("contenteditable") === "true" || target.getAttribute("contenteditable") === "")
  );
}
