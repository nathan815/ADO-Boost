import { describe, expect, it } from "vitest";
import { sortDiscussions, sortThreads } from "../src/ui/discussion-sort";

describe("Discussion sorting", () => {
  it("uses publication dates rather than API order or IDs and leaves the source untouched", () => {
    const entries = [
      { id: 30, publishedDate: "2026-10-12T12:00:00Z" },
      { id: 10, publishedDate: "2026-10-15T12:00:00Z" },
      { id: 20, publishedDate: "2026-10-14T12:00:00Z" }
    ];
    expect(sortDiscussions(entries, "newest").map((entry) => entry.id)).toEqual([10, 20, 30]);
    expect(sortDiscussions(entries, "oldest").map((entry) => entry.id)).toEqual([30, 20, 10]);
    expect(entries.map((entry) => entry.id)).toEqual([30, 10, 20]);
  });

  it("breaks date ties by ID and places missing dates last with a deterministic ID order", () => {
    const entries = [
      { id: 2 }, { id: 3, publishedDate: "invalid" },
      { id: 5, publishedDate: "2026-10-15T12:00:00Z" },
      { id: 4, publishedDate: "2026-10-15T12:00:00Z" }
    ];
    expect(sortDiscussions(entries, "newest").map((entry) => entry.id)).toEqual([5, 4, 3, 2]);
    expect(sortDiscussions(entries, "oldest").map((entry) => entry.id)).toEqual([4, 5, 2, 3]);
  });

  it("uses a visible comment date when a thread lacks publication metadata", () => {
    expect(sortThreads([
      { id: 2, status: "active", comments: [
        { id: 1, content: "", author: "A", isDeleted: true, publishedDate: "2026-10-16T12:00:00Z" },
        { id: 2, content: "Earlier", author: "A", isDeleted: false, publishedDate: "2026-10-14T12:00:00Z" }
      ] },
      { id: 1, status: "active", publishedDate: "2026-10-15T12:00:00Z", comments: [] }
    ], "newest").map((thread) => thread.id)).toEqual([1, 2]);
  });
});
