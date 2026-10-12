import { describe, expect, it } from "vitest";
import { validateSemanticGroups } from "../src/core/semantic-groups";
import type { FileStat } from "../src/core/types";

const files: FileStat[] = [
  { trackingId: 1, path: "/a.ts", changeType: "edit", objectId: "a", additions: 2, deletions: 1, state: "exact", generated: false, lockfile: false },
  { trackingId: 2, path: "/b.ts", changeType: "add", objectId: "b", additions: 3, deletions: 0, state: "exact", generated: false, lockfile: false }
];

describe("validateSemanticGroups", () => {
  it("preserves omitted files in a visible fallback group", () => {
    const groups = validateSemanticGroups(files, [{ title: "Core", rationale: "Main change", paths: ["/a.ts"] }]);
    expect(groups[0]?.source).toBe("copilot");
    expect(groups[1]).toMatchObject({ title: "Unassigned changes", source: "local" });
    expect(groups[1]?.files.map((file) => file.path)).toEqual(["/b.ts"]);
  });

  it("rejects unknown and duplicate paths", () => {
    expect(() => validateSemanticGroups(files, [{ title: "Bad", rationale: "Bad", paths: ["/missing.ts"] }])).toThrow("unknown");
    expect(() => validateSemanticGroups(files, [
      { title: "One", rationale: "One", paths: ["/a.ts"] },
      { title: "Two", rationale: "Two", paths: ["/a.ts"] }
    ])).toThrow("duplicate");
  });
});
