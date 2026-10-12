import { describe, expect, it } from "vitest";
import { countChangedLines, MAX_FILE_BYTES, totalStats } from "../src/core/diff";

const file = { trackingId: 1, path: "/src/file.txt", changeType: "edit" };

const cases = [
  ["unchanged", "alpha\nbeta\n", "alpha\nbeta\n", 0, 0],
  ["added-file", "", "alpha\nbeta\n", 2, 0],
  ["deleted-file", "alpha\nbeta\n", "", 0, 2],
  ["replace-one-line", "alpha\nbeta\n", "alpha\ngamma\n", 1, 1],
  ["insert-between", "alpha\ngamma\n", "alpha\nbeta\ngamma\n", 1, 0],
  ["delete-between", "alpha\nbeta\ngamma\n", "alpha\ngamma\n", 0, 1],
  ["add-without-final-newline", "", "alpha", 1, 0],
  ["replace-without-final-newline", "alpha", "beta", 1, 1],
  ["add-final-newline", "alpha", "alpha\n", 0, 0],
  ["remove-final-newline", "alpha\n", "alpha", 0, 0],
  ["crlf-only", "alpha\r\nbeta\r\n", "alpha\nbeta\n", 0, 0],
  ["crlf-line-edit", "alpha\r\nbeta\r\n", "alpha\r\ngamma\r\n", 1, 1],
  ["blank-line-added", "alpha\nbeta\n", "alpha\n\nbeta\n", 1, 0],
  ["trailing-spaces-changed", "alpha\n", "alpha  \n", 1, 1],
  ["repeated-lines", "a\nb\na\nb\n", "a\nb\nb\na\n", 1, 1],
  ["non-ascii-text", "café\nα\n", "café\nβ\n", 1, 1]
] as const;

describe("countChangedLines", () => {
  it.each(cases)("matches the normalized Git oracle for %s", (_name, before, after, additions, deletions) => {
    const result = countChangedLines(file, { before, after });
    expect([result.additions, result.deletions, result.state]).toEqual([additions, deletions, "exact"]);
  });

  it("does not report oversized content as zero", () => {
    const result = countChangedLines(file, { before: "a", after: "b", afterSize: MAX_FILE_BYTES + 1 });
    expect(result).toMatchObject({ additions: null, deletions: null, state: "unavailable" });
  });

  it("preserves incomplete totals", () => {
    const exact = countChangedLines(file, { before: "a\n", after: "b\n" });
    const unavailable = countChangedLines({ ...file, trackingId: 2 }, { before: "a", after: "b", afterSize: MAX_FILE_BYTES + 1 });
    expect(totalStats([exact, unavailable])).toEqual({ additions: 1, deletions: 1, exact: false, incomplete: 1 });
  });
});
