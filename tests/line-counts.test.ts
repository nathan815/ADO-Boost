import { describe, expect, it } from "vitest";
import { lineCountParts } from "../src/core/line-counts";

describe("line count presentation", () => {
  it.each([
    [7, 3, [{ kind: "minus", text: "−3" }, { kind: "plus", text: "+7" }]],
    [11, 0, [{ kind: "plus", text: "+11" }]],
    [0, 4, [{ kind: "minus", text: "−4" }]],
    [0, 0, []]
  ] as const)("orders and omits counts for +%s -%s", (additions, deletions, expected) => {
    expect(lineCountParts(additions, deletions)).toEqual(expected);
  });
});
