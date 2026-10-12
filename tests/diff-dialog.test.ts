import { describe, expect, it } from "vitest";
import { buildDiffRows } from "../src/ui/diff-dialog";

describe("buildDiffRows", () => {
  it("keeps later-line replacements anchored to their actual content and line numbers", () => {
    const rows = buildDiffRows("alpha\nbeta\nconst oldValue = 1;\nomega\n", "alpha\nbeta\nconst newValue = 2;\nomega\n");
    expect(rows.map((row) => row.text)).toEqual(["alpha", "beta", "const oldValue = 1;", "const newValue = 2;", "omega"]);
    expect(rows[2]).toMatchObject({ kind: "remove", oldLine: 3, newLine: null });
    expect(rows[3]).toMatchObject({ kind: "add", oldLine: null, newLine: 3 });
    expect(rows[2]?.emphasized).toContain("oldValue");
    expect(rows[3]?.emphasized).toContain("newValue");
  });

  it("anchors an insertion after unchanged lines to the new side", () => {
    const rows = buildDiffRows("one\ntwo\nfour\n", "one\ntwo\nthree\nfour\n");
    expect(rows.find((row) => row.text === "three")).toMatchObject({ kind: "add", oldLine: null, newLine: 3 });
  });
});
