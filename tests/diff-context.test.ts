import { describe, expect, it } from "vitest";
import { changedLineExcerpt } from "../src/core/diff-context";

describe("Copilot diff context", () => {
  it("emits grounded side and line references", () => {
    const excerpt = changedLineExcerpt("one\nold\nthree\n", "one\nnew\nthree\n");
    expect(excerpt).toContain("L2:left:- old");
    expect(excerpt).toContain("L2:right:+ new");
    expect(excerpt).not.toContain("one");
  });

  it("caps changed lines and reports omissions", () => {
    const before = Array.from({ length: 250 }, (_, index) => `old-${index}`).join("\n");
    const after = Array.from({ length: 250 }, (_, index) => `new-${index}`).join("\n");
    const excerpt = changedLineExcerpt(before, after);
    expect(excerpt).toContain("additional changed lines omitted");
    expect(excerpt.split("\n").length).toBeLessThanOrEqual(201);
  });
});
