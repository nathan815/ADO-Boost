import { describe, expect, it } from "vitest";
import { groupThreadComments, sortDiscussions, sortThreads } from "../src/ui/discussion-sort";
import type { PullRequestThread } from "../src/core/types";

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

  describe("Thread conversation grouping", () => {
    type Comment = PullRequestThread["comments"][number];
    const comment = (id: number, overrides: Partial<Comment> = {}): Comment => ({
      id, content: `Comment ${id}`, author: "Reviewer", isDeleted: false, ...overrides
    });

    it("keeps the original first and replies in ID order regardless of API order or missing dates", () => {
      const original = comment(1);
      const firstReply = comment(2, { publishedDate: "2026-10-15T12:00:00Z" });
      const secondReply = comment(3, { publishedDate: "2026-10-14T12:00:00Z" });
      const source = [secondReply, original, firstReply];
      expect(groupThreadComments(source)).toEqual({ original, replies: [firstReply, secondReply] });
      expect(source).toEqual([secondReply, original, firstReply]);
    });

    it.each([
      { isDeleted: true },
      { isVoteUpdate: true },
      { author: "Microsoft.VisualStudio.Services.TFS" }
    ])("does not promote a reply when the original is hidden: %j", (hidden) => {
      const reply = comment(2);
      expect(groupThreadComments([comment(1, hidden), reply])).toEqual({ original: undefined, replies: [reply] });
    });

    it("filters hidden replies without removing visible conversation context", () => {
      const original = comment(1);
      const reply = comment(5);
      expect(groupThreadComments([
        original, comment(2, { isDeleted: true }), comment(3, { isVoteUpdate: true }),
        comment(4, { author: "Microsoft.VisualStudio.Services.TFS" }), reply
      ])).toEqual({ original, replies: [reply] });
    });

    it("handles empty and fully hidden threads", () => {
      expect(groupThreadComments([])).toEqual({ original: undefined, replies: [] });
      expect(groupThreadComments([comment(1, { isDeleted: true }), comment(2, { isVoteUpdate: true })]))
        .toEqual({ original: undefined, replies: [] });
    });
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
