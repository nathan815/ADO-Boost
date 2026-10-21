import { describe, expect, it } from "vitest";
import { SemanticGroupState, validateSemanticGroups } from "../src/core/semantic-groups";
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

  describe("comparison-scoped semantic state", () => {
    it("starts in All files, shares one result, and never generates on a view change", () => {
      const state = new SemanticGroupState();
      state.setEnabled(true);
      expect(state.view).toEqual({ mode: "all", groupId: null });
      const request = state.begin();
      state.complete(request, validateSemanticGroups(files, [{ title: "Core", rationale: "Related", paths: ["/a.ts"] }]));
      expect(state.view.mode).toBe("inline");
      state.select({ mode: "group", groupId: state.groups![0]!.id });
      expect(state.groups).toHaveLength(2);
      expect(state.busy).toBe(false);
      expect(state.revision).toBe(1);
      state.select({ mode: "group", groupId: "unknown" });
      expect(state.view.groupId).toBe(state.groups![0]!.id);
    });

    it("retains results on regeneration errors but rejects late results after a comparison change or disablement", () => {
      const state = new SemanticGroupState();
      state.setEnabled(true);
      const groups = validateSemanticGroups(files, []);
      state.complete(state.begin(), groups);
      const failed = state.begin();
      state.fail(failed, "Companion unavailable");
      expect(state.groups).toBe(groups);
      expect(state.error).toBe("Companion unavailable");
      const stale = state.begin();
      state.setAvailable(false);
      state.setAvailable(true);
      state.complete(stale, groups);
      expect(state.groups).toBeNull();
      expect(state.busy).toBe(false);
      const disabled = state.begin();
      state.setEnabled(false);
      state.setEnabled(true);
      state.complete(disabled, groups);
      expect(state.groups).toBeNull();
      expect(state.view.mode).toBe("all");
    });

    it("bounds model text and group counts before sharing results with the native bridge", () => {
      expect(() => validateSemanticGroups(files, [{ title: "x".repeat(301), rationale: "", paths: ["/a.ts"] }])).toThrow("invalid title");
      expect(() => validateSemanticGroups(files, [{ title: "Core", rationale: "x".repeat(8001), paths: ["/a.ts"] }])).toThrow("explanation");
      expect(() => validateSemanticGroups(files, Array.from({ length: 200 }, () => ({ title: "Core", rationale: "", paths: [] })))).toThrow("too many");
    });
  });

  it("rejects unknown and duplicate paths", () => {
    expect(() => validateSemanticGroups(files, [{ title: "Bad", rationale: "Bad", paths: ["/missing.ts"] }])).toThrow("unknown");
    expect(() => validateSemanticGroups(files, [
      { title: "One", rationale: "One", paths: ["/a.ts"] },
      { title: "Two", rationale: "Two", paths: ["/a.ts"] }
    ])).toThrow("duplicate");
  });
});
