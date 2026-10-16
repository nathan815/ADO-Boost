import { commentTimestamps, type CommentDates } from "../core/comment-timestamps";

export function commentTimestampMarkup(dates: CommentDates, now = Date.now()): string {
  const timestamps = commentTimestamps(dates, now);
  if (!timestamps.length) return "";
  return `<span data-adopp-comment-timestamps>${timestamps.map((timestamp) =>
    `<time datetime="${timestamp.dateTime}" title="${escapeAttribute(timestamp.exact)}" aria-label="${timestamp.label} ${escapeAttribute(timestamp.exact)}">${timestamp.label === "Edited" ? "Edited " : ""}${escapeAttribute(timestamp.relative)}</time>`
  ).join(" &middot; ")}</span>`;
}

export function refreshCommentTimestamps(root: ParentNode, now = Date.now()): void {
  for (const time of root.querySelectorAll<HTMLTimeElement>("[data-adopp-comment-timestamps] time")) {
    const timestamp = commentTimestamps({ publishedDate: time.dateTime }, now)[0];
    if (!timestamp) continue;
    const prefix = time.getAttribute("aria-label")?.startsWith("Edited ") ? "Edited " : "";
    const text = `${prefix}${timestamp.relative}`;
    if (time.textContent !== text) time.textContent = text;
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character]!);
}
