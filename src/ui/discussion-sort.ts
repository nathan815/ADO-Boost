import type { PullRequestThread } from "../core/types";

export type DiscussionSort = "newest" | "oldest";

interface DatedEntry {
  id: number;
  publishedDate?: string;
}

export function sortDiscussions<T extends DatedEntry>(entries: readonly T[], order: DiscussionSort): T[] {
  const direction = order === "newest" ? -1 : 1;
  return [...entries].sort((left, right) => {
    const leftDate = Date.parse(left.publishedDate ?? "");
    const rightDate = Date.parse(right.publishedDate ?? "");
    if (Number.isFinite(leftDate) !== Number.isFinite(rightDate)) return Number.isFinite(leftDate) ? -1 : 1;
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) return direction * (leftDate - rightDate);
    return direction * (left.id - right.id);
  });
}

export function sortThreads(threads: readonly PullRequestThread[], order: DiscussionSort): PullRequestThread[] {
  return sortDiscussions(threads.map((thread) => {
    const publishedDate = thread.publishedDate ?? thread.comments.find((comment) => !comment.isDeleted && comment.publishedDate)?.publishedDate;
    return { ...thread, ...(publishedDate ? { publishedDate } : {}) };
  }), order);
}
