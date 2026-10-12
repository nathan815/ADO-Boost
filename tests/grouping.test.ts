import { describe, expect, it } from "vitest";
import { buildFlatGroup, buildFolderGroups, buildLocalGroups, validateSemanticGroups } from "../src/core/grouping";
import type { FileStat } from "../src/core/types";

const files: FileStat[] = [
  { trackingId: 1, path: "/src/app.ts", changeType: "edit", objectId: "1", additions: 2, deletions: 1, state: "exact", generated: false, lockfile: false },
  { trackingId: 2, path: "/tests/app.test.ts", changeType: "add", objectId: "2", additions: 4, deletions: 0, state: "exact", generated: false, lockfile: false },
  { trackingId: 3, path: "/package-lock.json", changeType: "edit", objectId: "3", additions: 5, deletions: 4, state: "exact", generated: false, lockfile: true }
];

describe("grouping", () => {
  it("supports category, folder, and flat modes without losing files", () => {
    for (const groups of [buildLocalGroups(files), buildFolderGroups(files), buildFlatGroup(files)]) {
      expect(groups.flatMap((group) => group.files).map((file) => file.path).sort()).toEqual(files.map((file) => file.path).sort());
    }
  });

  it("rejects unknown and duplicate semantic paths", () => {
    expect(() => validateSemanticGroups(files, [{ title: "A", rationale: "A", paths: ["/unknown"] }])).toThrow("unknown path");
    expect(() => validateSemanticGroups(files, [
      { title: "A", rationale: "A", paths: ["/src/app.ts"] },
      { title: "B", rationale: "B", paths: ["/src/app.ts"] }
    ])).toThrow("duplicate path");
  });

  it("keeps omitted semantic paths visible", () => {
    const groups = validateSemanticGroups(files, [{ title: "Implementation", rationale: "Core behavior", paths: ["/src/app.ts"] }]);
    expect(groups.at(-1)?.title).toBe("Not assigned by Copilot");
    expect(groups.at(-1)?.files).toHaveLength(2);
  });
});
